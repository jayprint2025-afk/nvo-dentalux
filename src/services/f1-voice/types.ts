export type F1WakeEvent = {
  phrase: string;
  confidence: number;
  detectedAt: number;
};

export type F1VoiceEngineStatus =
  | "idle"
  | "starting"
  | "listening"
  | "paused"
  | "unsupported"
  | "model-missing"
  | "error";

export type F1VoiceEngineOptions = {
  phrase?: string;
  threshold?: number;
  consecutiveHits?: number;
  cooldownMs?: number;
  modelUrl?: string;
  workletUrl?: string;
  onWake?: (event: F1WakeEvent) => void;
  onStatus?: (status: F1VoiceEngineStatus, detail?: string) => void;
};

export interface F1WakeDetector {
  readonly ready: boolean;
  load(modelUrl: string): Promise<void>;
  score(frame: Float32Array, sampleRate: number): Promise<number>;
  dispose(): Promise<void> | void;
}
