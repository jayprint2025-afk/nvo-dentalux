import { AudioEngineError } from "../types/errors.js";

export class FrameAssembler {
  readonly #frameSize: number;
  #buffer = new Float32Array(0);

  public constructor(frameSize: number) {
    if (!Number.isInteger(frameSize) || frameSize <= 0) {
      throw new AudioEngineError("INVALID_CONFIG", "Frame size must be a positive integer.");
    }
    this.#frameSize = frameSize;
  }

  public push(samples: Float32Array): readonly Float32Array[] {
    if (samples.length === 0) return [];
    const merged = new Float32Array(this.#buffer.length + samples.length);
    merged.set(this.#buffer, 0);
    merged.set(samples, this.#buffer.length);

    const frames: Float32Array[] = [];
    let offset = 0;
    while (offset + this.#frameSize <= merged.length) {
      frames.push(merged.slice(offset, offset + this.#frameSize));
      offset += this.#frameSize;
    }
    this.#buffer = merged.slice(offset);
    return frames;
  }

  public reset(): void {
    this.#buffer = new Float32Array(0);
  }

  public get pendingSamples(): number {
    return this.#buffer.length;
  }
}
