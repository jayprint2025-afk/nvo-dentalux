import type { VadFeatures, VadFrame } from "../types/vad.js";

const SILENCE_DBFS = -120;

export interface FeatureExtractor {
  extract(frame: VadFrame): VadFeatures;
}

export class PcmFeatureExtractor implements FeatureExtractor {
  public extract(frame: VadFrame): VadFeatures {
    const samples = frame.samples;
    if (samples.length === 0) {
      return { rms: 0, dbfs: SILENCE_DBFS, zeroCrossingRate: 0, peak: 0 };
    }

    let sumSquares = 0;
    let zeroCrossings = 0;
    let peak = 0;
    let previous = samples[0] ?? 0;

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] ?? 0;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if (index > 0 && ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0))) zeroCrossings += 1;
      previous = sample;
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    const dbfs = rms > 0 ? Math.max(SILENCE_DBFS, 20 * Math.log10(rms)) : SILENCE_DBFS;
    const zeroCrossingRate = samples.length > 1 ? zeroCrossings / (samples.length - 1) : 0;
    return { rms, dbfs, zeroCrossingRate, peak };
  }
}
