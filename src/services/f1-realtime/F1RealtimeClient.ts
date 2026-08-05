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
  private remoteAudioContext: AudioContext | null = null;
  private remoteAudioSource: MediaStreamAudioSourceNode | null = null;
  private remoteAudioAnalyser: AnalyserNode | null = null;

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
    this.greetingAudioStarted = false;
    this.greetingAttempts = 0;
    this.greetingRequested = false;
    this.greetingTranscript = "";
    this.clearGreetingFallback();
    await this.closeRemoteAudioAnalysis();
    this.executedCalls.clear();

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
      void this.initializeRemoteAudioAnalysis(remoteStream);
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
        this.requestGreetingOnce();
      }, 900);
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  private requestGreetingOnce(): void {
    if (this.greetingRequested || this.closed) return;
    this.greetingRequested = true;
    this.greetingTranscript = "";
    this.greetingAudioStarted = false;
    this.clearGreetingFallback();
    this.greetingAttempts += 1;
    void this.remoteAudio?.play().catch(() => undefined);

    this.send({
      type: "response.create",
      response: {
        // El saludo es fuera de banda: no debe convertirse en un turno de la
        // conversación ni provocar una continuación automática.
        conversation: "none",
        output_modalities: ["audio"],
        max_output_tokens: 40,
        instructions: `Pronuncia completa y exactamente esta frase, con tono cálido y natural. No la acortes, no la reformules y no agregues nada más: ${this.options.greetingText}`,
        metadata: {
          f1_purpose: "identity_greeting",
          speaker_name: this.options.speakerName ?? "",
        },
      },
    });
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

    if (type === "session.updated" && this.greetingPending) {
      this.requestGreetingOnce();
      return;
    }

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

    // response.done indica que el modelo terminó de generar. El evento
    // output_audio_buffer.stopped confirma que OpenAI dejó de enviar audio,
    // pero el navegador todavía puede conservar una pequeña cola de
    // reproducción. Durante esa cola el micrófono debe seguir cerrado para
    // impedir que el propio saludo active el VAD.
    if (type === "output_audio_buffer.stopped") {
      if (this.greetingPending) {
        await this.finishGreetingAndOpenMicrophone();
        return;
      }

      this.options.callbacks.onResponseDone();
      return;
    }
  }

  private async finishGreetingAndOpenMicrophone(): Promise<void> {
    if (!this.greetingPending || this.closed) return;

    const microphoneTrack = this.stream?.getAudioTracks()[0];
    if (microphoneTrack) microphoneTrack.enabled = false;

    if (!this.isGreetingTranscriptComplete()) {
      if (this.greetingAttempts < 3) {
        this.greetingRequested = false;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        this.requestGreetingOnce();
        return;
      }

      this.options.callbacks.onError(
        new Error(
          `F1 no completó el saludo personalizado. Transcripción recibida: ${
            this.greetingTranscript || "(vacía)"
          }`,
        ),
      );
      return;
    }

    await this.waitForRemotePlaybackSilence();
    if (this.closed || !this.greetingPending) return;

    this.greetingPending = false;

    try {
      this.send({ type: "input_audio_buffer.clear" });
    } catch {}

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

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (this.closed) return;

    if (microphoneTrack) microphoneTrack.enabled = true;
    this.options.callbacks.onGreetingDone();
  }

  private isGreetingTranscriptComplete(): boolean {
    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9ñ ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const actual = normalize(this.greetingTranscript);
    const speaker = normalize(this.options.speakerName ?? "");

    if (!actual.includes("hola")) return false;
    if (speaker && !actual.includes(speaker)) return false;

    return (
      actual.includes("en que puedo ayudarte") ||
      actual.includes("como puedo ayudarte") ||
      actual.includes("en que te puedo ayudar") ||
      actual.includes("como te puedo ayudar")
    );
  }

  private async initializeRemoteAudioAnalysis(
    remoteStream: MediaStream,
  ): Promise<void> {
    await this.closeRemoteAudioAnalysis();

    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(remoteStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.15;
      source.connect(analyser);

      this.remoteAudioContext = context;
      this.remoteAudioSource = source;
      this.remoteAudioAnalyser = analyser;

      if (context.state === "suspended") {
        await context.resume().catch(() => undefined);
      }
    } catch (error) {
      console.warn("[F1 Realtime] No se pudo analizar audio remoto", error);
      await this.closeRemoteAudioAnalysis();
    }
  }

  private async waitForRemotePlaybackSilence(): Promise<void> {
    const analyser = this.remoteAudioAnalyser;
    const context = this.remoteAudioContext;

    if (!analyser || !context || context.state === "closed") {
      await new Promise((resolve) => window.setTimeout(resolve, 2_800));
      return;
    }

    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }

    const samples = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let silenceStartedAt: number | null = null;
    let observedAudibleAudio = false;

    while (!this.closed && performance.now() - startedAt < 8_000) {
      analyser.getFloatTimeDomainData(samples);

      let energy = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index] || 0;
        energy += sample * sample;
      }

      const rms = Math.sqrt(energy / samples.length);
      const audible = rms >= 0.006;

      if (audible) {
        observedAudibleAudio = true;
        silenceStartedAt = null;
      } else if (observedAudibleAudio) {
        silenceStartedAt ??= performance.now();
        if (performance.now() - silenceStartedAt >= 850) return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    if (!observedAudibleAudio) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_200));
    }
  }

  private async closeRemoteAudioAnalysis(): Promise<void> {
    try {
      this.remoteAudioSource?.disconnect();
    } catch {}
    try {
      this.remoteAudioAnalyser?.disconnect();
    } catch {}

    this.remoteAudioSource = null;
    this.remoteAudioAnalyser = null;

    const context = this.remoteAudioContext;
    this.remoteAudioContext = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
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

    await this.closeRemoteAudioAnalysis();
    await this.resources.closeRealtime();
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.greetingPending = true;
    this.greetingAudioStarted = false;
    this.greetingAttempts = 0;
    this.greetingRequested = false;
    this.greetingTranscript = "";
    this.clearGreetingFallback();
    this.remoteAudio = null;
    this.executedCalls.clear();
  }
}
