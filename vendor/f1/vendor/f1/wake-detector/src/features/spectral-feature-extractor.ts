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
const SAMPLE_RATE = 16000;
const N_FFT = 2048;
const F_MIN = 80;
const F_MAX = 7600;

function hzToMel(hz: number): number {
  const fMin = 0;
  const fSp = 200 / 3;
  let mel = (hz - fMin) / fSp;
  const minLogHz = 1000;
  const minLogMel = (minLogHz - fMin) / fSp;
  const logStep = Math.log(6.4) / 27;
  if (hz >= minLogHz) mel = minLogMel + Math.log(hz / minLogHz) / logStep;
  return mel;
}
function melToHz(mel: number): number {
  const fMin = 0;
  const fSp = 200 / 3;
  let hz = fMin + fSp * mel;
  const minLogHz = 1000;
  const minLogMel = (minLogHz - fMin) / fSp;
  const logStep = Math.log(6.4) / 27;
  if (mel >= minLogMel) hz = minLogHz * Math.exp(logStep * (mel - minLogMel));
  return hz;
}

function fftPowerReal(input: Float64Array): Float64Array {
  const n = N_FFT;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(input.subarray(0, Math.min(input.length, n)));
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wLenRe = Math.cos(angle), wLenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const uRe = re[i + j], uIm = im[i + j];
        const vr = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vi = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vr; im[i + j] = uIm + vi;
        re[i + j + len / 2] = uRe - vr; im[i + j + len / 2] = uIm - vi;
        const nwRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe; wRe = nwRe;
      }
    }
  }
  const power = new Float64Array(n / 2 + 1);
  for (let i = 0; i < power.length; i += 1) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

export class SpectralFeatureExtractor implements WakeFeatureExtractor {
  readonly #bands: number;
  readonly #preEmphasis: number;
  readonly #filters: Float64Array[];
  readonly #window: Float64Array;
  #previousSample = 0;

  public constructor(config: SpectralFeatureConfig) {
    if (!Number.isInteger(config.bands) || config.bands < 4) throw new RangeError("bands must be an integer >= 4.");
    if (config.preEmphasis < 0 || config.preEmphasis >= 1) throw new RangeError("preEmphasis must be within [0, 1).");
    this.#bands = config.bands;
    this.#preEmphasis = config.preEmphasis;
    this.#window = new Float64Array(1280);
    for (let i = 0; i < this.#window.length; i += 1) this.#window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.#window.length - 1));
    this.#filters = this.#buildMelFilters();
  }

  public get featureSize(): number { return this.#bands + 2; }

  #buildMelFilters(): Float64Array[] {
    const minMel = hzToMel(F_MIN), maxMel = hzToMel(F_MAX);
    const hzPoints = Array.from({ length: this.#bands + 2 }, (_, i) => melToHz(minMel + (maxMel - minMel) * i / (this.#bands + 1)));
    const freqs = Array.from({ length: N_FFT / 2 + 1 }, (_, k) => k * SAMPLE_RATE / N_FFT);
    const filters: Float64Array[] = [];
    for (let m = 0; m < this.#bands; m += 1) {
      const lower = hzPoints[m], center = hzPoints[m + 1], upper = hzPoints[m + 2];
      const enorm = 2 / Math.max(upper - lower, EPSILON); // librosa norm="slaney"
      const f = new Float64Array(freqs.length);
      for (let k = 0; k < freqs.length; k += 1) {
        const hz = freqs[k];
        const left = (hz - lower) / Math.max(center - lower, EPSILON);
        const right = (upper - hz) / Math.max(upper - center, EPSILON);
        f[k] = Math.max(0, Math.min(left, right)) * enorm;
      }
      filters.push(f);
    }
    return filters;
  }

  public extract(frame: WakeFrame): WakeFeatures {
    const samples = frame.samples;
    const emphasized = new Float64Array(samples.length);
    let sumSquares = 0, zeroCrossings = 0, previous = this.#previousSample;
    for (let i = 0; i < samples.length; i += 1) {
      const raw = samples[i] ?? 0;
      const value = raw - this.#preEmphasis * previous;
      previous = raw; emphasized[i] = value; sumSquares += value * value;
      if (i > 0) { const before = samples[i - 1] ?? 0; if ((raw >= 0 && before < 0) || (raw < 0 && before >= 0)) zeroCrossings += 1; }
    }
    this.#previousSample = previous;
    const fftInput = new Float64Array(N_FFT);
    for (let i = 0; i < Math.min(samples.length, this.#window.length); i += 1) fftInput[i] = emphasized[i] * this.#window[i];
    const power = fftPowerReal(fftInput);
    const values = new Float32Array(this.featureSize);
    let mean = 0;
    for (let m = 0; m < this.#bands; m += 1) {
      const filter = this.#filters[m]; let energy = 0;
      for (let k = 0; k < power.length; k += 1) energy += filter[k] * power[k];
      const logEnergy = Math.log(Math.max(energy, 1e-10)); values[m] = logEnergy; mean += logEnergy;
    }
    mean /= this.#bands;
    let variance = 0;
    for (let m = 0; m < this.#bands; m += 1) { const c = values[m] - mean; variance += c * c; }
    const sd = Math.sqrt(variance / this.#bands) + 1e-6;
    for (let m = 0; m < this.#bands; m += 1) values[m] = (values[m] - mean) / sd;
    values[this.#bands] = Math.log(Math.sqrt(sumSquares / Math.max(samples.length, 1)) + EPSILON);
    values[this.#bands + 1] = samples.length > 1 ? zeroCrossings / (samples.length - 1) : 0;
    return { values, frameSequence: frame.sequence, timestampMs: frame.timestampMs };
  }

  public reset(): void { this.#previousSample = 0; }
}
