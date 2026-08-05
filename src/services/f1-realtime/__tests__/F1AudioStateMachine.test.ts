import { describe, expect, it } from "vitest";
import { F1AudioStateMachine } from "../F1AudioStateMachine";

describe("F1AudioStateMachine", () => {
  it("requires wake detection before automatic Realtime", () => {
    const sm = new F1AudioStateMachine();
    sm.transition("WAKE_STARTING");
    sm.transition("WAKE_LISTENING");
    expect(() => sm.transition("REALTIME_CONNECTING")).toThrow();
    sm.transition("WAKE_DETECTED");
    sm.transition("REALTIME_CONNECTING");
    expect(sm.state).toBe("REALTIME_CONNECTING");
  });

  it("returns to Wake after follow-up timeout cleanup", () => {
    const sm = new F1AudioStateMachine();
    sm.transition("WAKE_STARTING");
    sm.transition("WAKE_LISTENING");
    sm.transition("WAKE_DETECTED");
    sm.transition("REALTIME_CONNECTING");
    sm.transition("REALTIME_GREETING");
    sm.transition("REALTIME_LISTENING");
    sm.transition("REALTIME_PROCESSING");
    sm.transition("REALTIME_SPEAKING");
    sm.transition("REALTIME_FOLLOWUP");
    sm.transition("REALTIME_DISCONNECTING");
    sm.transition("WAKE_STARTING");
    sm.transition("WAKE_LISTENING");
    expect(sm.state).toBe("WAKE_LISTENING");
  });
});
