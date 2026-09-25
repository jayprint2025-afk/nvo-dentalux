# @cliniqone/f1-voice-engine

Public orchestration SDK for F1 Voice Engine.

## Responsibilities

- Coordinates audio capture, VAD and wake detection.
- Owns lifecycle, typed public events, diagnostics and error normalization.
- Does not implement DSP or model inference.
- Requires an explicit `WakeModelPort` until the production “Hola F1” model is delivered.

## Usage

```ts
import { F1VoiceEngine } from "@cliniqone/f1-voice-engine";

const engine = new F1VoiceEngine({ wakeModel });
engine.on("wake", event => console.log(event));
await engine.start();
```

The final zero-argument constructor is reserved for Sprint 6, when the production model provider exists.
