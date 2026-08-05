import { F1AudioResourceManager } from "./F1AudioResourceManager";
import type { F1RealtimeClientOptions, RealtimeToolCall } from "./types";

export class F1RealtimeClient {
  private readonly resources = new F1AudioResourceManager();
  private readonly executedCalls = new Set<string>();
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private greetingPending = true;
  private closed = false;

  constructor(private readonly options: F1RealtimeClientOptions) {}

  get microphoneOwner() {
    return this.resources.microphoneOwner;
  }

  async connect(): Promise<void> {
    if (this.pc) return;

    const token = this.options.getToken();
    if (!token) throw new Error("Inicia sesión nuevamente para usar la voz.");

    this.closed = false;
    this.greetingPending = true;
    this.executedCalls.clear();

    const pc = new RTCPeerConnection();
    const remoteAudio =
      this.options.getRemoteAudioElement() ?? document.createElement("audio");

    remoteAudio.autoplay = true;
    remoteAudio.muted = false;
    remoteAudio.volume = 1;
    remoteAudio.setAttribute("playsinline", "");

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
      if (!this.closed) this.options.callbacks.onClosed();
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
      this.options.callbacks.onConnected();

      // Eventos sobre el mismo DataChannel son ordenados: primero se impide
      // que VAD cree respuestas; después se solicita el único saludo.
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

      this.send({
        type: "response.create",
        response: {
          conversation: "none",
          output_modalities: ["audio"],
          max_output_tokens: 16,
          instructions: "Di exactamente: Te escucho. No digas nada más.",
        },
      });
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
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

    if (type === "error") {
      const details = [
        payload.error?.message || "Error en Realtime",
        payload.error?.code ? `code=${payload.error.code}` : "",
        payload.error?.param ? `param=${payload.error.param}` : "",
      ].filter(Boolean).join(" · ");
      this.options.callbacks.onError(new Error(details));
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      this.options.callbacks.onUserSpeechStarted();
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(payload.transcript ?? "").trim();
      if (transcript) this.options.callbacks.onUserTranscript(transcript);
      return;
    }

    if (type === "output_audio_buffer.started") {
      this.options.callbacks.onAssistantSpeechStarted();
      return;
    }

    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      this.options.callbacks.onAssistantTranscriptDelta(String(payload.delta ?? ""));
      return;
    }

    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const transcript = String(payload.transcript ?? "").trim();
      if (transcript) this.options.callbacks.onAssistantTranscriptDone(transcript);
      return;
    }

    if (type === "response.output_item.done" && payload.item?.type === "function_call") {
      await this.handleTool(payload.item);
      return;
    }

    if (type === "response.done") {
      const status = String(payload.response?.status ?? "");
      if (status === "failed" || status === "cancelled") {
        const details = payload.response?.status_details;
        const message =
          details?.error?.message ||
          details?.reason ||
          `La respuesta Realtime terminó con estado ${status}`;
        this.options.callbacks.onError(new Error(String(message)));
        return;
      }

      for (const item of payload.response?.output ?? []) {
        if (item?.type === "function_call") await this.handleTool(item);
      }
      return;
    }

    // response.done indica que el modelo terminó de generar, pero el audio
    // todavía puede estar reproduciéndose. Solo este evento confirma que el
    // buffer remoto ya se drenó completamente.
    if (type === "output_audio_buffer.stopped") {
      if (this.greetingPending) {
        this.greetingPending = false;

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

        const microphoneTrack = this.stream?.getAudioTracks()[0];
        if (microphoneTrack) microphoneTrack.enabled = true;
        this.options.callbacks.onGreetingDone();
        return;
      }

      this.options.callbacks.onResponseDone();
      return;
    }
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

    let output: unknown;
    try {
      output = await this.options.callbacks.onToolCall(call);
    } catch (error) {
      output = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!this.dc || this.dc.readyState !== "open") return;

    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(output),
      },
    });
    this.send({ type: "response.create" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.resources.closeRealtime();
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.greetingPending = true;
    this.executedCalls.clear();
  }
}
