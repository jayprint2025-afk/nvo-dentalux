import { describe, expect, it } from "vitest";
import { F1AudioStateMachine } from "../F1AudioStateMachine";

describe("F1AudioStateMachine realtime/wake lifecycle", () => {
  it("returns from realtime disconnecting to wake listening", () => {
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

  it("does not permit realtime connecting without wake detected", () => {
    const sm = new F1AudioStateMachine();
    sm.transition("WAKE_STARTING");
    sm.transition("WAKE_LISTENING");

    expect(() => sm.transition("REALTIME_CONNECTING")).toThrow();
  });
});
