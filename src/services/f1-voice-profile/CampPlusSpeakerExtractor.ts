import * as ort from "onnxruntime-web";
import type { VoiceFingerprint } from "./types";

const TARGET_SAMPLE_RATE = 16_000;
const NFFT = 512;
const MEL_BINS = 80;
const FRAME = 400;
const HOP = 160;
const MODEL_URL = "/hana-speaker/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx";

export class CampPlusSpeakerExtractor {
  private sessionPromise: Promise<ort.InferenceSession> | null = null;

  async fromBlob(blob: Blob): Promise<VoiceFingerprint> {
    const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const mono = decoded.getChannelData(0);
      return await this.fromSamples(mono, decoded.sampleRate);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async fromSamples(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Promise<VoiceFingerprint> {
    const raw = this.resample(samples, sampleRate, TARGET_SAMPLE_RATE);
    const speech = this.vadExtract(raw);
    if (speech.length < TARGET_SAMPLE_RATE * 0.55) {
      throw new Error("Muy poca voz útil para verificar al propietario.");
    }
    const { data, frames } = this.fbank(speech);
    const session = await this.session();
    const output = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", data, [1, frames, MEL_BINS]),
    });
    const tensor = output[session.outputNames[0]];
    const values = Array.from(tensor.data as Float32Array, Number);
    if (values.length !== 192) throw new Error(`CAMPPlus devolvió ${values.length} valores; se esperaban 192.`);
    return { values, durationMs: Math.round((speech.length / TARGET_SAMPLE_RATE) * 1000), sampleRate: TARGET_SAMPLE_RATE };
  }

  similarity(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
    }
    return dot / (Math.sqrt(aa * bb) || 1);
  }

  centroid(vectors: number[][]): number[] {
    if (!vectors.length) return [];
    const n = vectors[0].length;
    const out = new Array<number>(n).fill(0);
    const valid = vectors.filter((v) => v.length === n);
    for (const v of valid) for (let i = 0; i < n; i += 1) out[i] += v[i] / valid.length;
    return out;
  }

  private session(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    }
    return this.sessionPromise;
  }

  private resample(input: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return Float32Array.from(input);
    const length = Math.round(input.length * to / from);
    const out = new Float32Array(length);
    const ratio = from / to;
    for (let i = 0; i < length; i += 1) {
      const p = i * ratio, a = Math.floor(p), b = Math.min(a + 1, input.length - 1), f = p - a;
      out[i] = (input[a] || 0) * (1 - f) + (input[b] || 0) * f;
    }
    return out;
  }

  private vadExtract(input: Float32Array): Float32Array {
    const positions: number[] = [], energies: number[] = [];
    for (let p = 0; p + FRAME <= input.length; p += HOP) {
      positions.push(p);
      let sum = 0;
      for (let i = 0; i < FRAME; i += 1) { const v = input[p + i] || 0; sum += v * v; }
      energies.push(Math.sqrt(sum / FRAME));
    }
    const percentile = (p: number) => {
      const sorted = [...energies].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))] || 0;
    };
    const floor = percentile(0.25), hi = percentile(0.90);
    const threshold = Math.max(floor * 2.2, floor + (hi - floor) * 0.18, 0.004);
    const active = energies.map((e) => e >= threshold);
    for (let i = 1; i < active.length - 1; i += 1) if (!active[i] && active[i - 1] && active[i + 1]) active[i] = true;
    const runs: Array<[number, number]> = [];
    for (let i = 0; i < active.length;) {
      if (!active[i]) { i += 1; continue; }
      let j = i; while (j < active.length && active[j]) j += 1;
      if (j - i >= 8) runs.push([Math.max(0, i - 5), Math.min(active.length, j + 8)]);
      i = j;
    }
    const spans: Array<[number, number]> = [];
    for (const [a, b] of runs) {
      const start = a * HOP, end = Math.min(input.length, (b - 1) * HOP + FRAME);
      const last = spans[spans.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end); else spans.push([start, end]);
    }
    const total = spans.reduce((sum, [a, b]) => sum + b - a, 0);
    const out = new Float32Array(total); let offset = 0;
    for (const [a, b] of spans) { out.set(input.subarray(a, b), offset); offset += b - a; }
    return out;
  }

  private fbank(wave: Float32Array): { data: Float32Array; frames: number } {
    const hz2mel = (h: number) => 2595 * Math.log10(1 + h / 700);
    const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
    const lo = hz2mel(20), hi = hz2mel(7600);
    const points = Array.from({ length: MEL_BINS + 2 }, (_, i) => mel2hz(lo + (hi - lo) * i / (MEL_BINS + 1)));
    const bins = points.map((h) => Math.floor((NFFT + 1) * h / TARGET_SAMPLE_RATE));
    const frames = Math.max(1, Math.floor((wave.length - FRAME) / HOP) + 1);
    const out = new Float32Array(frames * MEL_BINS);
    for (let t = 0; t < frames; t += 1) {
      const frame = new Float32Array(NFFT);
      for (let i = 0; i < FRAME; i += 1) frame[i] = (wave[t * HOP + i] || 0) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
      const power = this.fftPower(frame);
      for (let m = 1; m <= MEL_BINS; m += 1) {
        let sum = 0; const l = bins[m - 1], c = bins[m], r = bins[m + 1];
        for (let k = l; k < c; k += 1) sum += power[k] * (k - l) / Math.max(1, c - l);
        for (let k = c; k < r; k += 1) sum += power[k] * (r - k) / Math.max(1, r - c);
        out[t * MEL_BINS + m - 1] = Math.log(Math.max(sum, 1e-10));
      }
    }
    for (let d = 0; d < MEL_BINS; d += 1) {
      let mean = 0; for (let t = 0; t < frames; t += 1) mean += out[t * MEL_BINS + d] / frames;
      for (let t = 0; t < frames; t += 1) out[t * MEL_BINS + d] -= mean;
    }
    return { data: out, frames };
  }

  private fftPower(frame: Float32Array): Float32Array {
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT); re.set(frame);
    for (let i = 1, j = 0; i < NFFT; i += 1) {
      let bit = NFFT >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= NFFT; len <<= 1) {
      const angle = -2 * Math.PI / len;
      for (let i = 0; i < NFFT; i += len) for (let j = 0; j < len / 2; j += 1) {
        const co = Math.cos(angle * j), si = Math.sin(angle * j), ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * co - im[i + j + len / 2] * si;
        const vi = re[i + j + len / 2] * si + im[i + j + len / 2] * co;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
      }
    }
    const out = new Float32Array(NFFT / 2 + 1);
    for (let i = 0; i < out.length; i += 1) out[i] = (re[i] * re[i] + im[i] * im[i]) / NFFT;
    return out;
  }
}
