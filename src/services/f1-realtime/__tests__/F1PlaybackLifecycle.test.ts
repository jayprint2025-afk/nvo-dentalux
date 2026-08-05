import { describe, expect, it } from "vitest";
import { F1AudioStateMachine } from "../F1AudioStateMachine";

describe("F1 playback lifecycle", () => {
  it("does not enter followup until speaking has completed", () => {
    const sm = new F1AudioStateMachine();
    sm.transition("WAKE_STARTING");
    sm.transition("WAKE_LISTENING");
    sm.transition("WAKE_DETECTED");
    sm.transition("REALTIME_CONNECTING");
    sm.transition("REALTIME_GREETING");
    sm.transition("REALTIME_LISTENING");
    sm.transition("REALTIME_PROCESSING");
    sm.transition("REALTIME_SPEAKING");

    expect(sm.state).toBe("REALTIME_SPEAKING");

    sm.transition("REALTIME_FOLLOWUP");
    expect(sm.state).toBe("REALTIME_FOLLOWUP");
  });

  it("allows wake restart after realtime disconnecting", () => {
    const sm = new F1AudioStateMachine();
    sm.transition("REALTIME_CONNECTING");
    sm.transition("REALTIME_DISCONNECTING");
    sm.transition("WAKE_STARTING");
    sm.transition("WAKE_LISTENING");
    expect(sm.state).toBe("WAKE_LISTENING");
  });
});
