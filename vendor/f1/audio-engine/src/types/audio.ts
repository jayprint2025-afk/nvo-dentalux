export type AudioEngineState = "idle" | "starting" | "running" | "stopping" | "failed";

export interface CapturedAudioChunk {
  readonly channels: readonly Float32Array[];
  readonly sampleRate: number;
  readonly timestampMs: number;
}

export interface AudioFrame {
  readonly samples: Float32Array;
  readonly sampleRate: 16_000;
  readonly durationMs: 80;
  readonly sequence: number;
  readonly timestampMs: number;
}

export interface AudioEngineConfig {
  readonly targetSampleRate?: 16_000;
  readonly frameDurationMs?: 80;
  readonly capture?: AudioCapturePort;
}

export interface AudioCaptureCallbacks {
  readonly onChunk: (chunk: CapturedAudioChunk) => void;
  readonly onError: (error: unknown) => void;
}

export interface AudioCapturePort {
  start(callbacks: AudioCaptureCallbacks): Promise<void>;
  stop(): Promise<void>;
}
