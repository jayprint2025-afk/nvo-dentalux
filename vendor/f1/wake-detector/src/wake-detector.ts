import { TypedEventBus, type EventListener, type Unsubscribe } from "./events/typed-event-bus.js";
import { SpectralFeatureExtractor, type WakeFeatureExtractor } from "./features/spectral-feature-extractor.js";
import type { WakeModelPort } from "./model/wake-model-port.js";
import { ConsecutiveHitPolicy, type WakeDetectionPolicy } from "./policy/wake-detection-policy.js";
import { FrameCooldownController, type CooldownPort } from "./state/cooldown-controller.js";
import type { WakeEventMap, WakeDetectorError } from "./types/events.js";
import type {
  WakeDetectorConfig,
  WakeDetectorProcessor,
  WakeDetectorState,
  WakeFrame,
  WakeProcessResult,
  WakeSignal,
} from "./types/wake.js";
import { SlidingFeatureWindow, type FeatureWindow } from "./window/sliding-feature-window.js";

interface ResolvedWakeConfig {
  readonly featureBands: number;
  readonly windowFrames: number;
  readonly detectionThreshold: number;
  readonly consecutiveHits: number;
  readonly cooldownFrames: number;
  readonly maxSilentFramesBeforeReset: number;
  readonly expectedSampleRate: number;
  readonly preEmphasis: number;
  readonly captureWindowFrames: number;
}

const DEFAULTS: ResolvedWakeConfig = {
  featureBands: 16,
  windowFrames: 12,
  detectionThreshold: 0.8,
  consecutiveHits: 2,
  cooldownFrames: 15,
  maxSilentFramesBeforeReset: 5,
  expectedSampleRate: 16_000,
  preEmphasis: 0.97,
  captureWindowFrames: 24,
};

export interface WakeDetectorDependencies {
  readonly featureExtractor?: WakeFeatureExtractor;
  readonly featureWindow?: FeatureWindow;
  readonly detectionPolicy?: WakeDetectionPolicy;
  readonly cooldown?: CooldownPort;
}

export class WakeDetector implements WakeDetectorProcessor {
  readonly #events = new TypedEventBus<WakeEventMap>();
  readonly #model: WakeModelPort;
  readonly #config: ResolvedWakeConfig;
  readonly #features: WakeFeatureExtractor;
  readonly #window: FeatureWindow;
  readonly #policy: WakeDetectionPolicy;
  readonly #cooldown: CooldownPort;
  #state: WakeDetectorState = "idle";
  #silentFrames = 0;
  #processing: Promise<unknown> = Promise.resolve();
  #audioFrames: Float32Array[] = [];

  public constructor(model: WakeModelPort, config: WakeDetectorConfig = {}, dependencies: WakeDetectorDependencies = {}) {
    this.#config = { ...DEFAULTS, ...config };
    validateConfig(this.#config);
    this.#model = model;
    this.#features = dependencies.featureExtractor ?? new SpectralFeatureExtractor({
      bands: this.#config.featureBands,
      preEmphasis: this.#config.preEmphasis,
    });
    this.#window = dependencies.featureWindow ?? new SlidingFeatureWindow(this.#config.windowFrames, this.#features.featureSize);
    this.#policy = dependencies.detectionPolicy ?? new ConsecutiveHitPolicy(
      this.#config.detectionThreshold,
      this.#config.consecutiveHits,
    );
    this.#cooldown = dependencies.cooldown ?? new FrameCooldownController(this.#config.cooldownFrames);
  }

  public get state(): WakeDetectorState {
    return this.#state;
  }

  public on<TKey extends keyof WakeEventMap>(event: TKey, listener: EventListener<WakeEventMap[TKey]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  public once<TKey extends keyof WakeEventMap>(event: TKey, listener: EventListener<WakeEventMap[TKey]>): Unsubscribe {
    return this.#events.once(event, listener);
  }

  public off<TKey extends keyof WakeEventMap>(event: TKey, listener: EventListener<WakeEventMap[TKey]>): void {
    this.#events.off(event, listener);
  }

  public async start(): Promise<void> {
    if (this.#state === "ready" || this.#state === "cooldown") return;
    if (this.#state === "disposed") throw new Error("wake detector has been disposed.");
    try {
      await this.#model.initialize();
      this.#setState("ready");
    } catch (cause) {
      this.#fail({ code: "MODEL_INITIALIZATION_FAILED", message: "Wake model initialization failed.", cause });
      throw cause;
    }
  }

  public process(frame: WakeFrame, signal: WakeSignal = {}): Promise<WakeProcessResult> {
    const operation = this.#processing.then(() => this.#processOrdered(frame, signal));
    this.#processing = operation.catch(() => undefined);
    return operation;
  }

  public reset(): void {
    this.#features.reset();
    this.#window.reset();
    this.#policy.reset();
    this.#cooldown.reset();
    this.#silentFrames = 0;
    this.#audioFrames = [];
    if (this.#state !== "disposed" && this.#state !== "failed") this.#setState("ready");
  }

  public async dispose(): Promise<void> {
    if (this.#state === "disposed") return;
    await this.#processing;
    await this.#model.dispose();
    this.#features.reset();
    this.#window.reset();
    this.#audioFrames = [];
    this.#events.clear();
    this.#state = "disposed";
  }

  async #processOrdered(frame: WakeFrame, signal: WakeSignal): Promise<WakeProcessResult> {
    if (this.#state === "idle") throw new Error("wake detector must be started before processing frames.");
    if (this.#state === "failed") throw new Error("wake detector is in failed state.");
    if (this.#state === "disposed") throw new Error("wake detector has been disposed.");

    try {
      validateFrame(frame, this.#config.expectedSampleRate);
    } catch (cause) {
      const error: WakeDetectorError = { code: "INVALID_FRAME", message: "Wake frame validation failed.", cause };
      this.#events.emit("error", error);
      throw cause;
    }

    this.#audioFrames.push(frame.samples.slice());
    while (this.#audioFrames.length > this.#config.captureWindowFrames) {
      this.#audioFrames.shift();
    }

    if (this.#cooldown.active) {
      const stillActive = this.#cooldown.advance();
      if (!stillActive) this.#setState("ready");
      return { status: "cooldown", sequence: frame.sequence, timestampMs: frame.timestampMs, detected: false };
    }

    if (signal.isSpeech === false) {
      this.#silentFrames += 1;
      if (this.#silentFrames >= this.#config.maxSilentFramesBeforeReset) {
        this.#features.reset();
        this.#window.reset();
        this.#policy.reset();
        this.#silentFrames = 0;
      }
      return { status: "gated", sequence: frame.sequence, timestampMs: frame.timestampMs, detected: false };
    }

    this.#silentFrames = 0;
    this.#window.push(this.#features.extract(frame));
    if (!this.#window.isReady) {
      return { status: "warming", sequence: frame.sequence, timestampMs: frame.timestampMs, detected: false };
    }

    try {
      const output = await this.#model.infer(this.#window.toModelInput(frame.sampleRate));
      const decision = this.#policy.evaluate(output.score);
      const scoreEvent = {
        score: output.score,
        ...(output.keyword === undefined ? {} : { keyword: output.keyword }),
        sequence: frame.sequence,
        timestampMs: frame.timestampMs,
        threshold: this.#config.detectionThreshold,
        detected: decision.detected,
      };
      this.#events.emit("score", scoreEvent);

      if (decision.detected) {
        this.#cooldown.enter();
        if (this.#cooldown.active) this.#setState("cooldown");
        this.#events.emit("wake", {
          ...scoreEvent,
          cooldownFrames: this.#config.cooldownFrames,
          audioWindow: concatenateFrames(this.#audioFrames),
          sampleRate: frame.sampleRate,
        });
        this.#window.reset();
      }
      return {
        status: "scored",
        sequence: frame.sequence,
        timestampMs: frame.timestampMs,
        score: output.score,
        detected: decision.detected,
      };
    } catch (cause) {
      this.#fail({ code: "MODEL_INFERENCE_FAILED", message: "Wake model inference failed.", cause });
      throw cause;
    }
  }

  #setState(next: WakeDetectorState): void {
    if (next === this.#state) return;
    const previous = this.#state;
    this.#state = next;
    this.#events.emit("statechange", { previous, current: next });
  }

  #fail(error: WakeDetectorError): void {
    this.#setState("failed");
    this.#events.emit("error", error);
  }
}

function validateConfig(config: ResolvedWakeConfig): void {
  const integers = [config.featureBands, config.windowFrames, config.consecutiveHits, config.maxSilentFramesBeforeReset, config.captureWindowFrames];
  if (integers.some((value) => !Number.isInteger(value) || value < 1)) throw new RangeError("frame and feature counts must be positive integers.");
  if (!Number.isInteger(config.cooldownFrames) || config.cooldownFrames < 0) throw new RangeError("cooldownFrames must be a non-negative integer.");
  if (config.detectionThreshold < 0 || config.detectionThreshold > 1) throw new RangeError("detectionThreshold must be within [0, 1].");
  if (!Number.isFinite(config.expectedSampleRate) || config.expectedSampleRate <= 0) throw new RangeError("expectedSampleRate must be positive.");
  if (config.preEmphasis < 0 || config.preEmphasis >= 1) throw new RangeError("preEmphasis must be within [0, 1).");
}

function validateFrame(frame: WakeFrame, expectedSampleRate: number): void {
  if (!(frame.samples instanceof Float32Array) || frame.samples.length === 0) throw new TypeError("frame.samples must be a non-empty Float32Array.");
  if (frame.sampleRate !== expectedSampleRate) throw new RangeError(`frame.sampleRate must equal ${expectedSampleRate}.`);
  if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) throw new RangeError("durationMs must be positive.");
  if (!Number.isInteger(frame.sequence) || frame.sequence < 0) throw new RangeError("sequence must be a non-negative integer.");
  if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0) throw new RangeError("timestampMs must be non-negative.");
}

function concatenateFrames(frames: readonly Float32Array[]): Float32Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }
  return output;
}
