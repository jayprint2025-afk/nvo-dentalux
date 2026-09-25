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


/**
 * Professional wake policy: one very strong hit wakes immediately, while
 * medium-confidence candidates need consecutive confirmation. This keeps F1
 * easy to wake deliberately without making background noise permissive.
 */
export class HybridConfidencePolicy implements WakeDetectionPolicy {
  readonly #moderateThreshold: number;
  readonly #strongThreshold: number;
  readonly #requiredModerateHits: number;
  #moderateHits = 0;

  public constructor(moderateThreshold: number, strongThreshold: number, requiredModerateHits = 2) {
    if (moderateThreshold < 0 || moderateThreshold > 1) throw new RangeError("moderateThreshold must be within [0, 1].");
    if (strongThreshold < 0 || strongThreshold > 1) throw new RangeError("strongThreshold must be within [0, 1].");
    if (strongThreshold <= moderateThreshold) throw new RangeError("strongThreshold must be greater than moderateThreshold.");
    if (!Number.isInteger(requiredModerateHits) || requiredModerateHits < 1) throw new RangeError("requiredModerateHits must be a positive integer.");
    this.#moderateThreshold = moderateThreshold;
    this.#strongThreshold = strongThreshold;
    this.#requiredModerateHits = requiredModerateHits;
  }

  public evaluate(score: number): WakePolicyDecision {
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new RangeError("model score must be within [0, 1].");
    if (score >= this.#strongThreshold) {
      this.#moderateHits = 0;
      return { detected: true, score };
    }
    this.#moderateHits = score >= this.#moderateThreshold ? this.#moderateHits + 1 : 0;
    const detected = this.#moderateHits >= this.#requiredModerateHits;
    if (detected) this.#moderateHits = 0;
    return { detected, score };
  }

  public reset(): void { this.#moderateHits = 0; }
}
