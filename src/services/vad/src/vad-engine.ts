import { TypedEventBus, type EventListener, type Unsubscribe } from "./events/typed-event-bus.js";
import { PcmFeatureExtractor, type FeatureExtractor } from "./features/pcm-feature-extractor.js";
import { AdaptiveNoiseFloor } from "./noise/adaptive-noise-floor.js";
import { AdaptiveEnergyPolicy, type DecisionPolicy } from "./policy/adaptive-energy-policy.js";
import { SpeechStateMachine } from "./state/speech-state-machine.js";
import type { VadEventMap } from "./types/events.js";
import type { VadConfig, VadFrame, VadProcessor, VadResult, VadState } from "./types/vad.js";

interface ResolvedVadConfig {
  readonly speechThresholdDb: number;
  readonly minimumThresholdDbfs: number;
  readonly initialNoiseFloorDbfs: number;
  readonly noiseFloorAdaptation: number;
  readonly confidenceRangeDb: number;
  readonly minSpeechFrames: number;
  readonly minSilenceFrames: number;
  readonly hangoverFrames: number;
  readonly maxZeroCrossingRate: number;
}

const DEFAULTS: ResolvedVadConfig = {
  speechThresholdDb: 10,
  minimumThresholdDbfs: -50,
  initialNoiseFloorDbfs: -60,
  noiseFloorAdaptation: 0.05,
  confidenceRangeDb: 20,
  minSpeechFrames: 2,
  minSilenceFrames: 3,
  hangoverFrames: 2,
  maxZeroCrossingRate: 0.35,
};

export interface VadEngineDependencies {
  readonly featureExtractor?: FeatureExtractor;
  readonly decisionPolicy?: DecisionPolicy;
}

export class VadEngine implements VadProcessor {
  readonly #events = new TypedEventBus<VadEventMap>();
  readonly #featureExtractor: FeatureExtractor;
  readonly #policy: DecisionPolicy;
  readonly #stateMachine: SpeechStateMachine;
  #state: VadState = "idle";

  public constructor(config: VadConfig = {}, dependencies: VadEngineDependencies = {}) {
    const resolved = { ...DEFAULTS, ...config };
    validateConfig(resolved);
    const noiseFloor = new AdaptiveNoiseFloor(resolved.initialNoiseFloorDbfs, resolved.noiseFloorAdaptation);
    this.#featureExtractor = dependencies.featureExtractor ?? new PcmFeatureExtractor();
    this.#policy = dependencies.decisionPolicy ?? new AdaptiveEnergyPolicy(noiseFloor, resolved);
    this.#stateMachine = new SpeechStateMachine(resolved);
  }

  public get state(): VadState {
    return this.#state;
  }

  public on<TKey extends keyof VadEventMap>(event: TKey, listener: EventListener<VadEventMap[TKey]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  public once<TKey extends keyof VadEventMap>(event: TKey, listener: EventListener<VadEventMap[TKey]>): Unsubscribe {
    return this.#events.once(event, listener);
  }

  public off<TKey extends keyof VadEventMap>(event: TKey, listener: EventListener<VadEventMap[TKey]>): void {
    this.#events.off(event, listener);
  }

  public process(frame: VadFrame): VadResult {
    validateFrame(frame);
    const previous = this.#state;
    const features = this.#featureExtractor.extract(frame);
    const decision = this.#policy.decide(features);
    const transition = this.#stateMachine.advance(decision.isSpeech);
    this.#state = transition.state;

    if (previous !== this.#state) this.#events.emit("statechange", { previous, current: this.#state });

    const result: VadResult = {
      ...decision,
      state: transition.state,
      sequence: frame.sequence,
      timestampMs: frame.timestampMs,
      durationMs: frame.durationMs,
    };

    if (transition.started) {
      this.#events.emit("speechstart", {
        sequence: frame.sequence,
        timestampMs: frame.timestampMs,
        confidence: decision.confidence,
      });
    }
    this.#events.emit("result", result);
    if (transition.ended) {
      this.#events.emit("speechend", {
        sequence: frame.sequence,
        timestampMs: frame.timestampMs + frame.durationMs,
        confidence: decision.confidence,
      });
    }
    return result;
  }

  public reset(): void {
    const previous = this.#state;
    this.#policy.reset();
    this.#stateMachine.reset();
    this.#state = "idle";
    if (previous !== "idle") this.#events.emit("statechange", { previous, current: "idle" });
  }
}

function validateConfig(config: ResolvedVadConfig): void {
  const positiveIntegers = [config.minSpeechFrames, config.minSilenceFrames];
  if (positiveIntegers.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new RangeError("minSpeechFrames and minSilenceFrames must be positive integers.");
  }
  if (!Number.isInteger(config.hangoverFrames) || config.hangoverFrames < 0) {
    throw new RangeError("hangoverFrames must be a non-negative integer.");
  }
  if (config.noiseFloorAdaptation <= 0 || config.noiseFloorAdaptation > 1) {
    throw new RangeError("noiseFloorAdaptation must be within (0, 1].");
  }
  if (config.confidenceRangeDb <= 0) throw new RangeError("confidenceRangeDb must be greater than zero.");
  if (config.maxZeroCrossingRate < 0 || config.maxZeroCrossingRate > 1) {
    throw new RangeError("maxZeroCrossingRate must be within [0, 1].");
  }
}

function validateFrame(frame: VadFrame): void {
  if (!(frame.samples instanceof Float32Array) || frame.samples.length === 0) {
    throw new TypeError("frame.samples must be a non-empty Float32Array.");
  }
  if (!Number.isFinite(frame.sampleRate) || frame.sampleRate <= 0) throw new RangeError("sampleRate must be positive.");
  if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) throw new RangeError("durationMs must be positive.");
}
