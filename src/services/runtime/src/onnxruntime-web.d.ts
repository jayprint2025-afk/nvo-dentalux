declare module "onnxruntime-web" {
  export const env: {
    wasm: {
      wasmPaths: string | Readonly<Record<string, string>>;
      numThreads: number;
    };
  };

  export class Tensor {
    constructor(
      type: "float32",
      data: Float32Array,
      dimensions: readonly number[],
    );
  }

  export namespace InferenceSession {
    interface SessionOptions {
      executionProviders?: readonly ("wasm" | "webgpu")[];
      externalData?: readonly {
        readonly path: string;
        readonly data: string;
      }[];
    }
  }

  export interface InferenceSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];

    run(
      feeds: Readonly<Record<string, unknown>>,
    ): Promise<
      Readonly<
        Record<
          string,
          {
            readonly data: Float32Array | readonly number[];
            readonly dims: readonly number[];
          }
        >
      >
    >;

    release(): Promise<void>;
  }

  export const InferenceSession: {
    create(
      modelUrl: string,
      options?: InferenceSession.SessionOptions,
    ): Promise<InferenceSession>;
  };
}
