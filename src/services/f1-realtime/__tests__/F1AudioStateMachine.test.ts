import { strict as assert } from "node:assert";
import { test } from "node:test";
import { F1AudioStateMachine } from "../F1AudioStateMachine";

test("recorre el flujo wake a followup", () => {
  const sm = new F1AudioStateMachine();
  for (const state of ["WAKE_STARTING","WAKE_LISTENING","WAKE_DETECTED","REALTIME_CONNECTING","REALTIME_GREETING","REALTIME_LISTENING","REALTIME_PROCESSING","REALTIME_SPEAKING","REALTIME_FOLLOWUP"] as const) sm.transition(state);
  assert.equal(sm.state, "REALTIME_FOLLOWUP");
});

test("rechaza transición inválida", () => {
  const sm = new F1AudioStateMachine();
  assert.throws(() => sm.transition("REALTIME_SPEAKING"));
});


test("manual conversation corridor allows WAKE_STARTING or WAKE_LISTENING through WAKE_DETECTED", () => {
  const starting = new F1AudioStateMachine();
  starting.transition("WAKE_STARTING");
  starting.transition("WAKE_DETECTED");
  starting.transition("REALTIME_CONNECTING");
  expect(starting.state).toBe("REALTIME_CONNECTING");

  const listening = new F1AudioStateMachine();
  listening.transition("WAKE_STARTING");
  listening.transition("WAKE_LISTENING");
  listening.transition("WAKE_DETECTED");
  listening.transition("REALTIME_CONNECTING");
  expect(listening.state).toBe("REALTIME_CONNECTING");
});
