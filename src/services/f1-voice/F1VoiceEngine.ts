import {
  EngineBuilder,
  type F1VoiceEngine as CoreF1VoiceEngine,
  type F1VoiceEngineState,
} from "@cliniqone/f1-voice-engine";
import { AudioEngine, BrowserMicrophoneCapture } from "@cliniqone/audio-engine";
import { createHanaSherpaWakeModel } from "@cliniqone/onnx-runtime";

import type {
  F1VoiceEngineOptions,
  F1VoiceEngineStatus,
  F1WakeEvent,
} from "./types";

const DEFAULT_WAKE_THRESHOLD = 0.30;

// Hanna V27 Wake Isolation: keep the final wake-word region instead of
// forwarding the entire rolling window (which may contain TV/background speech).
const WAKE_ISOLATION_MS = 2200;
const DEFAULT_COOLDOWN_MS = 640;

export class F1VoiceEngine {
  private readonly options: F1VoiceEngineOptions;
  private readonly core: CoreF1VoiceEngine;
  private disposed = false;
  // V32 Cost Guard: local suppression window. This prevents wake candidates
  // from reaching the widget while a negative verification cooldown is active.
  private wakeSuppressedUntil = 0;

  constructor(options: F1VoiceEngineOptions = {}) {
    this.options = options;

    // Sherpa-ONNX KWS local para la frase de activaciÃ³n "Oye Hana".
    const wakeModel = createHanaSherpaWakeModel();

    // V45: keep duplicate protection short. A rejected foreign/TV candidate must not
    // leave Hanna deaf when the enrolled owner says the phrase immediately after it.
    const cooldownMs = Number(options.cooldownMs ?? DEFAULT_COOLDOWN_MS);
    const cooldownFrames = Math.max(
      1,
      Math.ceil(cooldownMs / 80),
    );

    const capture = new BrowserMicrophoneCapture({
      // External module avoids blob: AudioWorklet failures on stricter mobile browsers/CSP.
      workletModuleUrl: options.workletUrl || "/f1-voice/f1-audio-processor.js",
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false, // V47: avoid pumping/clipping external TV noise
    });
    const audio = new AudioEngine({ capture });

    this.core = new EngineBuilder()
      .withWakeModel(wakeModel)
      .withDependencies({ audio })
      .withConfig({
        diagnostics: true,

        wakeDetector: {
          featureBands: 40,
          windowFrames: 20,
          expectedSampleRate: 16000,
          preEmphasis: 0.97,

          // ConfiguraciÃ³n del pipeline de activaciÃ³n.
          preRollFrames: 10,
          vadGraceFrames: 10,
          maxSilentFramesBeforeReset: 12,

          detectionThreshold: Math.max(
            0.10,
            Math.min(
              Number(
                options.threshold ??
                  DEFAULT_WAKE_THRESHOLD,
              ),
              0.9,
            ),
          ),

          consecutiveHits: Math.max(
            1,
            Math.min(
              Math.round(
                Number(options.consecutiveHits ?? 2),
              ),
              4,
            ),
          ),

          cooldownFrames,
        },
      })
      .build();

    this.bindEvents();
  }

  get currentStatus(): F1VoiceEngineStatus {
    return this.mapStatus(this.core.state);
  }

  async start(): Promise<void> {
    if (this.disposed) {
      throw new Error(
        "F1VoiceEngine ya fue liberado.",
      );
    }

    try {
      await this.core.start();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.options.onStatus?.("error", message);
      throw error; // V47: controller must see startup failure and retry/recover
    }
  }

  pause(): void {
    this.core.pause();
  }

  resume(): void {
    this.core.resume();
  }

  /**
   * V32 Cost Guard: suppress candidate delivery locally for a short period.
   * The ONNX engine may continue listening, but no candidate leaves this class,
   * so the widget cannot call the paid /f1/wake/verify endpoint during the window.
   */
  suppressWakeFor(durationMs: number): void {
    const ms = Math.max(0, Math.round(Number(durationMs) || 0));
    this.wakeSuppressedUntil = Math.max(this.wakeSuppressedUntil, Date.now() + ms);
  }

  async stop(): Promise<void> {
    await this.core.stop();
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    await this.core.dispose();
  }

  private bindEvents(): void {
    this.core.on(
      "statechange",
      ({ current }) => {
        this.options.onStatus?.(
          this.mapStatus(current),
        );
      },
    );

    this.core.on(
      "score",
      ({ score, threshold, detected }) => {
        console.debug("[F1 Voice Engine]", {
          score: Number(score.toFixed(3)),
          threshold,
          detected,
        });
      },
    );

    /*
     * IMPORTANTE:
     *
     * Este evento significa que el detector LOCAL
     * encontrÃ³ un candidato.
     *
     * NO reproducimos aquÃ­ el sonido de confirmaciÃ³n,
     * porque todavÃ­a falta la verificaciÃ³n final de
     * que realmente se detectÃ³ "Oye Hana".
     */
    this.core.on(
      "wake",
      ({
        score,
        timestampMs,
        audioWindow,
        sampleRate,
      }) => {
        // V32 Cost Guard: honor local suppression before creating/delivering a candidate.
        if (Date.now() < this.wakeSuppressedUntil) {
          console.debug("[HANNA COST GUARD V32] candidate suppressed locally", {
            remainingMs: Math.max(0, this.wakeSuppressedUntil - Date.now()),
            score: Number(score.toFixed(3)),
          });
          return;
        }

        // V27 Wake Isolation
        // The local model fires at/near the end of the wake word. Keep only the
        // most recent ~1.4 s so continuous TV speech before "Hanna" does not
        // contaminate the server transcription. Do not alter the samples or gain.
        const isolatedAudioWindow = this.isolateWakeWindow(
          audioWindow,
          sampleRate,
        );

        console.debug("[HANNA V27 WAKE ISOLATION]", {
          score: Number(score.toFixed(3)),
          sampleRate,
          originalSamples: audioWindow.length,
          isolatedSamples: isolatedAudioWindow.length,
          isolatedMs: Math.round(
            (isolatedAudioWindow.length / Math.max(1, sampleRate)) * 1000,
          ),
        });

        const event: F1WakeEvent = {
          phrase: this.options.phrase || "Oye Hana",
          confidence: score,
          detectedAt: timestampMs,
          audioWindow: isolatedAudioWindow,
          sampleRate,
        };

        this.options.onWake?.(event);
      },
    );

    this.core.on("diagnostics", (d) => {
      console.log(
        "[HANA SHERPA DIAG]",
        "frames=" + d.framesReceived,
        "speech=" + d.speechFrames,
        "inferences=" + d.inferenceCount,
        "wakes=" + d.wakeCount,
        "errors=" + d.processingErrors,
      );
    });

    this.core.on(
      "error",
      ({ message }) => {
        this.options.onStatus?.(
          "error",
          message,
        );
      },
    );
  }

  private isolateWakeWindow(
    audioWindow: Float32Array,
    sampleRate: number,
  ): Float32Array {
    if (!(audioWindow instanceof Float32Array)) return audioWindow;
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return audioWindow;

    const keepSamples = Math.max(
      1,
      Math.round((sampleRate * WAKE_ISOLATION_MS) / 1000),
    );

    if (audioWindow.length <= keepSamples) return audioWindow;

    // slice() creates an independent buffer; this avoids retaining/mutating the
    // engine's rolling buffer while the async verifier is using the candidate.
    return audioWindow.slice(audioWindow.length - keepSamples);
  }

  private mapStatus(
    state: F1VoiceEngineState,
  ): F1VoiceEngineStatus {
    switch (state) {
      case "idle":
      case "stopping":
      case "disposed":
        return "idle";

      case "starting":
        return "starting";

      case "running":
        return "listening";

      case "paused":
        return "paused";

      case "failed":
        return "error";
    }
  }
}

