import type { WakeFeatures, WakeFrame } from "../types/wake.js";

export interface WakeFeatureExtractor {
  readonly featureSize: number;
  extract(frame: WakeFrame): WakeFeatures;
  reset(): void;
}

export interface SpectralFeatureConfig {
  readonly bands: number;
  readonly preEmphasis: number;
}

const EPSILON = 1e-12;

export class SpectralFeatureExtractor implements WakeFeatureExtractor {
  readonly #bands: number;
  readonly #preEmphasis: number;
  #previousSample = 0;

  public constructor(config: SpectralFeatureConfig) {
    if (!Number.isInteger(config.bands) || config.bands < 4) throw new RangeError("bands must be an integer >= 4.");
    if (config.preEmphasis < 0 || config.preEmphasis >= 1) throw new RangeError("preEmphasis must be within [0, 1).");
    this.#bands = config.bands;
    this.#preEmphasis = config.preEmphasis;
  }

  public get featureSize(): number {
    return this.#bands + 2;
  }

  public extract(frame: WakeFrame): WakeFeatures {
    const samples = frame.samples;
    const energies = new Float64Array(this.#bands);
    let sumSquares = 0;
    let zeroCrossings = 0;
    let previous = this.#previousSample;

    for (let index = 0; index < samples.length; index += 1) {
      const raw = samples[index] ?? 0;
      const emphasized = raw - this.#preEmphasis * previous;
      previous = raw;
      sumSquares += emphasized * emphasized;
      if (index > 0) {
        const before = samples[index - 1] ?? 0;
        if ((raw >= 0 && before < 0) || (raw < 0 && before >= 0)) zeroCrossings += 1;
      }
      const band = Math.min(this.#bands - 1, Math.floor(index * this.#bands / samples.length));
      energies[band] = (energies[band] ?? 0) + emphasized * emphasized;
    }
    this.#previousSample = previous;

    const values = new Float32Array(this.featureSize);
    let mean = 0;
    for (let band = 0; band < this.#bands; band += 1) {
      const logEnergy = Math.log((energies[band] ?? 0) + EPSILON);
      values[band] = logEnergy;
      mean += logEnergy;
    }
    mean /= this.#bands;

    let variance = 0;
    for (let band = 0; band < this.#bands; band += 1) {
      const centered = (values[band] ?? 0) - mean;
      variance += centered * centered;
    }
    const standardDeviation = Math.sqrt(variance / this.#bands) || 1;
    for (let band = 0; band < this.#bands; band += 1) {
      values[band] = ((values[band] ?? 0) - mean) / standardDeviation;
    }

    values[this.#bands] = Math.log(Math.sqrt(sumSquares / samples.length) + EPSILON);
    values[this.#bands + 1] = samples.length > 1 ? zeroCrossings / (samples.length - 1) : 0;
    return { values, frameSequence: frame.sequence, timestampMs: frame.timestampMs };
  }

  public reset(): void {
    this.#previousSample = 0;
  }
}
