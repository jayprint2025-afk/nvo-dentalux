# @cliniqone/wake-detector

Model-agnostic streaming wake-word detector. It consumes structural mono PCM frames, optionally uses a VAD signal as a compute gate, builds a fixed feature window and delegates inference to a `WakeModelPort`.

## Properties

- No runtime dependencies.
- No microphone ownership.
- No CliniqOne, F1 or OpenAI knowledge.
- Ordered asynchronous inference.
- Fixed-shape feature tensors.
- Consecutive-hit policy and frame cooldown.
- Typed events and explicit lifecycle.

## Minimal integration

```ts
const detector = new WakeDetector(model);
await detector.start();
detector.on("wake", (event) => console.log(event));
await detector.process(audioFrame, { isSpeech: vadResult.isSpeech });
```

A production model adapter will be added separately. The package intentionally contains no fake default model.
