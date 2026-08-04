# @cliniqone/audio-engine

Independent, browser-ready real-time audio capture and framing package.

## Guarantees

- Microphone capture via Web Audio `AudioWorklet`
- Deterministic mono Float32 PCM
- Streaming conversion to 16,000 Hz
- Exact 80 ms frames (1,280 samples)
- Typed package-owned event bus
- No dependency on CliniqOne application code, F1, OpenAI, VAD, wake-word logic, or model runtimes
- Zero runtime npm dependencies

## Install

```bash
npm install @cliniqone/audio-engine
```

## Usage

```ts
import { AudioEngine } from "@cliniqone/audio-engine";

const engine = new AudioEngine();

engine.on("frame", (frame) => {
  console.log(frame.sequence, frame.samples.length, frame.sampleRate);
});

engine.on("error", (error) => {
  console.error(error.code, error.message);
});

await engine.start();
```

Microphone access requires a secure browser context and user permission.

## Browser capture options

```ts
import { AudioEngine, BrowserMicrophoneCapture } from "@cliniqone/audio-engine";

const capture = new BrowserMicrophoneCapture({
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});

const engine = new AudioEngine({ capture });
```

A custom `workletModuleUrl` can be supplied for strict Content Security Policies that disallow `blob:` scripts.

## API

### `AudioEngine`

- `start(): Promise<void>`
- `stop(): Promise<void>`
- `state: AudioEngineState`
- `on(event, listener): () => void`
- `once(event, listener): () => void`
- `off(event, listener): void`

### Events

- `frame`: normalized `AudioFrame`
- `statechange`: lifecycle transition
- `error`: structured `AudioEngineError`

## Testing

```bash
npm test
```

Tests use a fake capture adapter; no physical microphone is required.
