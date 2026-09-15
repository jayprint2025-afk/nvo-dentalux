import { describe, expect, it, vi } from "vitest";
import { F1RealtimeClient } from "../F1RealtimeClient";

function makeClient() {
  const sent: any[] = [];
  const onClosed = vi.fn();
  const client: any = new F1RealtimeClient({
    greetingText: "Te escucho", apiBase: "", branchKey: "sucursal_1",
    getToken: () => "token", getRemoteAudioElement: () => null,
    callbacks: {
      onConnected: vi.fn(), onGreetingDone: vi.fn(), onUserSpeechStarted: vi.fn(),
      onUserTranscript: vi.fn(), onAssistantSpeechStarted: vi.fn(),
      onAssistantTranscriptDelta: vi.fn(), onAssistantTranscriptDone: vi.fn(),
      onResponseDone: vi.fn(), onToolCall: vi.fn(async () => ({ ok: true })),
      onError: vi.fn(), onClosed,
    },
  });
  client.closed = false;
  client.greetingPending = false;
  client.dc = { readyState: "open", send: (raw: string) => sent.push(JSON.parse(raw)) };
  return { client, sent, onClosed };
}

describe("F1RealtimeClient transport recovery", () => {
  it("preserves executed calls and reconnects in recovery mode", async () => {
    vi.useFakeTimers();
    const { client, onClosed } = makeClient();
    client.executedCalls.add("call-1");
    client.recoveryJournal = ["Resultado de register_expense: {\"ok\":true}"];
    client.resources.closeRealtime = vi.fn(async () => undefined);
    client.connect = vi.fn(async () => undefined);
    const promise = client.recoverTransport();
    await vi.runAllTimersAsync();
    await promise;
    expect(client.connect).toHaveBeenCalledWith(true);
    expect(client.executedCalls.has("call-1")).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not send an old call_id into a replacement DataChannel", async () => {
    const { client, sent } = makeClient();
    let resolveTool!: (value: unknown) => void;
    client.options.callbacks.onToolCall = () => new Promise((resolve) => { resolveTool = resolve; });
    const promise = client.handleTool({ name: "register_expense", call_id: "old-call", arguments: "{}" });
    await Promise.resolve();
    client.dc = { readyState: "open", send: (raw: string) => sent.push(JSON.parse(raw)) };
    resolveTool({ ok: true });
    await promise;
    expect(sent.some((event) => event?.item?.call_id === "old-call")).toBe(false);
  });
});
