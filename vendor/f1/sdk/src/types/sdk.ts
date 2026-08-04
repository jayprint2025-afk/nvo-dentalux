import type { AudioFrame } from "@cliniqone/audio-engine";
import type { VadConfig, VadResult } from "@cliniqone/vad";
import type { WakeDetectorConfig, WakeEvent, WakeModelPort, WakeProcessResult, WakeScore } from "@cliniqone/wake-detector";

export type F1VoiceEngineState = "idle" | "starting" | "running" | "paused" | "stopping" | "failed" | "disposed";

export interface F1VoiceEngineConfig {
  readonly vad?: VadConfig;
  readonly wakeDetector?: WakeDetectorConfig;
  readonly diagnostics?: boolean;
}

export interface F1VoiceEngineDependencies {
  readonly wakeModel: WakeModelPort;
  readonly audio?: AudioPort;
  readonly vad?: VadPort;
  readonly wakeDetector?: WakeDetectorPort;
  readonly logger?: LoggerPort;
  readonly clock?: ClockPort;
}

export interface AudioPort {
  readonly state: string;
  on(event: "frame", listener: (frame: AudioFrame) => void): () => void;
  on(event: "error", listener: (error: unknown) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface VadPort {
  readonly state: string;
  process(frame: AudioFrame): VadResult;
  reset(): void;
}

export interface WakeDetectorPort {
  readonly state: string;
  on(event: "wake", listener: (event: WakeEvent) => void): () => void;
  on(event: "score", listener: (event: WakeScore) => void): () => void;
  on(event: "error", listener: (error: unknown) => void): () => void;
  start(): Promise<void>;
  process(frame: AudioFrame, signal?: { readonly isSpeech?: boolean; readonly vadConfidence?: number }): Promise<WakeProcessResult>;
  reset(): void;
  dispose(): Promise<void>;
}

export interface LoggerPort {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface ClockPort { now(): number; }

export interface EngineDiagnostics {
  readonly framesReceived: number;
  readonly speechFrames: number;
  readonly inferenceCount: number;
  readonly wakeCount: number;
  readonly processingErrors: number;
  readonly startedAtMs?: number;
  readonly uptimeMs: number;
}
