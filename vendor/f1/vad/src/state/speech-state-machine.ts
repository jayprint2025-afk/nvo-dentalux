import type { VadState } from "../types/vad.js";

export interface SpeechStateConfig {
  readonly minSpeechFrames: number;
  readonly minSilenceFrames: number;
  readonly hangoverFrames: number;
}

export interface SpeechStateTransition {
  readonly state: Exclude<VadState, "idle">;
  readonly started: boolean;
  readonly ended: boolean;
}

export class SpeechStateMachine {
  readonly #config: SpeechStateConfig;
  #state: Exclude<VadState, "idle"> = "silence";
  #speechFrames = 0;
  #silenceFrames = 0;
  #hangoverRemaining = 0;

  public constructor(config: SpeechStateConfig) {
    this.#config = config;
  }

  public get state(): Exclude<VadState, "idle"> {
    return this.#state;
  }

  public advance(candidateSpeech: boolean): SpeechStateTransition {
    let started = false;
    let ended = false;

    if (this.#state === "silence") {
      this.#speechFrames = candidateSpeech ? this.#speechFrames + 1 : 0;
      if (this.#speechFrames >= this.#config.minSpeechFrames) {
        this.#state = "speech";
        this.#silenceFrames = 0;
        this.#hangoverRemaining = this.#config.hangoverFrames;
        started = true;
      }
    } else if (candidateSpeech) {
      this.#silenceFrames = 0;
      this.#hangoverRemaining = this.#config.hangoverFrames;
    } else if (this.#hangoverRemaining > 0) {
      this.#hangoverRemaining -= 1;
    } else {
      this.#silenceFrames += 1;
      if (this.#silenceFrames >= this.#config.minSilenceFrames) {
        this.#state = "silence";
        this.#speechFrames = 0;
        ended = true;
      }
    }

    return { state: this.#state, started, ended };
  }

  public reset(): void {
    this.#state = "silence";
    this.#speechFrames = 0;
    this.#silenceFrames = 0;
    this.#hangoverRemaining = 0;
  }
}
