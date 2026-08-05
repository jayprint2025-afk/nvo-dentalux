import type { AudioCaptureCallbacks, AudioCapturePort } from "../types/audio.js";
import { AudioEngineError } from "../types/errors.js";
import { BROWSER_CAPTURE_PROCESSOR_NAME, BROWSER_CAPTURE_WORKLET_SOURCE } from "./browser-worklet-source.js";

export interface BrowserMicrophoneCaptureOptions {
  readonly deviceId?: string;
  readonly echoCancellation?: boolean;
  readonly noiseSuppression?: boolean;
  readonly autoGainControl?: boolean;
  readonly workletModuleUrl?: string;
}

interface WorkletMessage {
  readonly channels: readonly Float32Array[];
}

export class BrowserMicrophoneCapture implements AudioCapturePort {
  readonly #options: BrowserMicrophoneCaptureOptions;
  #stream: MediaStream | undefined;
  #context: AudioContext | undefined;
  #source: MediaStreamAudioSourceNode | undefined;
  #worklet: AudioWorkletNode | undefined;
  #silentGain: GainNode | undefined;
  #generatedWorkletUrl: string | undefined;

  public constructor(options: BrowserMicrophoneCaptureOptions = {}) {
    this.#options = options;
  }

  public async start(callbacks: AudioCaptureCallbacks): Promise<void> {
    if (this.#stream) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new AudioEngineError("CAPTURE_UNAVAILABLE", "Microphone capture is unavailable in this runtime.");
    }
    if (typeof AudioContext === "undefined") {
      throw new AudioEngineError("CAPTURE_UNAVAILABLE", "Web Audio API is unavailable in this runtime.");
    }

    try {
      const audioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: 1 },
        echoCancellation: this.#options.echoCancellation ?? false,
        noiseSuppression: this.#options.noiseSuppression ?? false,
        autoGainControl: this.#options.autoGainControl ?? false,
        ...(this.#options.deviceId
          ? { deviceId: { exact: this.#options.deviceId } }
          : {}),
      };

      this.#stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      this.#context = new AudioContext({ latencyHint: "interactive" });
      await this.#context.resume();

      const moduleUrl = this.#options.workletModuleUrl ?? this.#createWorkletUrl();
      await this.#context.audioWorklet.addModule(moduleUrl);

      this.#source = this.#context.createMediaStreamSource(this.#stream);
      this.#worklet = new AudioWorkletNode(this.#context, BROWSER_CAPTURE_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.#silentGain = this.#context.createGain();
      this.#silentGain.gain.value = 0;

      this.#worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        try {
          callbacks.onChunk({
            channels: event.data.channels,
            sampleRate: this.#context?.sampleRate ?? 0,
            timestampMs: performance.now(),
          });
        } catch (error) {
          callbacks.onError(error);
        }
      };
      this.#worklet.onprocessorerror = () => {
        callbacks.onError(new AudioEngineError("CAPTURE_RUNTIME_FAILED", "AudioWorklet processor failed."));
      };

      this.#source.connect(this.#worklet);
      this.#worklet.connect(this.#silentGain);
      this.#silentGain.connect(this.#context.destination);
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw new AudioEngineError("CAPTURE_START_FAILED", "Unable to start browser microphone capture.", { cause: error });
    }
  }

  public async stop(): Promise<void> {
    const errors: unknown[] = [];
    try { this.#source?.disconnect(); } catch (error) { errors.push(error); }
    try { this.#worklet?.disconnect(); } catch (error) { errors.push(error); }
    try { this.#silentGain?.disconnect(); } catch (error) { errors.push(error); }

    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    if (this.#context && this.#context.state !== "closed") {
      try { await this.#context.close(); } catch (error) { errors.push(error); }
    }
    if (this.#generatedWorkletUrl) URL.revokeObjectURL(this.#generatedWorkletUrl);

    this.#stream = undefined;
    this.#context = undefined;
    this.#source = undefined;
    this.#worklet = undefined;
    this.#silentGain = undefined;
    this.#generatedWorkletUrl = undefined;

    if (errors.length > 0) {
      throw new AudioEngineError("CAPTURE_STOP_FAILED", "One or more browser capture resources failed to stop.", {
        cause: new AggregateError(errors),
      });
    }
  }

  #createWorkletUrl(): string {
    const blob = new Blob([BROWSER_CAPTURE_WORKLET_SOURCE], { type: "text/javascript" });
    this.#generatedWorkletUrl = URL.createObjectURL(blob);
    return this.#generatedWorkletUrl;
  }
}
