import { AudioEngineError } from "../types/errors.js";

export interface AudioResampler {
  process(input: Float32Array, inputSampleRate: number): Float32Array;
  reset(): void;
}

export class StreamingLinearResampler implements AudioResampler {
  readonly #outputSampleRate: number;
  #inputSampleRate: number | undefined;
  #buffer = new Float32Array(0);
  #position = 0;

  public constructor(outputSampleRate: number) {
    if (!Number.isInteger(outputSampleRate) || outputSampleRate <= 0) {
      throw new AudioEngineError("INVALID_CONFIG", "Output sample rate must be a positive integer.");
    }
    this.#outputSampleRate = outputSampleRate;
  }

  public process(input: Float32Array, inputSampleRate: number): Float32Array {
    if (!Number.isInteger(inputSampleRate) || inputSampleRate <= 0) {
      throw new AudioEngineError("INVALID_AUDIO_CHUNK", "Input sample rate must be a positive integer.");
    }
    if (input.length === 0) return new Float32Array(0);

    if (this.#inputSampleRate !== undefined && this.#inputSampleRate !== inputSampleRate) {
      this.reset();
    }
    this.#inputSampleRate = inputSampleRate;

    if (inputSampleRate === this.#outputSampleRate) {
      if (this.#buffer.length === 0) return input.slice();
      const merged = this.#merge(this.#buffer, input);
      this.#buffer = new Float32Array(0);
      this.#position = 0;
      return merged;
    }

    const source = this.#merge(this.#buffer, input);
    const ratio = inputSampleRate / this.#outputSampleRate;
    const output: number[] = [];

    while (this.#position + 1 < source.length) {
      const leftIndex = Math.floor(this.#position);
      const fraction = this.#position - leftIndex;
      const left = source[leftIndex] ?? 0;
      const right = source[leftIndex + 1] ?? left;
      output.push(left + (right - left) * fraction);
      this.#position += ratio;
    }

    const consumed = Math.floor(this.#position);
    this.#buffer = source.slice(consumed);
    this.#position -= consumed;
    return Float32Array.from(output);
  }

  public reset(): void {
    this.#inputSampleRate = undefined;
    this.#buffer = new Float32Array(0);
    this.#position = 0;
  }

  #merge(left: Float32Array, right: Float32Array): Float32Array {
    if (left.length === 0) return right.slice();
    const merged = new Float32Array(left.length + right.length);
    merged.set(left, 0);
    merged.set(right, left.length);
    return merged;
  }
}
