# @cliniqone/vad

Independent, synchronous voice activity detection for mono PCM frames.

## Properties

- No runtime dependencies.
- No microphone ownership.
- No CliniqOne, F1, OpenAI, browser, or Node coupling.
- Adaptive noise floor.
- Energy threshold, zero-crossing gate, hysteresis, attack, release, and hangover.
- Typed events: `result`, `speechstart`, `speechend`, and `statechange`.
- Compatible by TypeScript structural typing with `@cliniqone/audio-engine` frames.

## Usage

```ts
import { VadEngine } from "@cliniqone/vad";

const vad = new VadEngine();
vad.on("speechstart", () => console.log("speech started"));
vad.on("speechend", () => console.log("speech ended"));

const result = vad.process(frame);
console.log(result.isSpeech, result.confidence);
```

## Default policy

The reference policy compares frame dBFS against an adaptive noise floor plus a configurable margin. A zero-crossing gate rejects very high-frequency/noise-like frames. The state machine prevents rapid toggling.

This implementation is the deterministic baseline and public contract. Future model-backed policies can implement `DecisionPolicy` without changing consumers.
