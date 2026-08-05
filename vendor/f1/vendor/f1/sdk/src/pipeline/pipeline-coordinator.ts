import type { AudioFrame } from "@cliniqone/audio-engine";
import type { VadResult } from "@cliniqone/vad";
import type { WakeProcessResult } from "@cliniqone/wake-detector";
import type { LoggerPort, VadPort, WakeDetectorPort } from "../types/sdk.js";

export interface PipelineResult { readonly vad: VadResult; readonly wake: WakeProcessResult; }
export class PipelineCoordinator {
  readonly #vad: VadPort;
  readonly #wake: WakeDetectorPort;
  readonly #logger: LoggerPort;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(vad: VadPort, wake: WakeDetectorPort, logger: LoggerPort) {
    this.#vad = vad;
    this.#wake = wake;
    this.#logger = logger;
  }
  process(frame:AudioFrame):Promise<PipelineResult>{
    const op=this.#queue.then(async()=>{
      const vad=this.#vad.process(frame);
      const wake=await this.#wake.process(frame,{isSpeech:vad.isSpeech,vadConfidence:vad.confidence});
      return {vad,wake};
    });
    this.#queue=op.catch((cause)=>{this.#logger.error("Voice pipeline frame processing failed.",{cause});});
    return op;
  }
  async drain():Promise<void>{await this.#queue;}
  reset():void{this.#vad.reset();this.#wake.reset();}
}
