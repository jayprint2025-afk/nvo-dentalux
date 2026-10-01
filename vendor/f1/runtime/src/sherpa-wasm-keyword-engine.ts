import type { SherpaKeywordEngine, SherpaKeywordResult } from "./sherpa-keyword-model.js";

type SherpaStream = {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
};

type SherpaKws = {
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { keyword?: string; text?: string };
  reset(stream: SherpaStream): void;
  free(): void;
};

declare global {
  interface Window {
    Module?: any;
    createKws?: (module: any, config: any) => SherpaKws;
  }
}

export interface SherpaWasmKeywordEngineConfig {
  readonly assetBaseUrl?: string;
  readonly keywordsScore?: number;
  readonly keywordsThreshold?: number;
  readonly keywordSpec?: string;
}

const VFS_DIR = "/hana-kws";

export class SherpaWasmKeywordEngine implements SherpaKeywordEngine {
  readonly #base: string;
  readonly #score: number;
  readonly #threshold: number;
  readonly #keywordSpec?: string;
  #kws: SherpaKws | null = null;
  #stream: SherpaStream | null = null;

  constructor(config: SherpaWasmKeywordEngineConfig = {}) {
    this.#base = (config.assetBaseUrl ?? "/models/sherpa-hana").replace(/\/$/, "");
    this.#score = config.keywordsScore ?? 1.0;
    this.#threshold = config.keywordsThreshold ?? 0.20;
    this.#keywordSpec = config.keywordSpec;
  }

  async initialize(): Promise<void> {
    if (this.#kws && this.#stream) return;

    const assetBase = `${this.#base}/`;
    const previous = window.Module ?? {};
    window.Module = {
      ...previous,
      locateFile: (path: string) => {
        const fileName = path.split("/").pop() || path;
        return `${assetBase}${fileName}`;
      },
    };

    await loadScript(`${this.#base}/sherpa-onnx-kws.js`);
    await loadScript(`${this.#base}/sherpa-onnx-wasm-kws-main.js`);

    // createKws can appear before Emscripten has mounted its filesystem.
    // Do not construct Sherpa until both the runtime and FS are really ready.
    await waitFor(
      () => Boolean(
        window.Module &&
        window.createKws &&
        window.Module.calledRun &&
        window.Module.FS &&
        typeof window.Module.FS.writeFile === "function",
      ),
      30000,
      "Sherpa WASM runtime/filesystem did not initialize.",
    );

    const module = window.Module!;
    const FS = module.FS;

    ensureDir(FS, VFS_DIR);

    // Sherpa native code cannot read browser URLs such as
    // /models/sherpa-hana/encoder.onnx. Put the real browser assets into the
    // Emscripten virtual filesystem and pass native VFS paths to createKws().
    await Promise.all([
      mountBinary(FS, `${this.#base}/encoder.onnx`, `${VFS_DIR}/encoder.onnx`),
      mountBinary(FS, `${this.#base}/decoder.onnx`, `${VFS_DIR}/decoder.onnx`),
      mountBinary(FS, `${this.#base}/joiner.onnx`, `${VFS_DIR}/joiner.onnx`),
      mountBinary(FS, `${this.#base}/tokens.txt`, `${VFS_DIR}/tokens.txt`),
    ]);

    const keywords = (this.#keywordSpec ?? await fetchText(`${this.#base}/keywords.txt`)).trim();
    if (!keywords) throw new Error("Hana keywords.txt is empty.");

    const config = {
      featConfig: { samplingRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: `${VFS_DIR}/encoder.onnx`,
          decoder: `${VFS_DIR}/decoder.onnx`,
          joiner: `${VFS_DIR}/joiner.onnx`,
        },
        tokens: `${VFS_DIR}/tokens.txt`,
        provider: "cpu",
        modelType: "",
        numThreads: 1,
        debug: 0,
        modelingUnit: "bpe",
        bpeVocab: "",
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: this.#score,
      keywordsThreshold: this.#threshold,
      keywords: `${keywords}\n`,
    };

    const kws = window.createKws!(module, config);
    if (!kws || typeof kws.createStream !== "function") {
      throw new Error("Sherpa createKws() did not return a valid KWS instance.");
    }

    const stream = kws.createStream();
    if (!stream || typeof stream.acceptWaveform !== "function") {
      try { kws.free(); } catch { /* ignore cleanup failure */ }
      throw new Error("Sherpa KWS did not create a valid stream.");
    }

    this.#kws = kws;
    this.#stream = stream;
    console.info("[HANA SHERPA] READY", { base: this.#base, vfs: VFS_DIR, keywords });
  }

  async acceptWaveform(samples: Float32Array, sampleRate: number): Promise<SherpaKeywordResult | null> {
    if (!this.#kws || !this.#stream) throw new Error("Sherpa KWS is not initialized.");

    this.#stream.acceptWaveform(sampleRate, samples);

    let hit: SherpaKeywordResult | null = null;
    let guard = 0;
    while (this.#kws.isReady(this.#stream)) {
      // Protect the UI from a malformed runtime that never clears isReady().
      if (++guard > 128) throw new Error("Sherpa KWS decode loop exceeded safety limit.");
      this.#kws.decode(this.#stream);
      const result = this.#kws.getResult(this.#stream);
      const keyword = (result.keyword ?? result.text ?? "").trim();
      if (keyword) hit = { keyword: keyword.replace(/_/g, " ") };
    }

    return hit;
  }

  reset(): void {
    if (this.#kws && this.#stream) this.#kws.reset(this.#stream);
  }

  async dispose(): Promise<void> {
    try { this.#stream?.free(); } finally {
      this.#stream = null;
      this.#kws?.free();
      this.#kws = null;
    }
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return await response.text();
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function ensureDir(FS: any, path: string): void {
  try { FS.mkdir(path); } catch (error: any) {
    // EEXIST is fine. stat() is more portable across Emscripten versions than
    // relying on a numeric errno value.
    try { FS.stat(path); } catch { throw error; }
  }
}

async function mountBinary(FS: any, url: string, vfsPath: string): Promise<void> {
  const bytes = await fetchBinary(url);
  if (bytes.byteLength === 0) throw new Error(`Empty Sherpa asset: ${url}`);
  FS.writeFile(vfsPath, bytes);
  const stat = FS.stat(vfsPath);
  if (!stat || Number(stat.size) !== bytes.byteLength) {
    throw new Error(`Sherpa VFS verification failed for ${vfsPath}.`);
  }
}

function loadScript(src: string): Promise<void> {
  const absolute = new URL(src, location.href).href;
  const existing = [...document.scripts].find((script) => script.src === absolute);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(script);
  });
}

async function waitFor(
  fn: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
