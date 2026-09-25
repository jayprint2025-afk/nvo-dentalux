export interface CooldownPort {
  readonly active: boolean;
  readonly remaining: number;
  enter(): void;
  advance(): boolean;
  reset(): void;
}

export class FrameCooldownController implements CooldownPort {
  readonly #duration: number;
  #remaining = 0;

  public constructor(durationFrames: number) {
    if (!Number.isInteger(durationFrames) || durationFrames < 0) throw new RangeError("durationFrames must be a non-negative integer.");
    this.#duration = durationFrames;
  }

  public get active(): boolean {
    return this.#remaining > 0;
  }

  public get remaining(): number {
    return this.#remaining;
  }

  public enter(): void {
    this.#remaining = this.#duration;
  }

  public advance(): boolean {
    if (this.#remaining > 0) this.#remaining -= 1;
    return this.active;
  }

  public reset(): void {
    this.#remaining = 0;
  }
}
