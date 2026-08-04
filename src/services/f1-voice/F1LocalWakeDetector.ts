import type { F1WakeDetector } from "./types";

/**
 * Adaptador del futuro modelo local de CliniqOne.
 *
 * No inventa detección por energía ni usa SpeechRecognition.
 * Hasta instalar un modelo real entrenado para "Hola F1", permanece deshabilitado.
 */
export class F1LocalWakeDetector implements F1WakeDetector {
  ready = false;
  private modelUrl = "";

  async load(modelUrl: string): Promise<void> {
    this.modelUrl = String(modelUrl || "").trim();

    if (!this.modelUrl) {
      this.ready = false;
      throw new Error("Falta configurar VITE_F1_WAKE_MODEL_URL");
    }

    // Punto de integración del modelo ONNX propio.
    // Se deja explícitamente bloqueado para evitar falsos positivos.
    this.ready = false;
    throw new Error(
      `Modelo Wake Word todavía no instalado: ${this.modelUrl}`
    );
  }

  async score(_frame: Float32Array, _sampleRate: number): Promise<number> {
    if (!this.ready) return 0;
    return 0;
  }

  async dispose(): Promise<void> {
    this.ready = false;
    this.modelUrl = "";
  }
}
