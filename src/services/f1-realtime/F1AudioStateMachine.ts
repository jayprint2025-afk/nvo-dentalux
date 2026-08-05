import type { F1AudioState } from "./types";

const ALLOWED: Record<F1AudioState, ReadonlySet<F1AudioState>> = {
  DISABLED: new Set(["WAKE_STARTING", "REALTIME_CONNECTING", "BRIEFING_PLAYING"]),
  WAKE_STARTING: new Set(["WAKE_LISTENING", "DISABLED", "ERROR", "BRIEFING_PLAYING"]),
  WAKE_LISTENING: new Set(["WAKE_DETECTED", "DISABLED", "BRIEFING_PLAYING", "ERROR"]),
  WAKE_DETECTED: new Set(["REALTIME_CONNECTING", "DISABLED", "ERROR"]),
  REALTIME_CONNECTING: new Set(["REALTIME_GREETING", "REALTIME_DISCONNECTING", "ERROR"]),
  REALTIME_GREETING: new Set(["REALTIME_LISTENING", "REALTIME_DISCONNECTING", "ERROR"]),
  REALTIME_LISTENING: new Set(["REALTIME_PROCESSING", "REALTIME_DISCONNECTING", "ERROR"]),
  REALTIME_PROCESSING: new Set(["REALTIME_SPEAKING", "REALTIME_LISTENING", "REALTIME_DISCONNECTING", "ERROR"]),
  REALTIME_SPEAKING: new Set(["REALTIME_FOLLOWUP", "REALTIME_DISCONNECTING", "ERROR"]),
  REALTIME_FOLLOWUP: new Set(["REALTIME_PROCESSING", "REALTIME_LISTENING", "REALTIME_DISCONNECTING", "ERROR"]),
  REALTIME_DISCONNECTING: new Set(["WAKE_STARTING", "DISABLED", "BRIEFING_PLAYING", "ERROR"]),
  BRIEFING_PLAYING: new Set(["WAKE_STARTING", "DISABLED", "ERROR"]),
  ERROR: new Set(["REALTIME_DISCONNECTING", "WAKE_STARTING", "DISABLED"]),
};

export class F1AudioStateMachine {
  private current: F1AudioState = "DISABLED";
  get state(): F1AudioState { return this.current; }
  canTransition(next: F1AudioState): boolean { return next === this.current || ALLOWED[this.current].has(next); }
  transition(next: F1AudioState): F1AudioState {
    if (!this.canTransition(next)) throw new Error(`Transición F1 inválida: ${this.current} → ${next}`);
    this.current = next;
    return this.current;
  }
}
