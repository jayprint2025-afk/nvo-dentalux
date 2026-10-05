import type { SherpaKeywordEngine, SherpaKeywordResult } from "./sherpa-keyword-model.js";

type SherpaStream = {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
};

type SherpaKws = {
  createStream(): SherpaStream;
  isReady(stream: SherpaStream): boolean;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { keyword?: string; text?: string; tokens?: string[]; timestamps?: number[] };
  reset(stream: SherpaStream): void;
  free(): void;
};

declare global {
  interface Window {
    Module?: any;
    createKws?: (module: any, config: any) => SherpaKws;
    __hanaSherpaModule?: any;
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
  #pcmDiagFrames = 0;

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

    // Emscripten signals the only reliable "runtime is usable" point through
    // onRuntimeInitialized. Install the callback BEFORE loading the generated
    // main script; polling FS/_malloc can observe a half-initialized Module.
    let runtimeResolve!: () => void;
    let runtimeReject!: (reason: unknown) => void;
    const runtimeReady = new Promise<void>((resolve, reject) => {
      runtimeResolve = resolve;
      runtimeReject = reject;
    });

    const previousRuntimeInitialized = previous.onRuntimeInitialized;
    const previousAbort = previous.onAbort;

    const sharedModule: any = previous;
    Object.assign(sharedModule, {
      locateFile: (path: string) => {
        const fileName = path.split("/").pop() || path;
        return `${assetBase}${fileName}`;
      },
      onRuntimeInitialized: () => {
        window.__hanaSherpaModule = sharedModule;
        (globalThis as any).__hanaSherpaModule = sharedModule;
        try {
          if (typeof previousRuntimeInitialized === "function") {
            previousRuntimeInitialized();
          }
        } finally {
          runtimeResolve();
        }
      },
      onAbort: (reason: unknown) => {
        try {
          if (typeof previousAbort === "function") previousAbort(reason);
        } finally {
          runtimeReject(new Error(`Sherpa WASM aborted: ${formatError(reason)}`));
        }
      },
    });
    window.Module = sharedModule;
    (globalThis as any).Module = sharedModule;
    (globalThis as any).__hanaSherpaModule = sharedModule;

    try {
      // sherpa-onnx-kws.js defines createKws(); the generated Emscripten main
      // script starts the WASM runtime and eventually fires onRuntimeInitialized.
      await loadScript(`${this.#base}/sherpa-onnx-kws.js`);
      await loadScript(`${this.#base}/sherpa-onnx-wasm-kws-main.js`);

      // If the runtime was already initialized by an earlier script instance,
      // do not wait for a callback that will never fire again.
      if (isRuntimeReady(window.Module)) runtimeResolve();

      await withTimeout(
        runtimeReady,
        30000,
        "Sherpa WASM runtime did not initialize. Check .wasm/.data assets, CSP and locateFile paths.",
      );

      await waitFor(
        () => Boolean(resolveCreateKws() && resolveSherpaModule()),
        10000,
        "Sherpa runtime initialized but createKws/FS is unavailable.",
      );

      const createKws = resolveCreateKws();
      const module = resolveSherpaModule();
      if (!createKws || !module) {
        console.error("[HANA SHERPA] GLOBALS_MISSING", {
          windowCreateKws: typeof window.createKws,
          globalCreateKws: typeof (globalThis as any).createKws,
          windowModule: describeModule(window.Module),
          sharedModule: describeModule((globalThis as any).__hanaSherpaModule),
        });
        throw new Error("Sherpa browser globals are unavailable after runtime initialization.");
      }
      const FS = module.FS;

      ensureDir(FS, VFS_DIR);

      // Sherpa native code cannot read browser URLs. Mount every model asset in
      // Emscripten's VFS and pass native paths to createKws().
      await Promise.all([
        mountBinary(FS, `${this.#base}/encoder.onnx`, `${VFS_DIR}/encoder.onnx`),
        mountBinary(FS, `${this.#base}/decoder.onnx`, `${VFS_DIR}/decoder.onnx`),
        mountBinary(FS, `${this.#base}/joiner.onnx`, `${VFS_DIR}/joiner.onnx`),
        mountBinary(FS, `${this.#base}/tokens.txt`, `${VFS_DIR}/tokens.txt`),
      ]);

      const configuredKeywords =
        (this.#keywordSpec ?? await fetchText(`${this.#base}/keywords.txt`)).trim();
      if (!configuredKeywords) throw new Error("Hana keywords.txt is empty.");

      // V38 PROFESSIONAL WAKE:
      // Only the complete phrase from keywords.txt can trigger. Partial
      // diagnostic keywords are deliberately excluded to protect against
      // false positives while making the full phrase easier to detect.
      // V42 ONE-SHOT: keep the canonical trained phrase and add the common
      // "Hanna" tokenization as an alias to the SAME wake tag. Neither "oye"
      // nor "hana" alone is a valid keyword.
      const normalizeKeywordLine = (line: string) => {
        const clean = line.replace(/\s+:[0-9.]+/g, "").replace(/\s+#[0-9.]+/g, "").trim();
        return `${clean} :6.0 #0.05`;
      };
      const keywordLines = [
        normalizeKeywordLine(configuredKeywords),
        normalizeKeywordLine("▁o ye ▁ha n na @oye_hana"),
      ];
      const keywords = [...new Set(keywordLines)].join("\n");

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
          debug: 1,
          modelingUnit: "bpe",
          bpeVocab: "",
        },
        maxActivePaths: 24,
        numTrailingBlanks: 1,
        // V49: sensitive one-shot full-phrase KWS without the ultra-low 0.001 false-wake setting.
        // The WASM-KWS build parses `keywords` directly as keyword text.
        keywordsScore: Math.max(this.#score, 6.0),
        keywordsThreshold: Math.min(this.#threshold, 0.05),
        keywords: `${keywords}\n`,
        keywordsBuf: "",
        keywordsBufSize: 0,
      };

      const kws = createKws(module, config);
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
      console.info("[HANA SHERPA] READY", {
        base: this.#base,
        vfs: VFS_DIR,
        keywords,
        keywordTransport: "wasm-keywords-text",
        keywordsScore: Math.max(this.#score, 6.0),
        keywordsThreshold: Math.min(this.#threshold, 0.05),
      });
    } catch (cause) {
      const detail = formatError(cause);
      console.error("[HANA SHERPA] INIT_FAILED", cause, detail);
      throw new Error(`Hana Sherpa initialization failed: ${detail}`);
    }
  }

  async acceptWaveform(samples: Float32Array, sampleRate: number): Promise<SherpaKeywordResult | null> {
    if (!this.#kws || !this.#stream) throw new Error("Sherpa KWS is not initialized.");

    // Diagnostic only: measure the exact normalized PCM entering Sherpa.
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const v = Number(samples[i]) || 0;
      sumSq += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = samples.length ? Math.sqrt(sumSq / samples.length) : 0;
    this.#pcmDiagFrames += 1;
    if (this.#pcmDiagFrames <= 5 || this.#pcmDiagFrames % 10 === 0) {
      console.info("[HANA SHERPA PCM]", {
        frame: this.#pcmDiagFrames,
        sampleRate,
        samples: samples.length,
        rms: Number(rms.toFixed(6)),
        peak: Number(peak.toFixed(6)),
      });
    }

    this.#stream.acceptWaveform(sampleRate, samples);

    let hit: SherpaKeywordResult | null = null;
    let guard = 0;
    while (this.#kws.isReady(this.#stream)) {
      // Protect the UI from a malformed runtime that never clears isReady().
      if (++guard > 128) throw new Error("Sherpa KWS decode loop exceeded safety limit.");
      this.#kws.decode(this.#stream);
      const result = this.#kws.getResult(this.#stream);
      const keyword = (result.keyword ?? result.text ?? "").trim();

      if (keyword) {
        console.info("[HANA SHERPA] KEYWORD", {
          keyword,
          raw: result,
          tokens: result.tokens ?? [],
          timestamps: result.timestamps ?? [],
        });
        hit = { keyword: keyword.replace(/_/g, " ") };

        // V48: leave the decode loop before replacing the Sherpa stream.
        break;
      }

      // Only log partial decoder activity; avoid flooding the console with empty results.
      if (Array.isArray(result.tokens) && result.tokens.length > 0) {
        console.debug("[HANA SHERPA] PARTIAL", {
          tokens: result.tokens,
          timestamps: result.timestamps ?? [],
        });
      }
    }

    if (hit) {
      this.#hardRearmStream("wake-detected");
    }

    return hit;
  }

  // V48: keep the loaded KWS/model, but replace its stream after each wake.
  #hardRearmStream(reason: string): void {
    const kws = this.#kws;
    const oldStream = this.#stream;
    if (!kws || !oldStream) return;

    console.info("[HANA SHERPA] HARD_REARM_BEGIN", { reason });
    this.#stream = null;

    try {
      try {
        kws.reset(oldStream);
      } catch (cause) {
        console.warn("[HANA SHERPA] HARD_REARM_RESET_WARN", {
          reason,
          error: formatError(cause),
        });
      }

      try {
        oldStream.free();
        console.info("[HANA SHERPA] OLD_STREAM_FREED", { reason });
      } catch (cause) {
        console.warn("[HANA SHERPA] HARD_REARM_FREE_WARN", {
          reason,
          error: formatError(cause),
        });
      }

      const newStream = kws.createStream();
      if (!newStream || typeof newStream.acceptWaveform !== "function") {
        throw new Error("Sherpa KWS failed to create a replacement stream.");
      }

      this.#stream = newStream;
      console.info("[HANA SHERPA] NEW_STREAM_CREATED", { reason });
      console.info("[HANA SHERPA] HARD_REARM_OK", { reason });
    } catch (cause) {
      console.error("[HANA SHERPA] HARD_REARM_FAILED", {
        reason,
        error: formatError(cause),
      });
      throw cause;
    }
  }

  reset(): void {
    if (!this.#kws || !this.#stream) return;
    this.#kws.reset(this.#stream);
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

const scriptLoads = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const absolute = new URL(src, location.href).href;
  const pending = scriptLoads.get(absolute);
  if (pending) return pending;

  const existing = [...document.scripts].find((script) => script.src === absolute);
  if (existing?.dataset.hanaLoaded === "1") return Promise.resolve();

  const promise = new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      script.dataset.hanaLoaded = "1";
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      scriptLoads.delete(absolute);
      reject(new Error(`Unable to load ${src}`));
    };
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    if (!existing) {
      script.src = src;
      script.async = false;
      document.head.appendChild(script);
    }
  });

  scriptLoads.set(absolute, promise);
  return promise;
}

function isRuntimeReady(module: any): boolean {
  return Boolean(
    module &&
    module.FS &&
    typeof module.FS.writeFile === "function" &&
    typeof module._malloc === "function" &&
    module.HEAPF32
  );
}


function resolveCreateKws(): ((module: any, config: any) => SherpaKws) | null {
  const candidate = window.createKws ?? (globalThis as any).createKws ?? (globalThis as any).__hanaCreateKws;
  return typeof candidate === "function" ? candidate : null;
}

function resolveSherpaModule(): any | null {
  const candidates = [
    (globalThis as any).__hanaSherpaModule,
    window.__hanaSherpaModule,
    window.Module,
    (globalThis as any).Module,
  ];
  for (const candidate of candidates) {
    if (isRuntimeReady(candidate)) return candidate;
  }
  return null;
}

function describeModule(module: any): Record<string, unknown> {
  return {
    exists: Boolean(module),
    hasFS: Boolean(module?.FS),
    hasWriteFile: typeof module?.FS?.writeFile === "function",
    hasMalloc: typeof module?._malloc === "function",
    hasHeapF32: Boolean(module?.HEAPF32),
    calledRun: module?.calledRun,
  };
}

function formatError(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
