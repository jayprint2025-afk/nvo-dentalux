import {
  EngineBuilder,
  type F1VoiceEngine as CoreF1VoiceEngine,
  type F1VoiceEngineState,
} from "@cliniqone/f1-voice-engine";
import { OnnxWakeModel } from "@cliniqone/onnx-runtime";

import type {
  F1VoiceEngineOptions,
  F1VoiceEngineStatus,
  F1WakeEvent,
} from "./types";

const DEFAULT_MODEL_ROOT = "/models/hanna-v5";
const DEFAULT_WAKE_THRESHOLD = 0.30;

export class F1VoiceEngine {
  private readonly options: F1VoiceEngineOptions;
  private readonly core: CoreF1VoiceEngine;
  private disposed = false;

  constructor(options: F1VoiceEngineOptions = {}) {
    this.options = options;

    const configuredModelUrl = String(options.modelUrl || "").trim();

    const modelRoot = configuredModelUrl
      ? configuredModelUrl.replace(/\/hanna\.onnx(?:\?.*)?$/, "")
      : DEFAULT_MODEL_ROOT;

    const wakeModel = new OnnxWakeModel({
      modelUrl: `${modelRoot}/hanna.onnx`,
      manifestUrl: `${modelRoot}/manifest.json`,
      externalDataUrl: `${modelRoot}/hanna.onnx.data`,
      externalDataPath: "hanna.onnx.data",
      executionProviders: ["wasm"],
    });

    const cooldownMs = Number(options.cooldownMs ?? 5000);
    const cooldownFrames = Math.max(
      1,
      Math.ceil(cooldownMs / 80),
    );

    this.core = new EngineBuilder()
      .withWakeModel(wakeModel)
      .withConfig({
        diagnostics: true,

        wakeDetector: {
          featureBands: 40,
          windowFrames: 20,
          expectedSampleRate: 16000,
          preEmphasis: 0.97,

          // Ajustes calibrados de Hanna V5.
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
    }
  }

  pause(): void {
    this.core.pause();
  }

  resume(): void {
    this.core.resume();
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
     * encontró un candidato.
     *
     * NO reproducimos aquí el sonido de confirmación,
     * porque todavía falta la verificación final de
     * que realmente se dijo "Hanna".
     */
    this.core.on(
      "wake",
      ({
        score,
        timestampMs,
        audioWindow,
        sampleRate,
      }) => {
        const event: F1WakeEvent = {
          phrase: this.options.phrase || "Hanna",
          confidence: score,
          detectedAt: timestampMs,
          audioWindow,
          sampleRate,
        };

        this.options.onWake?.(event);
      },
    );

    this.core.on("diagnostics", (d) => {
      console.log(
        "[HANNA DIAG]",
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