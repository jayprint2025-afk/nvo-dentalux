class CliniqOneAudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs && inputs[0];
    if (!input || input.length === 0) return true;

    const channels = input.map((channel) => channel.slice());
    this.port.postMessage(
      { channels },
      channels.map((channel) => channel.buffer)
    );
    return true;
  }
}

registerProcessor("cliniqone-audio-capture", CliniqOneAudioCaptureProcessor);
