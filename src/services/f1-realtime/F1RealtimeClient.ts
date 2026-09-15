import { F1AudioResourceManager } from "./F1AudioResourceManager";
import type { F1RealtimeClientOptions, RealtimeToolCall } from "./types";

export class F1RealtimeClient {
  private readonly resources = new F1AudioResourceManager();
  private readonly executedCalls = new Set<string>();
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private greetingPending = true;
  private greetingAudioStarted = false;
  private greetingAttempts = 0;
  private remoteAudio: HTMLAudioElement | null = null;
  private closed = false;
  private greetingRequested = false;
  private greetingFallbackTimer: number | null = null;
  private greetingTranscript = "";
  private greetingResponseDone = false;
  private greetingAudioStopped = false;
  private greetingFinalizing = false;
  private waitingForConversationSessionUpdate = false;
  // Un 429 de Realtime es transitorio: NO debe derribar la conversación.
  // Conservamos el response.create pendiente y lo reintentamos en el mismo
  // DataChannel para mantener todo el contexto conversacional del servidor.
  private pendingResponseCreate: any | null = null;
  private responseRetryTimer: number | null = null;
  private responseRetryAttempt = 0;
  private readonly maxResponseRetryAttempts = 6;
  private userTurnAwaitingResponse = false;
  // Blindaje de transporte: si WebRTC/DataChannel cae, reconstruimos la sesión
  // sin regresar al Wake Engine y reinyectamos un checkpoint conversacional corto.
  private recoveryMode = false;
  private recoveringTransport = false;
  private transportRecoveryAttempt = 0;
  private readonly maxTransportRecoveryAttempts = 3;
  private recoveryJournal: string[] = [];
  private inFlightTools = 0;

  constructor(private readonly options: F1RealtimeClientOptions) {}

  get microphoneOwner() {
    return this.resources.microphoneOwner;
  }

  async connect(recovery = false): Promise<void> {
    if (this.pc) return;

    const token = this.options.getToken();
    if (!token) throw new Error("Inicia sesión nuevamente para usar la voz.");

    this.closed = false;
    this.recoveryMode = recovery;
    this.greetingPending = true;
    this.greetingAudioStarted = false;
    this.greetingAttempts = 0;
    this.greetingRequested = false;
    this.greetingTranscript = "";
    this.greetingResponseDone = false;
    this.greetingAudioStopped = false;
    this.greetingFinalizing = false;
    this.waitingForConversationSessionUpdate = false;
    this.clearResponseRetry();
    this.pendingResponseCreate = null;
    this.responseRetryAttempt = 0;
    this.userTurnAwaitingResponse = false;
    this.clearGreetingFallback();
    if (!recovery) {
      this.executedCalls.clear();
      this.recoveryJournal = [];
      this.transportRecoveryAttempt = 0;
    }

    const pc = new RTCPeerConnection();
    const remoteAudio =
      this.options.getRemoteAudioElement() ?? document.createElement("audio");

    remoteAudio.autoplay = true;
    remoteAudio.muted = false;
    remoteAudio.volume = 1;
    remoteAudio.setAttribute("playsinline", "");
    this.remoteAudio = remoteAudio;

    let resolveRemoteTrack!: () => void;
    const remoteTrackReady = new Promise<void>((resolve) => {
      resolveRemoteTrack = resolve;
    });

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      remoteAudio.srcObject = remoteStream;
      resolveRemoteTrack();
      this.options.callbacks.onRemoteAudioReady?.();

      void remoteAudio.play().catch((error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        this.options.callbacks.onError(
          new Error(`El navegador bloqueó el audio de F1: ${message}`),
        );
      });
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const microphoneTrack = stream.getAudioTracks()[0];
    if (!microphoneTrack) {
      stream.getTracks().forEach((track) => track.stop());
      pc.close();
      throw new Error("No se encontró una pista de micrófono.");
    }

    // La frase Wake nunca llega a OpenAI. El micrófono Realtime permanece
    // deshabilitado hasta que F1 termine de decir “Te escucho”.
    microphoneTrack.enabled = false;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const dc = pc.createDataChannel("oai-events");
    this.pc = pc;
    this.dc = dc;
    this.stream = stream;
    this.resources.attachRealtime(pc, dc, stream, remoteAudio);

    dc.onmessage = (event) => {
      void this.handleMessage(event.data);
    };
    dc.onclose = () => {
      if (this.closed || this.recoveringTransport) return;
      void this.recoverTransport();
    };

    const dataChannelOpened = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Timeout abriendo DataChannel Realtime")),
        10_000,
      );

      dc.onopen = () => {
        window.clearTimeout(timer);
        resolve();
      };
      dc.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("No fue posible abrir DataChannel Realtime"));
      };
    });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch(
        `${this.options.apiBase}/api/f1/realtime/call?branch_key=${encodeURIComponent(this.options.branchKey)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
            "x-sucursal": this.options.branchKey,
          },
          body: offer.sdp ?? "",
        },
      );

      if (!response.ok) {
        throw new Error((await response.text()) || `Realtime HTTP ${response.status}`);
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });
      await dataChannelOpened;

      // Esperar la pista remota evita perder el primer audio “Te escucho”.
      await Promise.race([
        remoteTrackReady,
        new Promise<void>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("La pista de audio remota no estuvo lista")),
            6_000,
          ),
        ),
      ]);

      await remoteAudio.play().catch(() => undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      this.options.callbacks.onConnected();

      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 650,
                create_response: false,
                interrupt_response: false,
              },
            },
          },
        },
      });

      this.greetingFallbackTimer = window.setTimeout(() => {
        if (this.recoveryMode) this.requestRecoveryOnce();
        else this.requestGreetingOnce();
      }, 900);
    } catch (error) {
      if (recovery) {
        try { await this.resources.closeRealtime(); } catch {}
        this.pc = null;
        this.dc = null;
        this.stream = null;
        this.remoteAudio = null;
      } else {
        await this.close().catch(() => undefined);
      }
      throw error;
    }
  }

  private rememberRecovery(line: string): void {
    const clean = String(line || "").replace(/\s+/g, " ").trim().slice(0, 900);
    if (!clean) return;
    this.recoveryJournal.push(clean);
    if (this.recoveryJournal.length > 12) this.recoveryJournal.splice(0, this.recoveryJournal.length - 12);
  }

  private requestRecoveryOnce(): void {
    if (this.greetingRequested || this.closed) return;
    this.greetingRequested = true;
    this.greetingTranscript = "";
    this.greetingAudioStarted = false;
    this.greetingResponseDone = false;
    this.greetingAudioStopped = false;
    this.greetingFinalizing = false;
    this.clearGreetingFallback();

    const checkpoint = this.recoveryJournal.length
      ? this.recoveryJournal.join("\n")
      : "La conversación estaba activa cuando se interrumpió el transporte.";

    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: `CONTEXTO DE RECUPERACIÓN INTERNO. No vuelvas a saludar ni pidas repetir desde cero. Retoma exactamente donde quedó el flujo. Si una acción ya aparece como ejecutada, no la repitas.\n${checkpoint}`,
        }],
      },
    });
    this.sendResponseCreate({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: "Retoma brevemente la conversación desde el checkpoint. No digas Te escucho, no vuelvas a saludar y no repitas una acción ya ejecutada.",
      },
    });
  }

  private async recoverTransport(): Promise<void> {
    if (this.closed || this.recoveringTransport) return;
    if (this.transportRecoveryAttempt >= this.maxTransportRecoveryAttempts) {
      this.options.callbacks.onClosed();
      return;
    }

    this.recoveringTransport = true;
    this.transportRecoveryAttempt += 1;
    this.clearResponseRetry();
    try {
      await this.resources.closeRealtime();
    } catch {}
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.remoteAudio = null;

    // Si la caída ocurrió mientras una acción HTTP ya estaba ejecutándose,
    // esperamos su resultado antes de reconstruir la sesión. Así el checkpoint
    // sabe si la acción terminó y Hanna no intenta repetirla con un call_id nuevo.
    const toolDeadline = Date.now() + 10_000;
    while (this.inFlightTools > 0 && Date.now() < toolDeadline && !this.closed) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    const delay = Math.min(4000, 500 * Math.pow(2, this.transportRecoveryAttempt - 1));
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (this.closed) { this.recoveringTransport = false; return; }

    try {
      await this.connect(true);
      this.transportRecoveryAttempt = 0;
      this.recoveringTransport = false;
    } catch (error) {
      this.recoveringTransport = false;
      if (this.transportRecoveryAttempt < this.maxTransportRecoveryAttempts && !this.closed) {
        void this.recoverTransport();
      } else {
        this.options.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private requestGreetingOnce(): void {
    if (this.greetingRequested || this.closed) return;
    this.greetingRequested = true;
    this.greetingTranscript = "";
    this.greetingAudioStarted = false;
    this.greetingResponseDone = false;
    this.greetingAudioStopped = false;
    this.greetingFinalizing = false;
    this.clearGreetingFallback();
    this.greetingAttempts += 1;
    void this.remoteAudio?.play().catch(() => undefined);

    this.sendResponseCreate({
      type: "response.create",
      response: {
        // El saludo es fuera de banda: no debe convertirse en un turno de la
        // conversación ni provocar una continuación automática.
        conversation: "none",
        output_modalities: ["audio"],
        // En Realtime este límite incluye tokens de audio. Un valor de 40
        // corta el saludo antes de terminar el nombre. 192 deja margen
        // suficiente para la frase completa sin permitir una respuesta larga.
        max_output_tokens: 192,
        instructions: `Pronuncia completa y exactamente esta frase, con tono cálido y natural. No la acortes, no la reformules y no agregues nada más: ${this.options.greetingText}`,
        metadata: {
          f1_purpose: "identity_greeting",
          speaker_name: this.options.speakerName ?? "",
        },
      },
    });
  }

  private clearResponseRetry(): void {
    if (this.responseRetryTimer != null) window.clearTimeout(this.responseRetryTimer);
    this.responseRetryTimer = null;
  }

  private sendResponseCreate(payload: any = { type: "response.create" }): void {
    this.clearResponseRetry();
    this.pendingResponseCreate = payload;
    this.send(payload);
  }

  private isRateLimitError(payload: any): boolean {
    const error = payload?.error ?? payload?.response?.status_details?.error ?? {};
    const haystack = [error?.type, error?.code, error?.message, payload?.response?.status_details?.reason]
      .filter(Boolean).join(" ").toLowerCase();
    return /rate[_ -]?limit|tokens per min|tpm|429/.test(haystack);
  }

  private retryDelayMs(payload: any): number {
    const error = payload?.error ?? payload?.response?.status_details?.error ?? {};
    const message = String(error?.message ?? payload?.response?.status_details?.reason ?? "");
    const seconds = message.match(/try again in\s+([0-9.]+)s/i);
    const milliseconds = message.match(/try again in\s+([0-9.]+)ms/i);
    if (milliseconds) return Math.max(250, Math.ceil(Number(milliseconds[1])) + 150);
    if (seconds) return Math.max(250, Math.ceil(Number(seconds[1]) * 1000) + 150);
    return Math.min(8_000, 750 * Math.pow(2, this.responseRetryAttempt));
  }

  private scheduleRateLimitRetry(payload: any): void {
    if (this.closed || !this.pendingResponseCreate) return;
    if (this.responseRetryAttempt >= this.maxResponseRetryAttempts) {
      const error = payload?.error ?? payload?.response?.status_details?.error ?? {};
      this.options.callbacks.onError(new Error(
        String(error?.message || "Realtime continuó limitado después de varios reintentos."),
      ));
      return;
    }

    const delay = this.retryDelayMs(payload);
    this.responseRetryAttempt += 1;
    this.clearResponseRetry();
    this.responseRetryTimer = window.setTimeout(() => {
      this.responseRetryTimer = null;
      if (this.closed || !this.pendingResponseCreate) return;
      try {
        this.send(this.pendingResponseCreate);
      } catch (error) {
        this.options.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }, delay);
  }

  private markResponseCompleted(): void {
    this.clearResponseRetry();
    this.pendingResponseCreate = null;
    this.responseRetryAttempt = 0;
  }

  private clearGreetingFallback(): void {
    if (this.greetingFallbackTimer != null) {
      window.clearTimeout(this.greetingFallbackTimer);
    }
    this.greetingFallbackTimer = null;
  }

  private send(payload: unknown): void {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel Realtime no está abierto");
    }
    this.dc.send(JSON.stringify(payload));
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const text = await this.decodeMessage(raw);
    if (!text) return;

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      console.warn("[F1 Realtime] Evento no JSON", text);
      return;
    }

    const type = String(payload?.type ?? "");
    console.debug("[F1 Realtime]", type);

    if (type === "session.updated") {
      if (this.waitingForConversationSessionUpdate) {
        this.waitingForConversationSessionUpdate = false;
        await this.enableMicrophoneAfterGreeting();
        return;
      }

      if (this.greetingPending && !this.greetingRequested) {
        if (this.recoveryMode) this.requestRecoveryOnce();
        else this.requestGreetingOnce();
      }
      return;
    }

    if (type === "error") {
      // OpenAI puede emitir 429 como evento de error sin cerrar WebRTC. Antes
      // este camino destruía la sesión completa desde el controller. Para 429
      // mantenemos micrófono, conversación, tool state y call_id intactos.
      if (this.isRateLimitError(payload)) {
        // Los turnos normales los crea server_vad (create_response=true), por
        // lo que no existe un response.create local que guardar. Si el 429
        // corresponde a un turno de usuario aún pendiente, recreamos SOLO la
        // generación; la conversación y el audio ya están en la sesión.
        if (!this.pendingResponseCreate && this.userTurnAwaitingResponse && !this.greetingPending) {
          this.pendingResponseCreate = { type: "response.create" };
        }
        if (this.pendingResponseCreate) {
          this.scheduleRateLimitRetry(payload);
          return;
        }
      }
      const details = [
        payload.error?.message || "Error en Realtime",
        payload.error?.code ? `code=${payload.error.code}` : "",
        payload.error?.param ? `param=${payload.error.param}` : "",
      ].filter(Boolean).join(" · ");
      this.options.callbacks.onError(new Error(details));
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      if (!this.greetingPending) this.userTurnAwaitingResponse = true;
      this.options.callbacks.onUserSpeechStarted();
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(payload.transcript ?? "").trim();
      if (transcript) { this.rememberRecovery(`Usuario: ${transcript}`); this.options.callbacks.onUserTranscript(transcript); }
      return;
    }

    if (type === "output_audio_buffer.started") {
      if (this.greetingPending) this.greetingAudioStarted = true;
      void this.remoteAudio?.play().catch(() => undefined);
      this.options.callbacks.onAssistantSpeechStarted();
      return;
    }

    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      const delta = String(payload.delta ?? "");
      if (this.greetingPending) this.greetingTranscript += delta;
      this.options.callbacks.onAssistantTranscriptDelta(delta);
      return;
    }

    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const transcript = String(payload.transcript ?? "").trim();
      if (this.greetingPending && transcript) {
        this.greetingTranscript = transcript;
      }
      if (transcript) { this.rememberRecovery(`Hanna: ${transcript}`); this.options.callbacks.onAssistantTranscriptDone(transcript); }
      return;
    }

    if (type === "response.output_item.done" && payload.item?.type === "function_call") {
      // Esperamos response.done. Ejecutar aquí y además en response.done puede
      // adelantar el response.create de continuación y confundir qué respuesta
      // está pendiente durante un 429.
      return;
    }

    if (type === "response.done") {
      const status = String(payload.response?.status ?? "");
      if (status === "failed" || status === "cancelled") {
        if (status === "failed" && this.isRateLimitError(payload)) {
          if (!this.pendingResponseCreate && this.userTurnAwaitingResponse && !this.greetingPending) {
            this.pendingResponseCreate = { type: "response.create" };
          }
          if (this.pendingResponseCreate) {
            this.scheduleRateLimitRetry(payload);
            return;
          }
        }
        const details = payload.response?.status_details;
        const message =
          details?.error?.message ||
          details?.reason ||
          `La respuesta Realtime terminó con estado ${status}`;
        this.options.callbacks.onError(new Error(String(message)));
        return;
      }

      // La generación actual terminó correctamente. Si produjo una herramienta,
      // handleTool abrirá una NUEVA respuesta de continuación.
      this.markResponseCompleted();
      const toolItems = (payload.response?.output ?? []).filter((item: any) => item?.type === "function_call");
      if (!toolItems.length && !this.greetingPending) this.userTurnAwaitingResponse = false;
      for (const item of toolItems) await this.handleTool(item);

      if (this.greetingPending) {
        this.greetingResponseDone = true;
        await this.tryFinalizeGreeting();
      }
      return;
    }

    if (type === "output_audio_buffer.stopped") {
      if (this.greetingPending) {
        this.greetingAudioStopped = true;
        await this.tryFinalizeGreeting();
        return;
      }

      this.options.callbacks.onResponseDone();
      return;
    }
  }

  private async tryFinalizeGreeting(): Promise<void> {
    if (
      !this.greetingPending ||
      this.greetingFinalizing ||
      !this.greetingResponseDone ||
      !this.greetingAudioStopped ||
      this.closed
    ) {
      return;
    }

    this.greetingFinalizing = true;
    this.clearGreetingFallback();

    const microphoneTrack = this.stream?.getAudioTracks()[0];
    if (microphoneTrack) microphoneTrack.enabled = false;

    // El saludo ya terminó de generarse y de reproducirse. Se limpia cualquier
    // residuo antes de habilitar el VAD conversacional.
    try {
      this.send({ type: "input_audio_buffer.clear" });
    } catch {}

    this.waitingForConversationSessionUpdate = true;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 750,
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
  }

  private async enableMicrophoneAfterGreeting(): Promise<void> {
    if (!this.greetingPending || this.closed) return;

    // Pequeña guarda contra eco físico, después de que OpenAI confirmó la
    // configuración conversacional. No se solicita ni repite otro saludo.
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    if (this.closed) return;

    const microphoneTrack = this.stream?.getAudioTracks()[0];
    if (microphoneTrack) microphoneTrack.enabled = true;

    this.greetingPending = false;
    this.greetingFinalizing = false;
    this.options.callbacks.onGreetingDone();
  }

  private async decodeMessage(raw: unknown): Promise<string> {
    if (typeof raw === "string") return raw;
    if (raw instanceof Blob) return raw.text();
    if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
    if (ArrayBuffer.isView(raw)) {
      return new TextDecoder().decode(
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      );
    }
    return "";
  }

  private async handleTool(item: any): Promise<void> {
    const call: RealtimeToolCall = {
      name: String(item?.name ?? ""),
      callId: String(item?.call_id ?? item?.id ?? ""),
      argumentsJson: String(item?.arguments ?? "{}"),
    };

    if (!call.name || !call.callId || this.executedCalls.has(call.callId)) return;
    this.executedCalls.add(call.callId);

    this.rememberRecovery(`Acción solicitada: ${call.name} ${call.argumentsJson}`);
    const originDc = this.dc;
    this.inFlightTools += 1;

    let output: unknown;
    try {
      output = await this.options.callbacks.onToolCall(call);
    } catch (error) {
      output = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.inFlightTools = Math.max(0, this.inFlightTools - 1);
    }

    this.rememberRecovery(`Resultado de ${call.name}: ${JSON.stringify(output).slice(0, 900)}`);

    // Un function_call_output pertenece a la sesión que emitió ese call_id.
    // Si WebRTC se reconstruyó mientras la acción estaba en vuelo, NO enviamos
    // el call_id viejo a la sesión nueva; el resultado ya quedó en el checkpoint.
    if (!this.dc || this.dc !== originDc || this.dc.readyState !== "open") return;

    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(output),
      },
    });
    this.sendResponseCreate({ type: "response.create" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.resources.closeRealtime();
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.greetingPending = true;
    this.greetingAudioStarted = false;
    this.greetingAttempts = 0;
    this.greetingRequested = false;
    this.greetingTranscript = "";
    this.greetingResponseDone = false;
    this.greetingAudioStopped = false;
    this.greetingFinalizing = false;
    this.waitingForConversationSessionUpdate = false;
    this.clearResponseRetry();
    this.pendingResponseCreate = null;
    this.responseRetryAttempt = 0;
    this.userTurnAwaitingResponse = false;
    this.clearGreetingFallback();
    this.remoteAudio = null;
    this.recoveryMode = false;
    this.recoveringTransport = false;
    this.transportRecoveryAttempt = 0;
    this.recoveryJournal = [];
    this.inFlightTools = 0;
    this.executedCalls.clear();
  }
}
