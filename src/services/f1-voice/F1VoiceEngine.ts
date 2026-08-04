import { F1LocalWakeDetector } from "./F1LocalWakeDetector";
import { F1VoiceGate } from "./F1VoiceGate";
import type {
  F1VoiceEngineOptions,
  F1VoiceEngineStatus,
  F1WakeDetector,
} from "./types";

export class F1VoiceEngine {
  private readonly options: Required<
    Pick<
      F1VoiceEngineOptions,
      "phrase" | "threshold" | "cooldownMs" | "workletUrl"
    >
  > &
    F1VoiceEngineOptions;

  private readonly gate = new F1VoiceGate();
  private readonly detector: F1WakeDetector;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private status: F1VoiceEngineStatus = "idle";
  private lastWakeAt = 0;
  private consecutiveHits = 0;
  private running = false;
  private paused = false;

  constructor(
    options: F1VoiceEngineOptions = {},
    detector: F1WakeDetector = new F1LocalWakeDetector()
  ) {
    this.options = {
      phrase: options.phrase || "Hola F1",
      threshold: Number(options.threshold || 0.78),
      cooldownMs: Number(options.cooldownMs || 5000),
      workletUrl:
        options.workletUrl || "/f1-voice/f1-audio-processor.js",
      ...options,
    };
    this.detector = detector;
  }

  get currentStatus(): F1VoiceEngineStatus {
    return this.status;
  }

  private setStatus(status: F1VoiceEngineStatus, detail?: string) {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      this.setStatus("unsupported", "Web Audio no está disponible.");
      return;
    }

    const modelUrl = String(this.options.modelUrl || "").trim();
    if (!modelUrl) {
      this.setStatus(
        "model-missing",
        "Falta el modelo local entrenado para “Hola F1”."
      );
      return;
    }

    this.setStatus("starting");

    try {
      await this.detector.load(modelUrl);

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.context = new AudioContext({ sampleRate: 48000 });
      await this.context.audioWorklet.addModule(this.options.workletUrl);

      this.source = this.context.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(
        this.context,
        "f1-voice-audio-processor",
        {
          processorOptions: {
            targetSampleRate: 16000,
            frameSamples: 1280,
          },
        }
      );

      // Mantiene vivo el grafo sin reproducir el micrófono por bocinas.
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;

      this.worklet.port.onmessage = (event: MessageEvent) => {
        if (event.data?.type !== "audio-frame") return;
        const pcm = event.data.pcm as Float32Array;
        const sampleRate = Number(event.data.sampleRate || 16000);
        void this.processFrame(pcm, sampleRate);
      };

      this.source.connect(this.worklet);
      this.worklet.connect(this.sink);
      this.sink.connect(this.context.destination);

      this.running = true;
      this.paused = false;
      this.setStatus("listening");
    } catch (error: any) {
      await this.stop();
      const message = error?.message || String(error);

      if (/modelo|model/i.test(message)) {
        this.setStatus("model-missing", message);
      } else {
        this.setStatus("error", message);
      }
    }
  }

  private async processFrame(
    frame: Float32Array,
    sampleRate: number
  ): Promise<void> {
    if (!this.running || this.paused || !this.detector.ready) return;

    // La silla, golpes y ruido impulsivo se descartan antes del modelo.
    if (!this.gate.isLikelyVoice(frame)) {
      this.consecutiveHits = 0;
      return;
    }

    const confidence = await this.detector.score(frame, sampleRate);

    if (confidence >= this.options.threshold) {
      this.consecutiveHits += 1;
    } else {
      this.consecutiveHits = 0;
    }

    // Exige dos cuadros positivos consecutivos.
    if (this.consecutiveHits < 2) return;

    const now = Date.now();
    if (now - this.lastWakeAt < this.options.cooldownMs) return;

    this.lastWakeAt = now;
    this.consecutiveHits = 0;
    this.pause();

    this.options.onWake?.({
      phrase: this.options.phrase,
      confidence,
      detectedAt: now,
    });
  }

  pause(): void {
    this.paused = true;
    if (this.running) this.setStatus("paused");
  }

  resume(): void {
    if (!this.running) return;
    this.paused = false;
    this.consecutiveHits = 0;
    this.setStatus("listening");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.paused = false;
    this.consecutiveHits = 0;

    if (this.worklet) {
      this.worklet.port.onmessage = null;
      try {
        this.worklet.disconnect();
      } catch {}
      this.worklet = null;
    }

    if (this.source) {
      try {
        this.source.disconnect();
      } catch {}
      this.source = null;
    }

    if (this.sink) {
      try {
        this.sink.disconnect();
      } catch {}
      this.sink = null;
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    if (this.context) {
      try {
        await this.context.close();
      } catch {}
      this.context = null;
    }

    await this.detector.dispose();
    this.setStatus("idle");
  }
}
