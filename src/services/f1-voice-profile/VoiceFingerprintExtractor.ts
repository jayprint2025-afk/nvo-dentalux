import type { VoiceFingerprint } from "./types";

const TARGET_SAMPLE_RATE = 16_000;
const BAND_COUNT = 24;
const SEGMENT_COUNT = 4;
const FRAME_SIZE = 512;
const FRAME_HOP = 256;

/**
 * V43 local speaker/phrase fingerprint.
 *
 * This is intentionally much richer than the old 14-value fingerprint.
 * It trims silence, keeps spectral shape over time, and adds temporal/energy
 * statistics. It is still fully local and does not call OpenAI.
 *
 * IMPORTANT: because the vector format changed, VoiceProfileService V43
 * automatically invalidates old enrollment samples and requires re-enrollment.
 */
export class VoiceFingerprintExtractor {
  async fromBlob(blob: Blob): Promise<VoiceFingerprint> {
    const bytes = await blob.arrayBuffer();
    const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

    try {
      const decoded = await context.decodeAudioData(bytes.slice(0));
      const mono = this.toMono(decoded);
      const resampled = this.resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
      const speech = this.trimToSpeech(resampled);

      return {
        values: this.extract(speech),
        durationMs: Math.round((speech.length / TARGET_SAMPLE_RATE) * 1000),
        sampleRate: TARGET_SAMPLE_RATE,
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  fromSamples(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): VoiceFingerprint {
    const resampled = this.resample(samples, sampleRate, TARGET_SAMPLE_RATE);
    const speech = this.trimToSpeech(resampled);
    return {
      values: this.extract(speech),
      durationMs: Math.round((speech.length / TARGET_SAMPLE_RATE) * 1000),
      sampleRate: TARGET_SAMPLE_RATE,
    };
  }

  similarity(left: number[], right: number[]): number {
    if (!left.length || left.length !== right.length) return 0;

    let dot = 0;
    let normLeft = 0;
    let normRight = 0;
    for (let i = 0; i < left.length; i += 1) {
      const a = Number(left[i] || 0);
      const b = Number(right[i] || 0);
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
    if (!size || fingerprints.some((fp) => fp.length !== size)) return [];

    const result = new Array<number>(size).fill(0);
    for (const fp of fingerprints) {
      for (let i = 0; i < size; i += 1) result[i] += Number(fp[i] || 0);
    }
    return this.normalize(result.map((v) => v / fingerprints.length));
  }

  private trimToSpeech(input: Float32Array): Float32Array {
    if (input.length < 320) return input;

    const frame = 320; // 20 ms
    const energies: number[] = [];
    let peak = 0;

    for (let offset = 0; offset < input.length; offset += frame) {
      const end = Math.min(input.length, offset + frame);
      let sum = 0;
      for (let i = offset; i < end; i += 1) sum += (input[i] || 0) ** 2;
      const rms = Math.sqrt(sum / Math.max(1, end - offset));
      energies.push(rms);
      peak = Math.max(peak, rms);
    }

    const threshold = Math.max(0.006, peak * 0.14);
    let first = energies.findIndex((e) => e >= threshold);
    if (first < 0) return input;
    let last = energies.length - 1;
    while (last > first && energies[last] < threshold) last -= 1;

    const padFrames = 4; // ~80 ms
    first = Math.max(0, first - padFrames);
    last = Math.min(energies.length - 1, last + padFrames);

    const start = first * frame;
    const end = Math.min(input.length, (last + 1) * frame);
    return input.slice(start, end);
  }

  private extract(samples: Float32Array): number[] {
    if (!samples.length) return [];

    const frameFeatures: number[][] = [];
    const frameRms: number[] = [];
    const frameZcr: number[] = [];

    for (let offset = 0; offset + FRAME_SIZE <= samples.length; offset += FRAME_HOP) {
      const frame = samples.subarray(offset, offset + FRAME_SIZE);
      const magnitudes = this.dftMagnitudes(frame);
      const bands = new Array<number>(BAND_COUNT).fill(0);

      for (let band = 0; band < BAND_COUNT; band += 1) {
        // Slightly denser low-frequency allocation where speaker timbre matters.
        const lo = Math.pow(band / BAND_COUNT, 1.55);
        const hi = Math.pow((band + 1) / BAND_COUNT, 1.55);
        const start = Math.min(magnitudes.length - 1, Math.floor(lo * magnitudes.length));
        const end = Math.max(start + 1, Math.min(magnitudes.length, Math.floor(hi * magnitudes.length)));

        let total = 0;
        for (let i = start; i < end; i += 1) total += magnitudes[i] || 0;
        bands[band] = Math.log1p(total / Math.max(1, end - start));
      }

      let energy = 0;
      let crossings = 0;
      let previous = frame[0] || 0;
      for (let i = 0; i < frame.length; i += 1) {
        const v = frame[i] || 0;
        energy += v * v;
        if (i && ((previous >= 0 && v < 0) || (previous < 0 && v >= 0))) crossings += 1;
        previous = v;
      }

      frameFeatures.push(bands);
      frameRms.push(Math.sqrt(energy / frame.length));
      frameZcr.push(crossings / frame.length);
    }

    if (!frameFeatures.length) return [];

    const mean = new Array<number>(BAND_COUNT).fill(0);
    const std = new Array<number>(BAND_COUNT).fill(0);

    for (const features of frameFeatures) {
      for (let b = 0; b < BAND_COUNT; b += 1) mean[b] += features[b] || 0;
    }
    for (let b = 0; b < BAND_COUNT; b += 1) mean[b] /= frameFeatures.length;

    for (const features of frameFeatures) {
      for (let b = 0; b < BAND_COUNT; b += 1) {
        const d = (features[b] || 0) - mean[b];
        std[b] += d * d;
      }
    }
    for (let b = 0; b < BAND_COUNT; b += 1) std[b] = Math.sqrt(std[b] / frameFeatures.length);

    // Preserve the spectral evolution of the exact wake phrase in 4 normalized segments.
    const segments: number[] = [];
    for (let s = 0; s < SEGMENT_COUNT; s += 1) {
      const from = Math.floor((s / SEGMENT_COUNT) * frameFeatures.length);
      const to = Math.max(from + 1, Math.floor(((s + 1) / SEGMENT_COUNT) * frameFeatures.length));
      for (let b = 0; b < BAND_COUNT; b += 1) {
        let total = 0;
        let count = 0;
        for (let i = from; i < Math.min(to, frameFeatures.length); i += 1) {
          total += frameFeatures[i][b] || 0;
          count += 1;
        }
        segments.push(count ? total / count : 0);
      }
    }

    const meanRms = frameRms.reduce((a, b) => a + b, 0) / frameRms.length;
    const meanZcr = frameZcr.reduce((a, b) => a + b, 0) / frameZcr.length;
    const durationSec = samples.length / TARGET_SAMPLE_RATE;

    return this.normalize([
      ...mean,
      ...std,
      ...segments,
      Math.log1p(meanRms * 100),
      meanZcr,
      Math.min(2.5, durationSec) / 2.5,
    ]);
  }

  private dftMagnitudes(frame: Float32Array): Float32Array {
    const bins = frame.length / 2;
    const result = new Float32Array(bins);

    for (let bin = 0; bin < bins; bin += 1) {
      let real = 0;
      let imaginary = 0;
      for (let i = 0; i < frame.length; i += 1) {
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame.length - 1));
        const value = (frame[i] || 0) * window;
        const angle = (2 * Math.PI * bin * i) / frame.length;
        real += value * Math.cos(angle);
        imaginary -= value * Math.sin(angle);
      }
      result[bin] = Math.sqrt(real * real + imaginary * imaginary);
    }
    return result;
  }

  private toMono(buffer: AudioBuffer): Float32Array {
    const result = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const values = buffer.getChannelData(channel);
      for (let i = 0; i < values.length; i += 1) {
        result[i] += values[i] / buffer.numberOfChannels;
      }
    }
    return result;
  }

  private resample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
    if (sourceRate === targetRate) return input;
    const ratio = sourceRate / targetRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const result = new Float32Array(length);

    for (let i = 0; i < length; i += 1) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = position - left;
      result[i] = (input[left] || 0) * (1 - fraction) + (input[right] || 0) * fraction;
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
