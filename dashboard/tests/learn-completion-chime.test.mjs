import test from "node:test";
import assert from "node:assert/strict";
import { learnCompletionChimeKey } from "../src/lib/learn-completion-chime.ts";

const snapshot = (status, overrides = {}) => ({
  gardenId: "garden-a",
  jobId: "learn-1",
  status,
  ...overrides,
});

test("chimes when the same Learn job first becomes complete", () => {
  assert.equal(
    learnCompletionChimeKey(snapshot("writing_quartz"), snapshot("complete")),
    "garden-a:learn-1",
  );
});

test("does not chime while hydrating an already-complete job", () => {
  assert.equal(learnCompletionChimeKey(null, snapshot("complete")), null);
});

test("does not chime again for repeated complete status polls", () => {
  assert.equal(
    learnCompletionChimeKey(snapshot("complete"), snapshot("complete")),
    null,
  );
});

test("does not confuse a changed job or garden with a completion transition", () => {
  assert.equal(
    learnCompletionChimeKey(
      snapshot("generating_visuals"),
      snapshot("complete", { jobId: "learn-2" }),
    ),
    null,
  );
  assert.equal(
    learnCompletionChimeKey(
      snapshot("generating_visuals"),
      snapshot("complete", { gardenId: "garden-b" }),
    ),
    null,
  );
});

test("does not chime for non-success terminal states", () => {
  assert.equal(
    learnCompletionChimeKey(snapshot("writing_quartz"), snapshot("failed")),
    null,
  );
  assert.equal(
    learnCompletionChimeKey(snapshot("writing_quartz"), snapshot("cancelled")),
    null,
  );
});
