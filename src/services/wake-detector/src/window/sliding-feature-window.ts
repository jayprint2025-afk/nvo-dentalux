import type { WakeFeatures, WakeModelInput } from "../types/wake.js";

export interface FeatureWindow {
  readonly isReady: boolean;
  push(features: WakeFeatures): void;
  toModelInput(sampleRate: number): WakeModelInput;
  reset(): void;
}

export class SlidingFeatureWindow implements FeatureWindow {
  readonly #capacity: number;
  readonly #featureSize: number;
  readonly #frames: Float32Array[] = [];

  public constructor(capacity: number, featureSize: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer.");
    if (!Number.isInteger(featureSize) || featureSize < 1) throw new RangeError("featureSize must be a positive integer.");
    this.#capacity = capacity;
    this.#featureSize = featureSize;
  }

  public get isReady(): boolean {
    return this.#frames.length === this.#capacity;
  }

  public push(features: WakeFeatures): void {
    if (features.values.length !== this.#featureSize) throw new RangeError("feature vector size does not match window configuration.");
    this.#frames.push(features.values.slice());
    if (this.#frames.length > this.#capacity) this.#frames.shift();
  }

  public toModelInput(sampleRate: number): WakeModelInput {
    if (!this.isReady) throw new Error("feature window is not ready.");
    const data = new Float32Array(this.#capacity * this.#featureSize);
    this.#frames.forEach((frame, frameIndex) => data.set(frame, frameIndex * this.#featureSize));
    return { data, shape: [1, this.#capacity, this.#featureSize], sampleRate };
  }

  public reset(): void {
    this.#frames.length = 0;
  }
}
