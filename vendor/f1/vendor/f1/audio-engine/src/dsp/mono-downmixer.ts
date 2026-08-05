import { AudioEngineError } from "../types/errors.js";

export class MonoDownmixer {
  public process(channels: readonly Float32Array[]): Float32Array {
    if (channels.length === 0) {
      throw new AudioEngineError("INVALID_AUDIO_CHUNK", "Audio chunk must contain at least one channel.");
    }

    const first = channels[0];
    if (!first) {
      throw new AudioEngineError("INVALID_AUDIO_CHUNK", "Audio chunk contains an invalid first channel.");
    }

    if (channels.some((channel) => channel.length !== first.length)) {
      throw new AudioEngineError("INVALID_AUDIO_CHUNK", "All channels in an audio chunk must have equal length.");
    }

    if (channels.length === 1) return first.slice();

    const mono = new Float32Array(first.length);
    const scale = 1 / channels.length;
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) * scale;
      }
    }
    return mono;
  }
}
