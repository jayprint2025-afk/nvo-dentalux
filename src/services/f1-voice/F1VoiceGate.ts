export class F1VoiceGate {
  constructor(
    private readonly minRms = 0.018,
    private readonly minZeroCrossingRate = 0.015,
    private readonly maxZeroCrossingRate = 0.35
  ) {}

  isLikelyVoice(frame: Float32Array): boolean {
    if (!frame.length) return false;

    let energy = 0;
    let crossings = 0;
    let previous = frame[0] || 0;

    for (let index = 0; index < frame.length; index += 1) {
      const value = frame[index] || 0;
      energy += value * value;

      if (
        index > 0 &&
        ((previous >= 0 && value < 0) || (previous < 0 && value >= 0))
      ) {
        crossings += 1;
      }

      previous = value;
    }

    const rms = Math.sqrt(energy / frame.length);
    const zcr = crossings / frame.length;

    return (
      rms >= this.minRms &&
      zcr >= this.minZeroCrossingRate &&
      zcr <= this.maxZeroCrossingRate
    );
  }
}
