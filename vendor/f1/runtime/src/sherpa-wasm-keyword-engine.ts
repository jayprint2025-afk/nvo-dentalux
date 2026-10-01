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

export class SherpaWasmKeywordEngine implements SherpaKeywordEngine {
  readonly #base: string;
  readonly #score: number;
  readonly #threshold: number;
  readonly #keywordSpec?: string;
  #kws: SherpaKws | null = null;
  #stream: SherpaStream | null = null;

  constructor(config: SherpaWasmKeywordEngineConfig = {}) {
    this.#base=(config.assetBaseUrl ?? "/models/sherpa-hana").replace(/\/$/, "");
    this.#score=config.keywordsScore ?? 1.0;
    this.#threshold=config.keywordsThreshold ?? 0.20;
    this.#keywordSpec=config.keywordSpec;
  }

  async initialize(): Promise<void> {
    await loadScript(`${this.#base}/sherpa-onnx-kws.js`);
    await loadScript(`${this.#base}/sherpa-onnx-wasm-kws-main.js`);
    await waitFor(() => Boolean(window.Module && window.createKws), 30000);

    const keywords = this.#keywordSpec ?? await fetchText(`${this.#base}/keywords.txt`);
    const config = {
      featConfig: { samplingRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: "./encoder-epoch-12-avg-2-chunk-16-left-64.onnx",
          decoder: "./decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
          joiner: "./joiner-epoch-12-avg-2-chunk-16-left-64.onnx",
        },
        tokens: "./tokens.txt",
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
      // WASM KWS parses this field as the keyword content.
      keywords,
    };

    this.#kws=window.createKws!(window.Module, config);
    this.#stream=this.#kws.createStream();
  }

  async acceptWaveform(samples: Float32Array, sampleRate: number): Promise<SherpaKeywordResult | null> {
    if (!this.#kws || !this.#stream) throw new Error("Sherpa KWS is not initialized.");
    this.#stream.acceptWaveform(sampleRate, samples);
    let hit: SherpaKeywordResult | null=null;
    while (this.#kws.isReady(this.#stream)) {
      this.#kws.decode(this.#stream);
      const r=this.#kws.getResult(this.#stream);
      const keyword=(r.keyword ?? r.text ?? "").trim();
      if (keyword) hit={keyword: keyword.replace(/_/g, " ")};
    }
    return hit;
  }

  reset(): void {
    if (this.#kws && this.#stream) this.#kws.reset(this.#stream);
  }

  async dispose(): Promise<void> {
    try { this.#stream?.free(); } finally {
      this.#stream=null;
      this.#kws?.free();
      this.#kws=null;
    }
  }
}

async function fetchText(url:string):Promise<string> {
  const r=await fetch(url);
  if(!r.ok) throw new Error(`Unable to load ${url}: ${r.status}`);
  return await r.text();
}
function loadScript(src:string):Promise<void> {
  if ([...document.scripts].some(s=>s.src===new URL(src,location.href).href)) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script"); s.src=src; s.async=false;
    s.onload=()=>resolve(); s.onerror=()=>reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });
}
async function waitFor(fn:()=>boolean, timeoutMs:number):Promise<void> {
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){ if(fn()) return; await new Promise(r=>setTimeout(r,50)); }
  throw new Error("Sherpa WASM runtime did not initialize.");
}
