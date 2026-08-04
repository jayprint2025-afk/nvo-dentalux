export type AudioEngineErrorCode =
  | "INVALID_CONFIG"
  | "CAPTURE_UNAVAILABLE"
  | "CAPTURE_START_FAILED"
  | "CAPTURE_RUNTIME_FAILED"
  | "CAPTURE_STOP_FAILED"
  | "INVALID_AUDIO_CHUNK";

export class AudioEngineError extends Error {
  public override readonly name = "AudioEngineError";

  public constructor(
    public readonly code: AudioEngineErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
