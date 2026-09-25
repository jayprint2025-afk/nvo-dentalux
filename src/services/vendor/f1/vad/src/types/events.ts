import type { VadResult, VadSegmentBoundary, VadState } from "./vad.js";

export interface VadStateChange {
  readonly previous: VadState;
  readonly current: VadState;
}

export interface VadEventMap extends Record<string, unknown> {
  readonly result: VadResult;
  readonly speechstart: VadSegmentBoundary;
  readonly speechend: VadSegmentBoundary;
  readonly statechange: VadStateChange;
}
