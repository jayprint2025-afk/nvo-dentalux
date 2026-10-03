export interface F1ActiveSpeakerVerification {
  accepted: boolean;
  similarity?: number;
  requiredSimilarity?: number;
  displayName?: string;
}

export interface F1ActiveSpeakerGateOptions {
  sourceStream: MediaStream;
  verify(samples: Float32Array, sampleRate: number): Promise<F1ActiveSpeakerVerification>;
  onStatus?(detail: string): void;
  onTimeout?(): void;
  ownerTimeoutMs?: number;
  minSpeechMs?: number;
  endSilenceMs?: number;
  speechRms?: number;
}

/**
 * V44 Active Speaker Gate.
 *
 * The physical microphone is NEVER attached to RTCPeerConnection. We analyze an
 * utterance locally, verify it with CAMPPlus, and only then replay the accepted
 * PCM into a MediaStreamAudioDestinationNode used as the WebRTC input track.
 * Rejected speech is discarded locally, so it cannot reach OpenAI Realtime.
 */
export class F1ActiveSpeakerGate {
  private readonly ctx: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly processor: ScriptProcessorNode;
  private readonly sink: GainNode;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly chunks: Float32Array[] = [];
  private readonly ownerTimeoutMs: number;
  private readonly minSpeechMs: number;
  private readonly endSilenceMs: number;
  private readonly speechRms: number;
  private speechSamples = 0;
  private silenceSamples = 0;
  private active = false;
  private verifying = false;
  private disposed = false;
  private timeout: number | null = null;
  private playbackCursor = 0;

  constructor(private readonly options: F1ActiveSpeakerGateOptions) {
    this.ownerTimeoutMs = Math.max(2500, options.ownerTimeoutMs ?? 5000);
    this.minSpeechMs = Math.max(250, options.minSpeechMs ?? 550);
    this.endSilenceMs = Math.max(250, options.endSilenceMs ?? 500);
    this.speechRms = Math.max(0.002, options.speechRms ?? 0.008);

    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(options.sourceStream);
    this.processor = this.ctx.createScriptProcessor(2048, 1, 1);
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0; // processor must stay connected, but never audible.
    this.destination = this.ctx.createMediaStreamDestination();

    this.processor.onaudioprocess = (event) => this.consume(event.inputBuffer.getChannelData(0));
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  get outputStream(): MediaStream { return this.destination.stream; }
  get sampleRate(): number { return this.ctx.sampleRate; }

  async start(): Promise<void> {
    if (this.disposed) throw new Error("Active Speaker Gate ya fue liberado");
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.active = true;
    this.armTimeout();
    this.options.onStatus?.("V44 · Active Speaker Gate listo · esperando propietario");
  }

  pause(): void {
    this.active = false;
    this.resetUtterance();
    this.clearTimeout();
  }

  resume(): void {
    if (this.disposed) return;
    this.active = true;
    this.armTimeout();
  }

  private consume(input: Float32Array): void {
    if (!this.active || this.disposed || this.verifying) return;
    let sumSq = 0;
    for (let i = 0; i < input.length; i += 1) sumSq += input[i] * input[i];
    const rms = Math.sqrt(sumSq / Math.max(1, input.length));
    const isSpeech = rms >= this.speechRms;

    if (!this.speechSamples && !isSpeech) return;
    if (!this.speechSamples && isSpeech) {
      this.clearTimeout(); // do not expire while the owner is speaking.
      this.options.onStatus?.("V44 · verificando hablante localmente…");
    }

    this.chunks.push(new Float32Array(input));
    if (isSpeech) {
      this.speechSamples += input.length;
      this.silenceSamples = 0;
    } else {
      this.silenceSamples += input.length;
    }

    const minSpeechSamples = Math.round(this.ctx.sampleRate * this.minSpeechMs / 1000);
    const endSilenceSamples = Math.round(this.ctx.sampleRate * this.endSilenceMs / 1000);
    if (this.speechSamples >= minSpeechSamples && this.silenceSamples >= endSilenceSamples) {
      const pcm = this.flattenChunks();
      this.resetUtterance();
      void this.verifyAndForward(pcm);
    }
  }

  private async verifyAndForward(pcm: Float32Array): Promise<void> {
    if (this.disposed || !pcm.length) return;
    this.verifying = true;
    try {
      const result = await this.options.verify(pcm, this.ctx.sampleRate);
      const similarity = Number(result.similarity ?? 0);
      const required = Number(result.requiredSimilarity ?? 0);
      const pct = Math.round(similarity * 100);
      const reqPct = Math.round(required * 100);
      if (!result.accepted) {
        this.options.onStatus?.(`V44 · voz ajena descartada localmente (${pct}%/${reqPct}%) · sin OpenAI`);
        return;
      }

      this.options.onStatus?.(`V44 · propietario confirmado ${pct}% · enviando turno`);
      await this.playIntoRealtime(pcm);
    } catch (error) {
      this.options.onStatus?.(`V44 · Speaker ID falló cerrado: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.verifying = false;
      if (this.active && !this.disposed) this.armTimeout();
    }
  }

  private async playIntoRealtime(pcm: Float32Array): Promise<void> {
    const buffer = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
    buffer.copyToChannel(pcm, 0);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.destination);
    const now = this.ctx.currentTime + 0.02;
    const startAt = Math.max(now, this.playbackCursor);
    this.playbackCursor = startAt + buffer.duration + 0.02;
    node.start(startAt);
    node.onended = () => { try { node.disconnect(); } catch {} };
  }

  private flattenChunks(): Float32Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  }

  private resetUtterance(): void {
    this.chunks.length = 0;
    this.speechSamples = 0;
    this.silenceSamples = 0;
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.timeout = window.setTimeout(() => {
      this.timeout = null;
      if (!this.active || this.disposed || this.speechSamples > 0 || this.verifying) return;
      this.options.onStatus?.("V44 · 5 s sin turno válido del propietario · cerrando Realtime");
      this.options.onTimeout?.();
    }, this.ownerTimeoutMs);
  }

  private clearTimeout(): void {
    if (this.timeout != null) window.clearTimeout(this.timeout);
    this.timeout = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.clearTimeout();
    this.resetUtterance();
    try { this.source.disconnect(); } catch {}
    try { this.processor.disconnect(); } catch {}
    try { this.sink.disconnect(); } catch {}
    this.processor.onaudioprocess = null;
    this.destination.stream.getTracks().forEach((track) => track.stop());
    await this.ctx.close().catch(() => undefined);
  }
}
