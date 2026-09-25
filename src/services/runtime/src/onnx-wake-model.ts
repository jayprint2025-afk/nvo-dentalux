import type { WakeModelInput, WakeModelOutput, WakeModelPort } from "@cliniqone/wake-detector";
import { OnnxRuntimeWebFactory } from "./onnx-runtime-factory.js";
import type { F1ModelManifest, OnnxWakeModelConfig, RuntimeFactory, RuntimeSession } from "./types.js";
import { validateInput } from "./types.js";

/**
 * Convert the raw model output into the probability of the wake/F1 class.
 *
 * IMPORTANT: the pilot model can return a 2-class vector [nonWake, wake].
 * The old runtime always read output[0], which is normally the NON-WAKE
 * probability. That inverted the detector: noise/silence could score near 1.0
 * and wake F1, while a real wake word could score lower.
 */
export function resolveWakeScore(raw: readonly number[], manifest: F1ModelManifest): number {
  const classCount = raw.length;
  const positiveIndex = manifest.positiveClassIndex ?? (classCount > 1 ? classCount - 1 : 0);
  if (!Number.isInteger(positiveIndex) || positiveIndex < 0 || positiveIndex >= classCount) {
    throw new RangeError(`positiveClassIndex ${positiveIndex} is outside model output size ${classCount}.`);
  }

  const activation = manifest.outputActivation;

  if (activation === "softmax") {
    return softmaxAt(raw, positiveIndex);
  }
  if (activation === "sigmoid") {
    if (classCount !== 1) throw new Error("sigmoid outputActivation requires a single-output wake model.");
    return sigmoid(raw[0]!);
  }
  if (activation === "probability") {
    return clampProbability(raw[positiveIndex]!);
  }

  // Backward-compatible auto detection for existing manifests:
  // - one output in [0,1] => probability, otherwise sigmoid(logit)
  // - multi-class vector that already looks normalized => positive class
  // - otherwise treat values as logits and softmax them
  if (classCount === 1) {
    const value = raw[0]!;
    return value >= 0 && value <= 1 ? value : sigmoid(value);
  }

  const allProbabilities = raw.every((value) => value >= 0 && value <= 1);
  const sum = raw.reduce((total, value) => total + value, 0);
  if (allProbabilities && Math.abs(sum - 1) <= 0.08) {
    return clampProbability(raw[positiveIndex]!);
  }

  return softmaxAt(raw, positiveIndex);
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Wake model returned a non-finite probability.");
  return Math.max(0, Math.min(1, value));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function softmaxAt(values: readonly number[], index: number): number {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const denominator = exps.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error("Wake model softmax normalization failed.");
  return exps[index]! / denominator;
}

export class OnnxWakeModel implements WakeModelPort {
  readonly #config: OnnxWakeModelConfig;
  readonly #runtime: RuntimeFactory;
  #manifest: F1ModelManifest | null = null;
  #session: RuntimeSession | null = null;
  #initializePromise: Promise<void> | null = null;

  public constructor(config: OnnxWakeModelConfig, runtime: RuntimeFactory = new OnnxRuntimeWebFactory()) {
    this.#config = config;
    this.#runtime = runtime;
  }

  public get manifest(): F1ModelManifest | null { return this.#manifest; }

  public initialize(): Promise<void> {
    if (this.#session) return Promise.resolve();
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  async #initialize(): Promise<void> {
    const response = await fetch(this.#config.manifestUrl);
    if (!response.ok) throw new Error(`Unable to load model manifest: HTTP ${response.status}.`);
    const manifest = await response.json() as F1ModelManifest;
    this.#validateManifest(manifest);
    const externalData = this.#config.externalDataUrl
      ? [{ path: this.#config.externalDataPath ?? "hola-f1.onnx.data", data: this.#config.externalDataUrl }]
      : undefined;
    const session = await this.#runtime.createSession(this.#config.modelUrl, {
      executionProviders: this.#config.executionProviders ?? ["wasm"],
      ...(externalData ? { externalData } : {}),
    });
    if (!session.inputNames.includes(manifest.inputName)) throw new Error(`ONNX input '${manifest.inputName}' was not found.`);
    if (!session.outputNames.includes(manifest.outputName)) throw new Error(`ONNX output '${manifest.outputName}' was not found.`);
    this.#manifest = manifest;
    this.#session = session;
  }

  public async infer(input: WakeModelInput): Promise<WakeModelOutput> {
    await this.initialize();
    const manifest = this.#manifest;
    const session = this.#session;
    if (!manifest || !session) throw new Error("ONNX wake model is not initialized.");
    const compatibility = validateInput(input, manifest);
    if (!compatibility.compatible) throw new RangeError(compatibility.issues.join(" "));
    const tensor = this.#runtime.createTensor(input.data, input.shape);
    const outputs = await session.run({ [manifest.inputName]: tensor });
    const output = outputs[manifest.outputName];
    if (!output) throw new Error(`ONNX output '${manifest.outputName}' was not returned.`);

    const raw = Array.from(output.data, (value) => typeof value === "number" ? value : Number(value));
    if (raw.length === 0 || raw.some((value) => !Number.isFinite(value))) {
      throw new Error("ONNX model returned an empty or non-finite output.");
    }

    const score = resolveWakeScore(raw, manifest);
    return { score, keyword: manifest.id };
  }

  public async dispose(): Promise<void> {
    const session = this.#session;
    this.#session = null;
    this.#manifest = null;
    this.#initializePromise = null;
    await session?.release();
  }

  #validateManifest(manifest: F1ModelManifest): void {
    if (manifest.format !== "onnx") throw new Error("Unsupported model format.");
    if (manifest.sampleRate !== 16000) throw new Error("F1 runtime currently requires 16 kHz models.");
    if (manifest.frameDurationMs !== 80 || manifest.frameSamples !== 1280) throw new Error("Manifest does not match the 80 ms audio pipeline.");
    if (manifest.inputShape[0] !== 1 || manifest.inputShape[1] !== manifest.windowFrames || manifest.inputShape[2] !== manifest.featureSize) throw new Error("Invalid manifest input shape.");
    const outputClasses = manifest.outputShape[1];
    if (!Number.isInteger(outputClasses) || outputClasses < 1) throw new Error("Invalid manifest output shape.");
    if (manifest.positiveClassIndex !== undefined && (!Number.isInteger(manifest.positiveClassIndex) || manifest.positiveClassIndex < 0 || manifest.positiveClassIndex >= outputClasses)) {
      throw new Error("Manifest positiveClassIndex is outside outputShape.");
    }
    if (manifest.outputActivation === "sigmoid" && outputClasses !== 1) throw new Error("Sigmoid wake models must expose exactly one output value.");
  }
}
