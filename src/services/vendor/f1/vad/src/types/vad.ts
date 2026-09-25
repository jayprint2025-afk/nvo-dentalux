export type VadState = "idle" | "silence" | "speech";

export interface VadFrame {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly durationMs: number;
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface VadFeatures {
  readonly rms: number;
  readonly dbfs: number;
  readonly zeroCrossingRate: number;
  readonly peak: number;
}

export interface VadDecision {
  readonly isSpeech: boolean;
  readonly confidence: number;
  readonly thresholdDbfs: number;
  readonly noiseFloorDbfs: number;
  readonly features: VadFeatures;
}

export interface VadResult extends VadDecision {
  readonly state: Exclude<VadState, "idle">;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly durationMs: number;
}

export interface VadSegmentBoundary {
  readonly sequence: number;
  readonly timestampMs: number;
  readonly confidence: number;
}

export interface VadConfig {
  readonly speechThresholdDb?: number;
  readonly minimumThresholdDbfs?: number;
  readonly initialNoiseFloorDbfs?: number;
  readonly noiseFloorAdaptation?: number;
  readonly confidenceRangeDb?: number;
  readonly minSpeechFrames?: number;
  readonly minSilenceFrames?: number;
  readonly hangoverFrames?: number;
  readonly maxZeroCrossingRate?: number;
}

export interface VadProcessor {
  readonly state: VadState;
  process(frame: VadFrame): VadResult;
  reset(): void;
}
