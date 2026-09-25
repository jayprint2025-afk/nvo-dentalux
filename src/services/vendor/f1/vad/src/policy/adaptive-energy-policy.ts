import type { VadDecision, VadFeatures } from "../types/vad.js";
import type { NoiseFloorEstimator } from "../noise/adaptive-noise-floor.js";

export interface DecisionPolicy {
  decide(features: VadFeatures): VadDecision;
  reset(): void;
}

export interface AdaptiveEnergyPolicyConfig {
  readonly speechThresholdDb: number;
  readonly minimumThresholdDbfs: number;
  readonly confidenceRangeDb: number;
  readonly maxZeroCrossingRate: number;
}

export class AdaptiveEnergyPolicy implements DecisionPolicy {
  readonly #noiseFloor: NoiseFloorEstimator;
  readonly #config: AdaptiveEnergyPolicyConfig;

  public constructor(noiseFloor: NoiseFloorEstimator, config: AdaptiveEnergyPolicyConfig) {
    this.#noiseFloor = noiseFloor;
    this.#config = config;
  }

  public decide(features: VadFeatures): VadDecision {
    const thresholdDbfs = Math.max(
      this.#config.minimumThresholdDbfs,
      this.#noiseFloor.valueDbfs + this.#config.speechThresholdDb,
    );
    const energyMargin = features.dbfs - thresholdDbfs;
    const spectralGate = features.zeroCrossingRate <= this.#config.maxZeroCrossingRate;
    const isSpeech = energyMargin >= 0 && spectralGate;
    const confidence = Math.max(0, Math.min(1, 0.5 + energyMargin / this.#config.confidenceRangeDb));
    const noiseFloorDbfs = this.#noiseFloor.observe(features.dbfs, isSpeech);

    return { isSpeech, confidence, thresholdDbfs, noiseFloorDbfs, features };
  }

  public reset(): void {
    this.#noiseFloor.reset();
  }
}
