import type { OnnxExecutionProvider, RuntimeFactory, RuntimeSession } from "./types.js";

const DEFAULT_WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

export class OnnxRuntimeWebFactory implements RuntimeFactory {
  readonly #wasmBaseUrl: string;

  public constructor(wasmBaseUrl: string = DEFAULT_WASM_BASE_URL) {
    this.#wasmBaseUrl = wasmBaseUrl.endsWith("/")
      ? wasmBaseUrl
      : `${wasmBaseUrl}/`;
  }

  public createTensor(
    data: Float32Array,
    dimensions: readonly number[],
  ): unknown {
    return { data, dimensions };
  }

  public async createSession(
    modelUrl: string,
    options: {
      readonly executionProviders: readonly OnnxExecutionProvider[];
      readonly externalData?: readonly {
        readonly path: string;
        readonly data: string;
      }[];
    },
  ): Promise<RuntimeSession> {
    const ort = await import("onnxruntime-web");

    // Vite cannot infer the location of ONNX Runtime's .mjs/.wasm sidecar
    // files when the runtime is loaded dynamically from a workspace package.
    // Configure an explicit source before creating the first session.
    ort.env.wasm.wasmPaths = this.#wasmBaseUrl;

    // One thread avoids cross-origin-isolation requirements during the pilot.
    ort.env.wasm.numThreads = 1;

    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: [...options.executionProviders],
      ...(options.externalData
        ? { externalData: [...options.externalData] }
        : {}),
    });

    return {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      run: async (feeds) => {
        const converted: Record<string, unknown> = {};

        for (const [name, value] of Object.entries(feeds)) {
          const candidate = value as {
            readonly data?: Float32Array;
            readonly dimensions?: readonly number[];
          };

          converted[name] =
            candidate.data && candidate.dimensions
              ? new ort.Tensor(
                  "float32",
                  candidate.data,
                  [...candidate.dimensions],
                )
              : value;
        }

        return (await session.run(converted)) as unknown as Readonly<
          Record<
            string,
            {
              readonly data: Float32Array | readonly number[];
              readonly dims: readonly number[];
            }
          >
        >;
      },
      release: () => session.release(),
    };
  }
}
