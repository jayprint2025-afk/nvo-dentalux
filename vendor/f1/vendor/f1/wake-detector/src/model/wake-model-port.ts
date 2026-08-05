import type { WakeModelInput, WakeModelOutput } from "../types/wake.js";

export interface WakeModelPort {
  initialize(): Promise<void>;
  infer(input: WakeModelInput): Promise<WakeModelOutput>;
  dispose(): Promise<void>;
}
