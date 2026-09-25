export { VadEngine, type VadEngineDependencies } from "./vad-engine.js";
export { PcmFeatureExtractor, type FeatureExtractor } from "./features/pcm-feature-extractor.js";
export { AdaptiveNoiseFloor, type NoiseFloorEstimator } from "./noise/adaptive-noise-floor.js";
export { AdaptiveEnergyPolicy, type AdaptiveEnergyPolicyConfig, type DecisionPolicy } from "./policy/adaptive-energy-policy.js";
export { SpeechStateMachine, type SpeechStateConfig, type SpeechStateTransition } from "./state/speech-state-machine.js";
export type { VadEventMap, VadStateChange } from "./types/events.js";
export type {
  VadConfig,
  VadDecision,
  VadFeatures,
  VadFrame,
  VadProcessor,
  VadResult,
  VadSegmentBoundary,
  VadState,
} from "./types/vad.js";
