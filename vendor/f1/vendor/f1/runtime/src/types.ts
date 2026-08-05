import type { WakeModelInput } from "@cliniqone/wake-detector";

export type OnnxExecutionProvider = "wasm" | "webgpu";

export interface F1ModelManifest {
  readonly id: string;
  readonly version: string;
  readonly format: "onnx";
  readonly sampleRate: number;
  readonly frameDurationMs: number;
  readonly frameSamples: number;
  readonly windowFrames: number;
  readonly featureBands: number;
  readonly featureSize: number;
  readonly preEmphasis: number;
  readonly inputName: string;
  readonly inputShape: readonly [1, number, number];
  readonly outputName: string;
  readonly outputShape: readonly [1, number];
  readonly threshold: number;
  readonly sha256?: string;
  readonly status?: string;
  readonly warning?: string;
}

export interface OnnxWakeModelConfig {
  readonly modelUrl: string;
  readonly manifestUrl: string;
  readonly externalDataUrl?: string;
  readonly externalDataPath?: string;
  readonly executionProviders?: readonly OnnxExecutionProvider[];
}

export interface RuntimeTensor {
  readonly data: Float32Array | readonly number[];
  readonly dims: readonly number[];
}

export interface RuntimeSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, RuntimeTensor>>>;
  release(): Promise<void>;
}

export interface RuntimeFactory {
  createTensor(data: Float32Array, dimensions: readonly number[]): unknown;
  createSession(
    modelUrl: string,
    options: {
      readonly executionProviders: readonly OnnxExecutionProvider[];
      readonly externalData?: readonly { readonly path: string; readonly data: string }[];
    },
  ): Promise<RuntimeSession>;
}

export interface WakeModelCompatibility {
  readonly compatible: boolean;
  readonly issues: readonly string[];
}

export function validateInput(input: WakeModelInput, manifest: F1ModelManifest): WakeModelCompatibility {
  const issues: string[] = [];
  if (input.sampleRate !== manifest.sampleRate) issues.push(`sampleRate ${input.sampleRate} does not match ${manifest.sampleRate}.`);
  if (input.shape[1] !== manifest.windowFrames) issues.push(`windowFrames ${input.shape[1]} does not match ${manifest.windowFrames}.`);
  if (input.shape[2] !== manifest.featureSize) issues.push(`featureSize ${input.shape[2]} does not match ${manifest.featureSize}.`);
  if (input.data.length !== manifest.windowFrames * manifest.featureSize) issues.push("Tensor length does not match manifest shape.");
  return { compatible: issues.length === 0, issues };
}
