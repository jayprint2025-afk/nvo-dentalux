import type { AudioFrame } from "@cliniqone/audio-engine";
import type { VadResult } from "@cliniqone/vad";
import type { WakeEvent, WakeScore } from "@cliniqone/wake-detector";
import type { EngineDiagnostics, F1VoiceEngineState } from "./sdk.js";

export interface F1VoiceEngineError {
  readonly code: "INITIALIZATION_FAILED" | "AUDIO_PIPELINE_FAILED" | "PROCESSING_FAILED" | "DISPOSED";
  readonly message: string;
  readonly cause?: unknown;
}
export interface F1VoiceEngineEventMap extends Record<string, unknown> {
  readonly wake: WakeEvent;
  readonly score: WakeScore;
  readonly frame: AudioFrame;
  readonly vad: VadResult;
  readonly statechange: { readonly previous: F1VoiceEngineState; readonly current: F1VoiceEngineState };
  readonly diagnostics: EngineDiagnostics;
  readonly error: F1VoiceEngineError;
}
