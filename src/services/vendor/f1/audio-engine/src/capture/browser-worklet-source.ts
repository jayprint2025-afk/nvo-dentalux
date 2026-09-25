export const BROWSER_CAPTURE_PROCESSOR_NAME = "cliniqone-audio-capture";

export const BROWSER_CAPTURE_WORKLET_SOURCE = `
class CliniqOneAudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channels = input.map((channel) => channel.slice());
    this.port.postMessage({ channels }, channels.map((channel) => channel.buffer));
    return true;
  }
}
registerProcessor("${BROWSER_CAPTURE_PROCESSOR_NAME}", CliniqOneAudioCaptureProcessor);
`;
