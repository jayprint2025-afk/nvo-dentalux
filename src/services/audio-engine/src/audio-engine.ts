import { BrowserMicrophoneCapture } from "./capture/browser-microphone-capture.js";
import { MonoDownmixer } from "./dsp/mono-downmixer.js";
import { StreamingLinearResampler, type AudioResampler } from "./dsp/streaming-linear-resampler.js";
import { TypedEventBus, type EventListener, type Unsubscribe } from "./events/typed-event-bus.js";
import { FrameAssembler } from "./frame/frame-assembler.js";
import type { AudioCapturePort, AudioEngineConfig, AudioEngineState, CapturedAudioChunk } from "./types/audio.js";
import { AudioEngineError } from "./types/errors.js";
import type { AudioEngineEventMap } from "./types/events.js";

const TARGET_SAMPLE_RATE = 16_000 as const;
const FRAME_DURATION_MS = 80 as const;
const FRAME_SIZE = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1_000;

export class AudioEngine {
  readonly #events = new TypedEventBus<AudioEngineEventMap>();
  readonly #capture: AudioCapturePort;
  readonly #downmixer = new MonoDownmixer();
  readonly #resampler: AudioResampler;
  readonly #frames = new FrameAssembler(FRAME_SIZE);
  #state: AudioEngineState = "idle";
  #sequence = 0;
  #nextFrameTimestampMs: number | undefined;

  public constructor(config: AudioEngineConfig = {}) {
    if (config.targetSampleRate !== undefined && config.targetSampleRate !== TARGET_SAMPLE_RATE) {
      throw new AudioEngineError("INVALID_CONFIG", "Sprint 1 supports exactly 16 kHz output.");
    }
    if (config.frameDurationMs !== undefined && config.frameDurationMs !== FRAME_DURATION_MS) {
      throw new AudioEngineError("INVALID_CONFIG", "Sprint 1 supports exactly 80 ms frames.");
    }
    this.#capture = config.capture ?? new BrowserMicrophoneCapture();
    this.#resampler = new StreamingLinearResampler(TARGET_SAMPLE_RATE);
  }

  public get state(): AudioEngineState {
    return this.#state;
  }

  public on<TKey extends keyof AudioEngineEventMap>(
    event: TKey,
    listener: EventListener<AudioEngineEventMap[TKey]>,
  ): Unsubscribe {
    return this.#events.on(event, listener);
  }

  public once<TKey extends keyof AudioEngineEventMap>(
    event: TKey,
    listener: EventListener<AudioEngineEventMap[TKey]>,
  ): Unsubscribe {
    return this.#events.once(event, listener);
  }

  public off<TKey extends keyof AudioEngineEventMap>(
    event: TKey,
    listener: EventListener<AudioEngineEventMap[TKey]>,
  ): void {
    this.#events.off(event, listener);
  }

  public async start(): Promise<void> {
    if (this.#state === "running" || this.#state === "starting") return;
    if (this.#state === "stopping") {
      throw new AudioEngineError("CAPTURE_START_FAILED", "Cannot start while the engine is stopping.");
    }

    this.#resetPipeline();
    this.#transition("starting");
    try {
      await this.#capture.start({
        onChunk: (chunk) => this.#handleChunk(chunk),
        onError: (error) => this.#handleRuntimeError(error),
      });
      this.#transition("running");
    } catch (error) {
      const wrapped = error instanceof AudioEngineError
        ? error
        : new AudioEngineError("CAPTURE_START_FAILED", "Audio capture failed to start.", { cause: error });
      this.#transition("failed");
      this.#events.emit("error", wrapped);
      throw wrapped;
    }
  }

  public async stop(): Promise<void> {
    if (this.#state === "idle") return;
    if (this.#state === "stopping") return;

    this.#transition("stopping");
    try {
      await this.#capture.stop();
      this.#resetPipeline();
      this.#transition("idle");
    } catch (error) {
      const wrapped = error instanceof AudioEngineError
        ? error
        : new AudioEngineError("CAPTURE_STOP_FAILED", "Audio capture failed to stop.", { cause: error });
      this.#transition("failed");
      this.#events.emit("error", wrapped);
      throw wrapped;
    }
  }

  #handleChunk(chunk: CapturedAudioChunk): void {
    if (this.#state !== "running" && this.#state !== "starting") return;
    try {
      const mono = this.#downmixer.process(chunk.channels);
      const resampled = this.#resampler.process(mono, chunk.sampleRate);
      const frames = this.#frames.push(resampled);
      if (this.#nextFrameTimestampMs === undefined) this.#nextFrameTimestampMs = chunk.timestampMs;

      for (const samples of frames) {
        const timestampMs: number = this.#nextFrameTimestampMs;
        this.#events.emit("frame", {
          samples,
          sampleRate: TARGET_SAMPLE_RATE,
          durationMs: FRAME_DURATION_MS,
          sequence: this.#sequence,
          timestampMs,
        });
        this.#sequence += 1;
        this.#nextFrameTimestampMs = timestampMs + FRAME_DURATION_MS;
      }
    } catch (error) {
      this.#handleRuntimeError(error);
    }
  }

  #handleRuntimeError(error: unknown): void {
    const wrapped = error instanceof AudioEngineError
      ? error
      : new AudioEngineError("CAPTURE_RUNTIME_FAILED", "Audio processing failed at runtime.", { cause: error });
    if (this.#state !== "failed") this.#transition("failed");
    this.#events.emit("error", wrapped);
  }

  #transition(current: AudioEngineState): void {
    if (current === this.#state) return;
    const previous = this.#state;
    this.#state = current;
    this.#events.emit("statechange", { previous, current });
  }

  #resetPipeline(): void {
    this.#resampler.reset();
    this.#frames.reset();
    this.#sequence = 0;
    this.#nextFrameTimestampMs = undefined;
  }
}
