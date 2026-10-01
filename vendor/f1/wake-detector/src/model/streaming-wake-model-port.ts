import type { WakeFrame, WakeModelOutput } from "../types/wake.js";
export interface StreamingWakeModelPort {
  readonly inputKind: "pcm-stream";
  initialize(): Promise<void>;
  acceptFrame(frame: WakeFrame): Promise<WakeModelOutput | null>;
  reset(): void;
  dispose(): Promise<void>;
}
export function isStreamingWakeModelPort(value: unknown): value is StreamingWakeModelPort {
  return typeof value === "object" && value !== null &&
    (value as { inputKind?: unknown }).inputKind === "pcm-stream";
}
