export interface WakePolicyDecision {
  readonly detected: boolean;
  readonly score: number;
}

export interface WakeDetectionPolicy {
  evaluate(score: number): WakePolicyDecision;
  reset(): void;
}

export class ConsecutiveHitPolicy implements WakeDetectionPolicy {
  readonly #threshold: number;
  readonly #requiredHits: number;
  #hits = 0;

  public constructor(threshold: number, requiredHits: number) {
    if (threshold < 0 || threshold > 1) throw new RangeError("threshold must be within [0, 1].");
    if (!Number.isInteger(requiredHits) || requiredHits < 1) throw new RangeError("requiredHits must be a positive integer.");
    this.#threshold = threshold;
    this.#requiredHits = requiredHits;
  }

  public evaluate(score: number): WakePolicyDecision {
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new RangeError("model score must be within [0, 1].");
    this.#hits = score >= this.#threshold ? this.#hits + 1 : 0;
    const detected = this.#hits >= this.#requiredHits;
    if (detected) this.#hits = 0;
    return { detected, score };
  }

  public reset(): void {
    this.#hits = 0;
  }
}
