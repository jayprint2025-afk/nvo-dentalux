import type { WakeModelInput, WakeModelOutput, WakeModelPort } from "@cliniqone/wake-detector";
import { OnnxRuntimeWebFactory } from "./onnx-runtime-factory.js";
import type { F1ModelManifest, OnnxWakeModelConfig, RuntimeFactory, RuntimeSession } from "./types.js";
import { validateInput } from "./types.js";

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
    const first = output?.data[0];
    const score = typeof first === "number" ? first : Number(first);
    if (!Number.isFinite(score)) throw new Error("ONNX model returned a non-finite score.");
    return { score: Math.max(0, Math.min(1, score)), keyword: manifest.id };
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
  }
}
