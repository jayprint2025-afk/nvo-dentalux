import { F1AudioStateMachine } from "./F1AudioStateMachine";
import type { DisconnectReason, F1AudioSessionControllerOptions, F1AudioSnapshot } from "./types";
import type { F1RealtimeClient } from "./F1RealtimeClient";

export class F1AudioSessionController {
  private readonly sm = new F1AudioStateMachine();
  private realtime: F1RealtimeClient | null = null;
  private enabled = false;
  private detail = "";
  private transcript = "";
  private followupTimer: number | null = null;
  private inactivityTimer: number | null = null;
  private maxSessionTimer: number | null = null;
  private operation: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: F1AudioSessionControllerOptions) { this.emit(); }
  get snapshot(): F1AudioSnapshot { return { state: this.sm.state, detail: this.detail, transcript: this.transcript, enabled: this.enabled, microphoneOwner: this.realtime?.microphoneOwner || (this.sm.state.startsWith("WAKE_") ? "wake" : "none") }; }

  enable(): Promise<void> { this.enabled = true; return this.enqueue(() => this.startWake()); }
  disable(): Promise<void> { this.enabled = false; return this.enqueue(async () => { await this.disconnectRealtime("disabled", false); await this.options.wakeEngine.stop(); this.move("DISABLED", "Motor desactivado"); }); }
  wakeDetected(): Promise<void> { return this.enqueue(async () => {
    if (!this.enabled || this.sm.state !== "WAKE_LISTENING") return;
    this.move("WAKE_DETECTED", "Frase de activación detectada"); this.options.onOpenWidget?.();
    await this.options.wakeEngine.stop();
    await Promise.resolve();
    if (this.options.wakeEngine.currentStatus !== "idle") throw new Error(`Wake Engine no liberó audio: ${this.options.wakeEngine.currentStatus}`);
    await this.connectRealtime();
  }); }
  startManualConversation(): Promise<void> { return this.enqueue(async () => {
    if (this.isRealtimeState()) { await this.disconnectRealtime("manual", true); return; }
    await this.options.wakeEngine.stop(); await this.connectRealtime();
  }); }
  endConversation(): Promise<void> { return this.enqueue(() => this.disconnectRealtime("manual", true)); }

  beginBriefing(): Promise<void> { return this.enqueue(async () => {
    await this.disconnectRealtime("briefing", false);
    await this.options.wakeEngine.stop();
    this.move("BRIEFING_PLAYING", "Reproduciendo briefing");
  }); }
  endBriefing(): Promise<void> { return this.enqueue(async () => {
    if (this.enabled && !this.disposed) await this.startWake(); else this.move("DISABLED", "Motor desactivado");
  }); }

  async playBriefing(play: () => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      await this.disconnectRealtime("briefing", false);
      await this.options.wakeEngine.stop();
      this.move("BRIEFING_PLAYING", "Reproduciendo briefing");
      try { await play(); } catch (error) { this.detail = error instanceof Error ? error.message : String(error); this.move("ERROR", this.detail); }
      finally { if (this.enabled && !this.disposed) await this.startWake(); else this.move("DISABLED", "Motor desactivado"); }
    });
  }

  async dispose(): Promise<void> { this.disposed = true; this.enabled = false; await this.enqueue(async () => { this.clearTimers(); await this.disconnectRealtime("disabled", false); await this.options.wakeEngine.dispose(); this.move("DISABLED", "Controlador liberado"); }); }

  private async startWake(): Promise<void> {
    if (!this.enabled || this.disposed) { this.move("DISABLED", "Motor desactivado"); return; }
    if (this.isRealtimeState() || this.sm.state === "BRIEFING_PLAYING") return;
    this.move("WAKE_STARTING", "Iniciando Wake Engine");
    await this.options.wakeEngine.start();
    if (this.options.wakeEngine.currentStatus === "error") throw new Error("Wake Engine no pudo iniciar");
    this.move("WAKE_LISTENING", "Esperando “Hola F1”");
  }
  private async connectRealtime(): Promise<void> {
    this.clearTimers(); this.move("REALTIME_CONNECTING", "Conectando con F1…");
    const client = this.options.createRealtimeClient(); this.realtime = client;
    try { await client.connect(); this.move("REALTIME_GREETING", "F1 activado…"); this.armMaxSession(); this.armInactivity(); }
    catch (error) { this.detail = error instanceof Error ? error.message : String(error); this.move("ERROR", this.detail); await this.disconnectRealtime("error", true); }
  }
  private async disconnectRealtime(reason: DisconnectReason, restartWake: boolean): Promise<void> {
    this.clearTimers();
    if (this.realtime || this.isRealtimeState() || this.sm.state === "ERROR") this.move("REALTIME_DISCONNECTING", `Cerrando Realtime: ${reason}`);
    const client = this.realtime; this.realtime = null; await client?.close();
    if (restartWake && this.enabled && !this.disposed) await this.startWake(); else if (!this.enabled) this.move("DISABLED", "Motor desactivado");
  }

  onConnected(): void { this.move("REALTIME_GREETING", "F1 activado…"); }
  onGreetingDone(): void { this.transcript = "F1: Te escucho"; this.move("REALTIME_LISTENING", "Escuchando instrucción"); this.armInactivity(); }
  onUserSpeechStarted(): void { this.clearFollowup(); this.move("REALTIME_PROCESSING", "Procesando instrucción"); this.armInactivity(); }
  onUserTranscript(text: string): void { this.transcript = `Tú: ${text}`; this.emit(); this.armInactivity(); }
  onAssistantSpeechStarted(): void { if (this.sm.state !== "REALTIME_GREETING") this.move("REALTIME_SPEAKING", "F1 respondiendo"); this.armInactivity(); }
  onAssistantTranscriptDelta(delta: string): void { this.transcript = this.transcript.startsWith("F1:") ? `${this.transcript}${delta}` : `F1: ${delta}`; this.emit(); }
  onAssistantTranscriptDone(text: string): void { this.transcript = `F1: ${text}`; this.emit(); }
  onResponseDone(): void { this.move("REALTIME_FOLLOWUP", "Esperando seguimiento"); this.armFollowup(); this.armInactivity(); }
  onRealtimeError(error: Error): void { this.detail = error.message; this.move("ERROR", error.message); void this.enqueue(() => this.disconnectRealtime("error", true)); }
  onRealtimeClosed(): void { if (!this.disposed && this.realtime) void this.enqueue(() => this.disconnectRealtime("error", true)); }

  private armFollowup(): void { this.clearFollowup(); this.followupTimer = window.setTimeout(() => { void this.enqueue(() => this.disconnectRealtime("followup-timeout", true)); }, this.options.followupTimeoutMs ?? 6000); }
  private armInactivity(): void { if (this.inactivityTimer != null) window.clearTimeout(this.inactivityTimer); this.inactivityTimer = window.setTimeout(() => { void this.enqueue(() => this.disconnectRealtime("idle-timeout", true)); }, this.options.inactivityTimeoutMs ?? 15000); }
  private armMaxSession(): void { if (this.maxSessionTimer != null) window.clearTimeout(this.maxSessionTimer); this.maxSessionTimer = window.setTimeout(() => { void this.enqueue(() => this.disconnectRealtime("max-session", true)); }, this.options.maxSessionMs ?? 120000); }
  private clearFollowup(): void { if (this.followupTimer != null) window.clearTimeout(this.followupTimer); this.followupTimer = null; }
  private clearTimers(): void { this.clearFollowup(); if (this.inactivityTimer != null) window.clearTimeout(this.inactivityTimer); if (this.maxSessionTimer != null) window.clearTimeout(this.maxSessionTimer); this.inactivityTimer = null; this.maxSessionTimer = null; }
  private isRealtimeState(): boolean { return this.sm.state.startsWith("REALTIME_"); }
  private move(next: Parameters<F1AudioStateMachine["transition"]>[0], detail: string): void { if (this.sm.state !== next) this.sm.transition(next); this.detail = detail; this.emit(); }
  private emit(): void { this.options.onSnapshot(this.snapshot); }
  private enqueue(action: () => Promise<void>): Promise<void> { this.operation = this.operation.then(action, action).catch(error => { this.detail = error instanceof Error ? error.message : String(error); try { this.move("ERROR", this.detail); } catch {} }); return this.operation; }
}
