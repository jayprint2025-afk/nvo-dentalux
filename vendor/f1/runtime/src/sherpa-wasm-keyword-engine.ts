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

type EmscriptenModule = {
  calledRun?: boolean;
  locateFile?: (path: string, prefix?: string) => string;
  onRuntimeInitialized?: () => void;
  FS_createDataFile?: (
    parent: string,
    name: string | null,
    data: ArrayLike<number>,
    canRead: boolean,
    canWrite: boolean,
    canOwn?: boolean,
  ) => unknown;
  FS_unlink?: (path: string) => void;
  [key: string]: any;
};

declare global {
  interface Window {
    Module?: EmscriptenModule;
    createKws?: (module: EmscriptenModule, config: any) => SherpaKws;
  }
}

export interface SherpaWasmKeywordEngineConfig {
  readonly assetBaseUrl?: string;
  readonly keywordsScore?: number;
  readonly keywordsThreshold?: number;
  readonly keywordSpec?: string;
}

const VFS = {
  encoder: "/hana-es-encoder.onnx",
  decoder: "/hana-es-decoder.onnx",
  joiner: "/hana-es-joiner.onnx",
  tokens: "/hana-es-tokens.txt",
} as const;

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
    const previousModule = window.Module ?? {};
    let resolveRuntime!: () => void;
    const runtimeReady = new Promise<void>((resolve) => { resolveRuntime = resolve; });
    const previousOnRuntimeInitialized = previousModule.onRuntimeInitialized;

    window.Module = {
      ...previousModule,
      locateFile: (path: string) => {
        const fileName = path.split("/").pop() || path;
        return `${assetBase}${fileName}`;
      },
      onRuntimeInitialized: () => {
        previousOnRuntimeInitialized?.();
        resolveRuntime();
      },
    };

    await loadScript(`${this.#base}/sherpa-onnx-kws.js`);
    await loadScript(`${this.#base}/sherpa-onnx-wasm-kws-main.js`);
    await waitFor(() => Boolean(window.Module && window.createKws), 30000);

    if (!window.Module!.calledRun) {
      await withTimeout(runtimeReady, 30000, "Sherpa WASM runtime did not finish initialization.");
    }
    await waitFor(
      () => Boolean(window.Module?.calledRun && window.Module?.FS_createDataFile),
      30000,
    );

    // The .data shipped by the browser build contains the upstream demo model.
    // Hana uses the Spanish model files in public/models/sherpa-hana instead.
    // Native sherpa-onnx opens model paths through Emscripten's virtual FS, not
    // through HTTP URLs, so copy the Spanish assets into that FS before createKws.
    await installSpanishAssetsIntoVfs(window.Module!, this.#base);

    const keywords = this.#keywordSpec ?? await fetchText(`${this.#base}/keywords.txt`);
    const config = {
      featConfig: { samplingRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: VFS.encoder,
          decoder: VFS.decoder,
          joiner: VFS.joiner,
        },
        tokens: VFS.tokens,
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
      keywords,
    };

    const kws = window.createKws!(window.Module!, config);
    if (!kws) throw new Error("Sherpa createKws returned no keyword spotter.");
    const stream = kws.createStream();
    if (!stream) {
      kws.free();
      throw new Error("Sherpa could not create a keyword stream.");
    }

    this.#kws = kws;
    this.#stream = stream;
    console.info("[HANA SHERPA] Spanish KWS initialized", {
      keyword: keywords.trim(),
      encoder: VFS.encoder,
      tokens: VFS.tokens,
    });
  }

  async acceptWaveform(samples: Float32Array, sampleRate: number): Promise<SherpaKeywordResult | null> {
    if (!this.#kws || !this.#stream) throw new Error("Sherpa KWS is not initialized.");
    this.#stream.acceptWaveform(sampleRate, samples);

    let hit: SherpaKeywordResult | null = null;
    while (this.#kws.isReady(this.#stream)) {
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
    try {
      this.#stream?.free();
    } finally {
      this.#stream = null;
      this.#kws?.free();
      this.#kws = null;
    }
  }
}

async function installSpanishAssetsIntoVfs(Module: EmscriptenModule, base: string): Promise<void> {
  const createDataFile = Module.FS_createDataFile;
  if (!createDataFile) throw new Error("Sherpa Emscripten filesystem is unavailable.");

  const assets: ReadonlyArray<readonly [string, string]> = [
    [VFS.encoder, `${base}/encoder.onnx`],
    [VFS.decoder, `${base}/decoder.onnx`],
    [VFS.joiner, `${base}/joiner.onnx`],
    [VFS.tokens, `${base}/tokens.txt`],
  ];

  const loaded = await Promise.all(assets.map(async ([vfsPath, url]) => {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
    return [vfsPath, new Uint8Array(await response.arrayBuffer())] as const;
  }));

  for (const [vfsPath, bytes] of loaded) {
    try { Module.FS_unlink?.(vfsPath); } catch { /* file did not exist */ }
    createDataFile("/", vfsPath.slice(1), bytes, true, false, true);
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return await response.text();
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

async function waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Sherpa WASM runtime did not initialize.");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
}
