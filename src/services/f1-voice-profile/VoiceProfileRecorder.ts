export class VoiceProfileRecorder {
  async record(durationMs = 2200): Promise<Blob> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador no permite grabar muestras de voz.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16_000,
      },
    });

    try {
      const mimeType = this.pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };

      const completed = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = (event) =>
          reject(
            new Error(
              `Falló la grabación de voz: ${String(
                (event as ErrorEvent)?.message || "error desconocido",
              )}`,
            ),
          );
        recorder.onstop = () =>
          resolve(
            new Blob(chunks, {
              type: recorder.mimeType || mimeType || "audio/webm",
            }),
          );
      });

      recorder.start(100);
      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
      recorder.stop();

      const blob = await completed;
      if (blob.size < 500) {
        throw new Error("La muestra quedó vacía. Habla cerca del micrófono.");
      }

      return blob;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  private pickMimeType(): string {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];

    return (
      candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
      ""
    );
  }
}
