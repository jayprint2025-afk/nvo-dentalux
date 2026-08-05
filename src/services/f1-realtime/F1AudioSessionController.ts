import { F1AudioStateMachine } from "./F1AudioStateMachine";
import type {
  DisconnectReason,
  F1AudioSessionControllerOptions,
  F1AudioSnapshot,
  WakeActivation,
} from "./types";
import type { F1RealtimeClient } from "./F1RealtimeClient";

export class F1AudioSessionController {
  private readonly sm = new F1AudioStateMachine();
  private realtime: F1RealtimeClient | null = null;
  private enabled = false;
  private disposed = false;
  private detail = "";
  private transcript = "";
  private operation: Promise<void> = Promise.resolve();
  private wakeAcceptAfter = 0;
  private sessionGeneration = 0;

  private followupTimer: number | null = null;
  private inactivityTimer: number | null = null;
  private greetingTimer: number | null = null;
  private maxSessionTimer: number | null = null;

  constructor(private readonly options: F1AudioSessionControllerOptions) {
    this.emit();
  }

  get snapshot(): F1AudioSnapshot {
    return {
      state: this.sm.state,
      detail: this.detail,
      transcript: this.transcript,
      enabled: this.enabled,
      microphoneOwner:
        this.realtime?.microphoneOwner ??
        (this.sm.state === "WAKE_STARTING" || this.sm.state === "WAKE_LISTENING"
          ? "wake"
          : "none"),
    };
  }

  enable(): Promise<void> {
    this.enabled = true;
    return this.enqueue(async () => {
      if (this.sm.state === "WAKE_LISTENING" || this.sm.state === "WAKE_STARTING") return;
      await this.startWake("Motor activado");
    });
  }

  disable(): Promise<void> {
    this.enabled = false;
    return this.enqueue(async () => {
      this.clearTimers();
      await this.closeRealtimeOnly("disabled");
      await this.options.wakeEngine.stop();
      this.move("DISABLED", "Motor desactivado");
    });
  }

  wakeDetected(event?: WakeActivation): Promise<void> {
    return this.enqueue(async () => {
      // Única puerta automática a Realtime.
      if (!this.enabled || this.sm.state !== "WAKE_LISTENING") return;
      if (Date.now() < this.wakeAcceptAfter) return;
      if (event && event.confidence < 0.55) return;

      this.wakeAcceptAfter = Number.POSITIVE_INFINITY;
      this.move("WAKE_DETECTED", "Hola F1 detectado");
      this.options.onOpenWidget?.();

      await this.stopWakeAndVerify();
      await this.openRealtime();
    });
  }

  startManualConversation(): Promise<void> {
    return this.enqueue(async () => {
      if (this.isRealtimeState()) {
        await this.finishConversation("manual");
        return;
      }
      if (this.sm.state === "BRIEFING_PLAYING") return;

      await this.options.wakeEngine.stop();
      if (this.sm.state === "WAKE_LISTENING") {
        this.move("WAKE_DETECTED", "Conversación iniciada manualmente");
      }
      await this.openRealtime(true);
    });
  }

  endConversation(): Promise<void> {
    return this.enqueue(() => this.finishConversation("manual"));
  }

  beginBriefing(): Promise<void> {
    return this.enqueue(async () => {
      this.clearTimers();
      await this.closeRealtimeOnly("briefing");
      await this.options.wakeEngine.stop();
      this.move("BRIEFING_PLAYING", "Reproduciendo briefing");
    });
  }

  endBriefing(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled || this.disposed) {
        this.move("DISABLED", "Motor desactivado");
        return;
      }
      await this.startWake("Briefing finalizado");
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.enabled = false;
    await this.enqueue(async () => {
      this.clearTimers();
      await this.closeRealtimeOnly("disabled");
      await this.options.wakeEngine.dispose();
      this.move("DISABLED", "Controlador liberado");
    });
  }

  onConnected(): void {
    if (this.sm.state === "REALTIME_CONNECTING") {
      this.move("REALTIME_GREETING", "F1 diciendo “Te escucho”");
    }
  }

  onGreetingDone(): void {
    if (this.sm.state !== "REALTIME_GREETING") return;
    this.clearGreetingTimer();
    this.transcript = "F1: Te escucho";
    this.move("REALTIME_LISTENING", "Escuchando instrucción");
    this.armInactivity();
  }

  onUserSpeechStarted(): void {
    if (
      this.sm.state !== "REALTIME_LISTENING" &&
      this.sm.state !== "REALTIME_FOLLOWUP"
    ) return;

    this.clearFollowupTimer();
    this.move("REALTIME_PROCESSING", "Procesando instrucción");
    this.armInactivity();
  }

  onUserTranscript(text: string): void {
    this.transcript = `Tú: ${text}`;
    this.emit();
    this.armInactivity();
  }

  onAssistantSpeechStarted(): void {
    if (this.sm.state === "REALTIME_GREETING") return;
    if (
      this.sm.state === "REALTIME_PROCESSING" ||
      this.sm.state === "REALTIME_LISTENING"
    ) {
      this.move("REALTIME_SPEAKING", "F1 respondiendo");
    }
    this.armInactivity();
  }

  onAssistantTranscriptDelta(delta: string): void {
    this.transcript = this.transcript.startsWith("F1:")
      ? `${this.transcript}${delta}`
      : `F1: ${delta}`;
    this.emit();
  }

  onAssistantTranscriptDone(text: string): void {
    this.transcript = `F1: ${text}`;
    this.emit();
  }

  onResponseDone(): void {
    if (this.sm.state === "REALTIME_GREETING") return;
    if (!this.isRealtimeState()) return;

    if (this.sm.state !== "REALTIME_FOLLOWUP") {
      this.move("REALTIME_FOLLOWUP", "Esperando otra instrucción");
    }
    this.armFollowup();
    this.armInactivity();
  }

  onRealtimeError(error: Error): void {
    this.detail = error.message;
    if (this.sm.state !== "ERROR") this.move("ERROR", error.message);
    void this.enqueue(() => this.finishConversation("error"));
  }

  onRealtimeClosed(): void {
    // onClosed puede ocurrir como consecuencia de close() propio. Solo se
    // procesa si todavía existe una sesión activa en el controlador.
    if (!this.disposed && this.realtime) {
      void this.enqueue(() => this.finishConversation("error"));
    }
  }

  private async openRealtime(manual = false): Promise<void> {
    if (!manual && this.sm.state !== "WAKE_DETECTED") return;
    if (this.realtime || this.isRealtimeState()) return;

    this.clearTimers();
    this.sessionGeneration += 1;
    this.move("REALTIME_CONNECTING", "Conectando con F1");

    const client = this.options.createRealtimeClient();
    this.realtime = client;

    try {
      await client.connect();
      if (this.sm.state === "REALTIME_CONNECTING") {
        this.move("REALTIME_GREETING", "F1 diciendo “Te escucho”");
      }
      this.armGreetingTimeout();
      this.armMaxSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.detail = message;
      this.move("ERROR", message);
      await this.finishConversation("error");
    }
  }

  private async finishConversation(reason: DisconnectReason): Promise<void> {
    this.clearTimers();

    if (this.realtime || this.isRealtimeState() || this.sm.state === "ERROR") {
      if (this.sm.state !== "REALTIME_DISCONNECTING") {
        this.move("REALTIME_DISCONNECTING", `Cerrando Realtime: ${reason}`);
      }
    }

    await this.closeRealtimeOnly(reason);
    this.transcript = "";

    if (this.enabled && !this.disposed) {
      await this.startWake("Conversación finalizada");
    } else {
      this.move("DISABLED", "Motor desactivado");
    }
  }

  private async closeRealtimeOnly(_reason: DisconnectReason): Promise<void> {
    const client = this.realtime;
    this.realtime = null;
    await client?.close();
  }

  private async startWake(detail: string): Promise<void> {
    if (!this.enabled || this.disposed) {
      this.move("DISABLED", "Motor desactivado");
      return;
    }

    if (this.realtime || this.isRealtimeState()) {
      throw new Error("No se puede iniciar Wake mientras Realtime está activo");
    }

    if (this.sm.state !== "WAKE_STARTING") {
      this.move("WAKE_STARTING", detail);
    }

    await this.options.wakeEngine.start();
    if (this.options.wakeEngine.currentStatus !== "listening") {
      throw new Error(
        `Wake Engine no quedó escuchando: ${this.options.wakeEngine.currentStatus}`,
      );
    }

    this.wakeAcceptAfter =
      Date.now() + (this.options.wakeStabilizationMs ?? 2500);
    this.move("WAKE_LISTENING", "Esperando “Hola F1”");
  }

  private async stopWakeAndVerify(): Promise<void> {
    await this.options.wakeEngine.stop();
    await Promise.resolve();

    if (this.options.wakeEngine.currentStatus !== "idle") {
      throw new Error(
        `Wake Engine no liberó el micrófono: ${this.options.wakeEngine.currentStatus}`,
      );
    }
  }

  private armGreetingTimeout(): void {
    this.clearGreetingTimer();
    const generation = this.sessionGeneration;
    this.greetingTimer = window.setTimeout(() => {
      if (generation !== this.sessionGeneration) return;
      this.detail = "F1 no completó el saludo en 12 segundos";
      void this.enqueue(() => this.finishConversation("error"));
    }, 12_000);
  }

  private armFollowup(): void {
    this.clearFollowupTimer();
    const generation = this.sessionGeneration;
    this.followupTimer = window.setTimeout(() => {
      if (generation !== this.sessionGeneration) return;
      void this.enqueue(() => this.finishConversation("followup-timeout"));
    }, this.options.followupTimeoutMs ?? 5_000);
  }

  private armInactivity(): void {
    if (this.inactivityTimer != null) window.clearTimeout(this.inactivityTimer);
    const generation = this.sessionGeneration;
    this.inactivityTimer = window.setTimeout(() => {
      if (generation !== this.sessionGeneration) return;
      void this.enqueue(() => this.finishConversation("idle-timeout"));
    }, this.options.inactivityTimeoutMs ?? 15_000);
  }

  private armMaxSession(): void {
    if (this.maxSessionTimer != null) window.clearTimeout(this.maxSessionTimer);
    const generation = this.sessionGeneration;
    this.maxSessionTimer = window.setTimeout(() => {
      if (generation !== this.sessionGeneration) return;
      void this.enqueue(() => this.finishConversation("max-session"));
    }, this.options.maxSessionMs ?? 120_000);
  }

  private clearGreetingTimer(): void {
    if (this.greetingTimer != null) window.clearTimeout(this.greetingTimer);
    this.greetingTimer = null;
  }

  private clearFollowupTimer(): void {
    if (this.followupTimer != null) window.clearTimeout(this.followupTimer);
    this.followupTimer = null;
  }

  private clearTimers(): void {
    this.clearGreetingTimer();
    this.clearFollowupTimer();
    if (this.inactivityTimer != null) window.clearTimeout(this.inactivityTimer);
    if (this.maxSessionTimer != null) window.clearTimeout(this.maxSessionTimer);
    this.inactivityTimer = null;
    this.maxSessionTimer = null;
  }

  private isRealtimeState(): boolean {
    return this.sm.state.startsWith("REALTIME_");
  }

  private move(next: Parameters<F1AudioStateMachine["transition"]>[0], detail: string): void {
    if (this.sm.state !== next) this.sm.transition(next);
    this.detail = detail;
    this.emit();
  }

  private emit(): void {
    this.options.onSnapshot(this.snapshot);
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    this.operation = this.operation.then(action, action).catch((error) => {
      this.detail = error instanceof Error ? error.message : String(error);
      try {
        if (this.sm.state !== "ERROR") this.move("ERROR", this.detail);
      } catch {}
    });
    return this.operation;
  }
}
