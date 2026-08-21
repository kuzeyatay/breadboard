import assert from "node:assert/strict";
import test from "node:test";

const {
  chooseHumanizerCandidate,
  evaluateHumanizerCandidate,
  humanizerCandidateIsImprovement,
} = await import("../src/lib/humanizer/recovery.ts");

const MACHINE =
  "In today's rapidly evolving landscape, it is important to note that this " +
  "groundbreaking solution serves as a testament to the transformative power " +
  "of innovation. Moreover, it is worth noting that this represents a pivotal " +
  "moment in the ever-evolving world of technology.";
const PLAIN =
  "The tool does one job. It reads a file, checks the numbers, and prints what it found.";

function result(rewrittenText) {
  return {
    requestId: "test-request",
    status: "complete",
    modelId: "test-model",
    modelRevision: "test-revision",
    device: "cpu",
    dtype: "float32",
    originalText: MACHINE,
    rewrittenText,
    chunks: { total: 2, rewritten: 2, reverted: 0 },
    preservation: { passed: true, warnings: [] },
    timingMs: { load: 0, inference: 1, total: 1 },
  };
}

test("a finer recovery pass replaces a tied primary candidate when it improves", () => {
  const primary = evaluateHumanizerCandidate(result(MACHINE));
  const recovery = evaluateHumanizerCandidate(result(PLAIN));
  assert.equal(humanizerCandidateIsImprovement(primary), false);
  assert.equal(humanizerCandidateIsImprovement(recovery), true);
  assert.equal(chooseHumanizerCandidate(primary, recovery), recovery);
});

test("a damaged recovery candidate cannot beat an intact primary", () => {
  const primary = evaluateHumanizerCandidate(result(MACHINE));
  const damaged = evaluateHumanizerCandidate(result(`**Broken heading\n\n${PLAIN}`));
  assert.equal(damaged.integrity.passed, false);
  assert.equal(chooseHumanizerCandidate(primary, damaged), primary);
});
