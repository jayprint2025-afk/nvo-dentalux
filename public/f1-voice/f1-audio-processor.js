class F1VoiceAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions || {};
    this.targetSampleRate = Number(processorOptions.targetSampleRate || 16000);
    this.frameSamples = Number(processorOptions.frameSamples || 1280);
    this.inputSampleRate = sampleRate;
    this.buffer = [];
  }

  downsample(input) {
    if (this.inputSampleRate === this.targetSampleRate) {
      return Array.from(input);
    }

    const ratio = this.inputSampleRate / this.targetSampleRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;

      for (let j = start; j < end; j += 1) {
        sum += input[j];
        count += 1;
      }

      output[i] = count ? sum / count : 0;
    }

    return output;
  }

  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (!channel) return true;

    const mono16k = this.downsample(channel);
    this.buffer.push(...mono16k);

    while (this.buffer.length >= this.frameSamples) {
      const frame = this.buffer.splice(0, this.frameSamples);
      const pcm = new Float32Array(frame);

      this.port.postMessage(
        {
          type: "audio-frame",
          sampleRate: this.targetSampleRate,
          pcm,
        },
        [pcm.buffer]
      );
    }

    return true;
  }
}

registerProcessor("f1-voice-audio-processor", F1VoiceAudioProcessor);
