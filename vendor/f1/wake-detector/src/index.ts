export { WakeDetector, type WakeDetectorDependencies } from "./wake-detector.js";
export { SpectralFeatureExtractor, type SpectralFeatureConfig, type WakeFeatureExtractor } from "./features/spectral-feature-extractor.js";
export { SlidingFeatureWindow, type FeatureWindow } from "./window/sliding-feature-window.js";
export { ConsecutiveHitPolicy, type WakeDetectionPolicy, type WakePolicyDecision } from "./policy/wake-detection-policy.js";
export { FrameCooldownController, type CooldownPort } from "./state/cooldown-controller.js";
export type { WakeModelPort } from "./model/wake-model-port.js";
export type { WakeDetectorError, WakeEventMap, WakeStateChange } from "./types/events.js";
export type {
  WakeDetectorConfig,
  WakeDetectorProcessor,
  WakeDetectorState,
  WakeEvent,
  WakeFeatures,
  WakeFrame,
  WakeModelInput,
  WakeModelOutput,
  WakeProcessResult,
  WakeScore,
  WakeSignal,
} from "./types/wake.js";
