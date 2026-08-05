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
