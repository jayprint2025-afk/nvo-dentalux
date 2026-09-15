import { describe, expect, it, vi } from "vitest";
import { F1RealtimeClient } from "../F1RealtimeClient";

function makeClient() {
  const sent: any[] = [];
  const onError = vi.fn();
  const client: any = new F1RealtimeClient({
    greetingText: "Te escucho",
    apiBase: "",
    branchKey: "sucursal_1",
    getToken: () => "token",
    getRemoteAudioElement: () => null,
    callbacks: {
      onConnected: vi.fn(), onGreetingDone: vi.fn(), onUserSpeechStarted: vi.fn(),
      onUserTranscript: vi.fn(), onAssistantSpeechStarted: vi.fn(),
      onAssistantTranscriptDelta: vi.fn(), onAssistantTranscriptDone: vi.fn(),
      onResponseDone: vi.fn(), onToolCall: vi.fn(async () => ({ ok: true })),
      onError, onClosed: vi.fn(),
    },
  });
  client.closed = false;
  client.greetingPending = false;
  client.dc = { readyState: "open", send: (raw: string) => sent.push(JSON.parse(raw)) };
  return { client, sent, onError };
}

describe("F1RealtimeClient 429 continuity", () => {
  it("retries an automatic VAD response without surfacing a fatal error", async () => {
    vi.useFakeTimers();
    const { client, sent, onError } = makeClient();
    await client.handleMessage(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await client.handleMessage(JSON.stringify({
      type: "error",
      error: { code: "rate_limit_exceeded", message: "Rate limit reached. Please try again in 1.795s." },
    }));
    expect(onError).not.toHaveBeenCalled();
    expect(client.userTurnAwaitingResponse).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent.at(-1)).toEqual({ type: "response.create" });
    vi.useRealTimers();
  });

  it("keeps a tool continuation pending and retries only response.create", async () => {
    vi.useFakeTimers();
    const { client, sent, onError } = makeClient();
    client.userTurnAwaitingResponse = true;
    client.pendingResponseCreate = { type: "response.create" };
    await client.handleMessage(JSON.stringify({
      type: "response.done",
      response: { status: "failed", status_details: { error: { message: "TPM rate limit. Please try again in 0.5s" } } },
    }));
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(sent.filter((x) => x.type === "response.create")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("still treats non-rate-limit Realtime errors as fatal", async () => {
    const { client, onError } = makeClient();
    await client.handleMessage(JSON.stringify({ type: "error", error: { code: "bad_request", message: "invalid event" } }));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
