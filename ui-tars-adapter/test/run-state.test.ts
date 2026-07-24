import test from "node:test";
import assert from "node:assert/strict";
import { RunState, canTransition, isTerminal, InvalidTransitionError } from "../src/run-state.ts";

test("happy path transitions", () => {
  const s = new RunState("r1");
  assert.equal(s.status, "queued");
  s.transition("starting");
  s.transition("running");
  s.transition("awaiting_approval");
  s.transition("running");
  s.transition("completed");
  assert.equal(s.status, "completed");
  assert.equal(s.terminal, true);
});

test("terminal states never re-open", () => {
  const s = new RunState("r2");
  s.transition("starting");
  s.transition("running");
  s.transition("aborted");
  assert.throws(() => s.transition("running"), InvalidTransitionError);
  assert.throws(() => s.transition("completed"), InvalidTransitionError);
});

test("invalid transition rejected", () => {
  assert.equal(canTransition("queued", "running"), false);
  assert.equal(canTransition("running", "awaiting_approval"), true);
  const s = new RunState("r3");
  assert.throws(() => s.transition("running"), InvalidTransitionError);
});

test("monotonic sequence numbers", () => {
  const s = new RunState("r4");
  assert.equal(s.allocateSequence(), 1);
  assert.equal(s.allocateSequence(), 2);
  assert.equal(s.nextSequence, 3);
  assert.equal(s.allocateSequence(), 3);
});

test("isTerminal", () => {
  assert.equal(isTerminal("completed"), true);
  assert.equal(isTerminal("runtime_lost"), true);
  assert.equal(isTerminal("running"), false);
});
