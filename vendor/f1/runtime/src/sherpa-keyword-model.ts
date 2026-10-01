import type { StreamingWakeModelPort, WakeFrame, WakeModelOutput } from "@cliniqone/wake-detector";
export interface SherpaKeywordResult { readonly keyword: string; readonly confidence?: number; }
export interface SherpaKeywordEngine {
  initialize(): Promise<void>;
  acceptWaveform(samples: Float32Array, sampleRate: number): Promise<SherpaKeywordResult | null> | SherpaKeywordResult | null;
  reset(): void;
  dispose(): Promise<void> | void;
}
export interface SherpaKeywordModelConfig { readonly keyword?: string; readonly hitScore?: number; }
export class SherpaKeywordModel implements StreamingWakeModelPort {
  public readonly inputKind = "pcm-stream" as const;
  readonly #engine: SherpaKeywordEngine; readonly #keyword: string; readonly #hitScore: number;
  constructor(engine: SherpaKeywordEngine, config: SherpaKeywordModelConfig = {}) {
    this.#engine=engine; this.#keyword=normalize(config.keyword ?? "Oye Hana"); this.#hitScore=config.hitScore ?? 1;
  }
  initialize(): Promise<void> { return this.#engine.initialize(); }
  async acceptFrame(frame: WakeFrame): Promise<WakeModelOutput | null> {
    if (frame.sampleRate !== 16000) throw new RangeError(`Sherpa Hana requires 16 kHz PCM; received ${frame.sampleRate}.`);
    const result=await this.#engine.acceptWaveform(frame.samples, frame.sampleRate);
    if (!result || normalize(result.keyword)!==this.#keyword) return null;
    return { score:this.#hitScore, keyword:"oye-hana" };
  }
  reset(): void { this.#engine.reset(); }
  async dispose(): Promise<void> { await this.#engine.dispose(); }
}
function normalize(v:string):string { return v.trim().toLocaleLowerCase("es-MX").replace(/[_\s]+/g," "); }
