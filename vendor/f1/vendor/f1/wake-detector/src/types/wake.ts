export type WakeDetectorState = "idle" | "ready" | "cooldown" | "failed" | "disposed";

export interface WakeFrame {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly durationMs: number;
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface WakeSignal {
  readonly isSpeech?: boolean;
  readonly vadConfidence?: number;
}

export interface WakeFeatures {
  readonly values: Float32Array;
  readonly frameSequence: number;
  readonly timestampMs: number;
}

export interface WakeModelInput {
  readonly data: Float32Array;
  readonly shape: readonly [1, number, number];
  readonly sampleRate: number;
}

export interface WakeModelOutput {
  readonly score: number;
  readonly keyword?: string;
}

export interface WakeScore {
  readonly score: number;
  readonly keyword?: string;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly threshold: number;
  readonly detected: boolean;
}

export interface WakeEvent extends WakeScore {
  readonly cooldownFrames: number;
  /** Exact PCM window that produced this wake decision. 16 kHz mono. */
  readonly audioWindow: Float32Array;
  readonly sampleRate: number;
}

export interface WakeProcessResult {
  readonly status: "warming" | "gated" | "scored" | "cooldown";
  readonly sequence: number;
  readonly timestampMs: number;
  readonly score?: number;
  readonly detected: boolean;
}

export interface WakeDetectorConfig {
  readonly featureBands?: number;
  readonly windowFrames?: number;
  readonly detectionThreshold?: number;
  /** A single score at/above this value wakes immediately. */
  readonly strongDetectionThreshold?: number;
  /** Minimum VAD confidence required before the wake model is allowed to score. */
  readonly minimumVadConfidence?: number;
  readonly consecutiveHits?: number;
  readonly cooldownFrames?: number;
  readonly maxSilentFramesBeforeReset?: number;
  readonly expectedSampleRate?: number;
  readonly preEmphasis?: number;
  readonly captureWindowFrames?: number;
}

export interface WakeDetectorProcessor {
  readonly state: WakeDetectorState;
  start(): Promise<void>;
  process(frame: WakeFrame, signal?: WakeSignal): Promise<WakeProcessResult>;
  reset(): void;
  /** Temporarily reject all wake candidates, useful immediately after deactivation. */
  suppressFor(durationMs: number): void;
  dispose(): Promise<void>;
}
