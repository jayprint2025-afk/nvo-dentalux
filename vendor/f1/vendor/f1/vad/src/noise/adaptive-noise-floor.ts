export interface NoiseFloorEstimator {
  readonly valueDbfs: number;
  observe(dbfs: number, isSpeech: boolean): number;
  reset(): void;
}

export class AdaptiveNoiseFloor implements NoiseFloorEstimator {
  readonly #initialDbfs: number;
  readonly #adaptation: number;
  #valueDbfs: number;

  public constructor(initialDbfs: number, adaptation: number) {
    this.#initialDbfs = initialDbfs;
    this.#valueDbfs = initialDbfs;
    this.#adaptation = adaptation;
  }

  public get valueDbfs(): number {
    return this.#valueDbfs;
  }

  public observe(dbfs: number, isSpeech: boolean): number {
    if (!isSpeech && Number.isFinite(dbfs)) {
      this.#valueDbfs += this.#adaptation * (dbfs - this.#valueDbfs);
    }
    return this.#valueDbfs;
  }

  public reset(): void {
    this.#valueDbfs = this.#initialDbfs;
  }
}
