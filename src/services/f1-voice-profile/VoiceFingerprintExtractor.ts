import type { VoiceFingerprint } from "./types";

const TARGET_SAMPLE_RATE = 16_000;
const BAND_COUNT = 12;

export class VoiceFingerprintExtractor {
  async fromBlob(blob: Blob): Promise<VoiceFingerprint> {
    const bytes = await blob.arrayBuffer();
    const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

    try {
      const decoded = await context.decodeAudioData(bytes.slice(0));
      const mono = this.toMono(decoded);
      const resampled = this.resample(
        mono,
        decoded.sampleRate,
        TARGET_SAMPLE_RATE,
      );

      return {
        values: this.extract(resampled),
        durationMs: Math.round((resampled.length / TARGET_SAMPLE_RATE) * 1000),
        sampleRate: TARGET_SAMPLE_RATE,
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  similarity(left: number[], right: number[]): number {
    if (!left.length || left.length !== right.length) return 0;

    let dot = 0;
    let normLeft = 0;
    let normRight = 0;

    for (let index = 0; index < left.length; index += 1) {
      const a = Number(left[index] || 0);
      const b = Number(right[index] || 0);
      dot += a * b;
      normLeft += a * a;
      normRight += b * b;
    }

    if (!normLeft || !normRight) return 0;
    return Math.max(0, Math.min(1, dot / Math.sqrt(normLeft * normRight)));
  }

  centroid(fingerprints: number[][]): number[] {
    if (!fingerprints.length) return [];
    const size = fingerprints[0]?.length ?? 0;
    const result = new Array<number>(size).fill(0);

    for (const fingerprint of fingerprints) {
      for (let index = 0; index < size; index += 1) {
        result[index] += Number(fingerprint[index] || 0);
      }
    }

    return this.normalize(result.map((value) => value / fingerprints.length));
  }

  private toMono(buffer: AudioBuffer): Float32Array {
    const result = new Float32Array(buffer.length);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const values = buffer.getChannelData(channel);
      for (let index = 0; index < values.length; index += 1) {
        result[index] += values[index] / buffer.numberOfChannels;
      }
    }

    return result;
  }

  private resample(
    input: Float32Array,
    sourceRate: number,
    targetRate: number,
  ): Float32Array {
    if (sourceRate === targetRate) return input;

    const ratio = sourceRate / targetRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const result = new Float32Array(length);

    for (let index = 0; index < length; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = position - left;
      result[index] =
        (input[left] || 0) * (1 - fraction) +
        (input[right] || 0) * fraction;
    }

    return result;
  }

  private extract(samples: Float32Array): number[] {
    if (!samples.length) return [];

    let energy = 0;
    let crossings = 0;
    let previous = samples[0] || 0;

    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index] || 0;
      energy += value * value;

      if (
        index > 0 &&
        ((previous >= 0 && value < 0) || (previous < 0 && value >= 0))
      ) {
        crossings += 1;
      }
      previous = value;
    }

    const rms = Math.sqrt(energy / samples.length);
    const zcr = crossings / samples.length;
    const frameSize = 512;
    const bands = new Array<number>(BAND_COUNT).fill(0);
    let frameCount = 0;

    for (
      let offset = 0;
      offset + frameSize <= samples.length;
      offset += frameSize
    ) {
      const magnitudes = this.dftMagnitudes(samples.subarray(offset, offset + frameSize));

      for (let band = 0; band < BAND_COUNT; band += 1) {
        const start = Math.floor((band / BAND_COUNT) * magnitudes.length);
        const end = Math.max(
          start + 1,
          Math.floor(((band + 1) / BAND_COUNT) * magnitudes.length),
        );

        let total = 0;
        for (let index = start; index < end; index += 1) {
          total += magnitudes[index] || 0;
        }
        bands[band] += Math.log1p(total / (end - start));
      }

      frameCount += 1;
    }

    const averagedBands = bands.map((value) =>
      frameCount ? value / frameCount : 0,
    );

    return this.normalize([rms, zcr, ...averagedBands]);
  }

  private dftMagnitudes(frame: Float32Array): Float32Array {
    const bins = frame.length / 2;
    const result = new Float32Array(bins);

    for (let bin = 0; bin < bins; bin += 1) {
      let real = 0;
      let imaginary = 0;

      for (let index = 0; index < frame.length; index += 1) {
        const window =
          0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frame.length - 1));
        const value = (frame[index] || 0) * window;
        const angle = (2 * Math.PI * bin * index) / frame.length;
        real += value * Math.cos(angle);
        imaginary -= value * Math.sin(angle);
      }

      result[bin] = Math.sqrt(real * real + imaginary * imaginary);
    }

    return result;
  }

  private normalize(values: number[]): number[] {
    let norm = 0;
    for (const value of values) norm += value * value;
    norm = Math.sqrt(norm);

    if (!norm) return values.map(() => 0);
    return values.map((value) => value / norm);
  }
}
