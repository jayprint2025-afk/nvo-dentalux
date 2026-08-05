import type { F1VoiceEngineStatus, F1WakeEvent } from "../f1-voice/types";

export type F1AudioState =
  | "DISABLED"
  | "WAKE_STARTING"
  | "WAKE_LISTENING"
  | "WAKE_DETECTED"
  | "REALTIME_CONNECTING"
  | "REALTIME_GREETING"
  | "REALTIME_LISTENING"
  | "REALTIME_PROCESSING"
  | "REALTIME_SPEAKING"
  | "REALTIME_FOLLOWUP"
  | "REALTIME_DISCONNECTING"
  | "BRIEFING_PLAYING"
  | "ERROR";

export type MicrophoneOwner = "none" | "wake" | "realtime";
export type DisconnectReason =
  | "manual"
  | "followup-timeout"
  | "idle-timeout"
  | "max-session"
  | "briefing"
  | "disabled"
  | "error";

export interface WakeEngineAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  readonly currentStatus: F1VoiceEngineStatus;
}

export interface F1AudioSnapshot {
  state: F1AudioState;
  detail: string;
  transcript: string;
  enabled: boolean;
  microphoneOwner: MicrophoneOwner;
}

export interface RealtimeToolCall {
  name: string;
  callId: string;
  argumentsJson: string;
}

export interface RealtimeCallbacks {
  onConnected(): void;
  onGreetingDone(): void;
  onUserSpeechStarted(): void;
  onUserTranscript(text: string): void;
  onAssistantSpeechStarted(): void;
  onRemoteAudioReady?(): void;
  onAssistantTranscriptDelta(delta: string): void;
  onAssistantTranscriptDone(text: string): void;
  onResponseDone(): void;
  onToolCall(call: RealtimeToolCall): Promise<unknown>;
  onError(error: Error): void;
  onClosed(): void;
}

export interface F1RealtimeClientOptions {
  greetingText: string;
  speakerName?: string;
  apiBase: string;
  branchKey: string;
  getToken(): string;
  getRemoteAudioElement(): HTMLAudioElement | null;
  callbacks: RealtimeCallbacks;
}

export interface F1AudioSessionControllerOptions {
  wakeEngine: WakeEngineAdapter;
  verifyWakeIdentity?(event: WakeActivation): Promise<{
    accepted: boolean;
    displayName?: string;
    similarity?: number;
    requiredSimilarity?: number;
  }>;
  createRealtimeClient(context: {
    greetingText: string;
    speakerName?: string;
  }): import("./F1RealtimeClient").F1RealtimeClient;
  onSnapshot(snapshot: F1AudioSnapshot): void;
  onOpenWidget?(): void;
  followupTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  maxSessionMs?: number;
  wakeStabilizationMs?: number;
  minimumWakeConfidence?: number;
}

export type WakeActivation = Pick<F1WakeEvent, "confidence" | "detectedAt" | "audioWindow" | "sampleRate">;
