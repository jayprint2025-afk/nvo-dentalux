import type { AudioEngineError } from "./errors.js";
import type { AudioEngineState, AudioFrame } from "./audio.js";

export interface AudioEngineEventMap {
  readonly frame: AudioFrame;
  readonly statechange: {
    readonly previous: AudioEngineState;
    readonly current: AudioEngineState;
  };
  readonly error: AudioEngineError;
}
