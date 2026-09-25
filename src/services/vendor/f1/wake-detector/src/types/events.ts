import type { WakeDetectorState, WakeEvent, WakeScore } from "./wake.js";

export interface WakeStateChange {
  readonly previous: WakeDetectorState;
  readonly current: WakeDetectorState;
}

export interface WakeDetectorError {
  readonly code: "MODEL_INITIALIZATION_FAILED" | "MODEL_INFERENCE_FAILED" | "INVALID_FRAME";
  readonly message: string;
  readonly cause?: unknown;
}

export interface WakeEventMap extends Record<string, unknown> {
  readonly wake: WakeEvent;
  readonly score: WakeScore;
  readonly statechange: WakeStateChange;
  readonly error: WakeDetectorError;
}
