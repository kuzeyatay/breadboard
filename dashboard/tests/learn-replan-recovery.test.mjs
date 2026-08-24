import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { failedGenerationRequiresReplanFromEvents } from "../src/lib/learn-replan-recovery.ts";

function recoveryFixture(t, events) {
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-replan-"));
  const ledgerDir = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerDir, "events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  t.after(() => fs.rmSync(gardenDir, { recursive: true, force: true }));
  return gardenDir;
}

test("legacy generation replacement evidence routes a terminal failure to replanning", (t) => {
  const gardenDir = recoveryFixture(t, [
    {
      type: "learn_source_formulas_reviewed",
      jobId: "job-target",
      stage: "generation",
      reviewSetHash: "new-review",
      newlyReplacedFormulaIds: ["S1.P22.E1"],
    },
    { type: "learn_failed", jobId: "job-target" },
  ]);

  assert.equal(
    failedGenerationRequiresReplanFromEvents({
      gardenDir,
      jobId: "job-target",
      expectedFormulaReviewSetHash: "old-review",
    }),
    true,
  );
});

test("a changed generation review hash is invalidating even without new replacement ids", (t) => {
  const gardenDir = recoveryFixture(t, [
    {
      type: "learn_source_formulas_reviewed",
      jobId: "job-target",
      stage: "generation",
      reviewSetHash: "new-review",
      newlyReplacedFormulaIds: [],
    },
    { type: "learn_failed", jobId: "job-target" },
  ]);

  assert.equal(
    failedGenerationRequiresReplanFromEvents({
      gardenDir,
      jobId: "job-target",
      expectedFormulaReviewSetHash: "old-review",
    }),
    true,
  );
});

test("new failure receipts can state replan intent without message parsing", (t) => {
  const gardenDir = recoveryFixture(t, [
    {
      type: "learn_failed",
      jobId: "job-target",
      requiresReplan: true,
    },
  ]);

  assert.equal(
    failedGenerationRequiresReplanFromEvents({ gardenDir, jobId: "job-target" }),
    true,
  );
});

test("unrelated, malformed, or nonterminal evidence never forces replanning", (t) => {
  const gardenDir = recoveryFixture(t, [
    {
      type: "learn_source_formulas_reviewed",
      jobId: "job-target",
      stage: "planning_initial",
      reviewSetHash: "different",
      newlyReplacedFormulaIds: ["S1.P1.E1"],
    },
    {
      type: "learn_source_formulas_reviewed",
      jobId: "other-job",
      stage: "generation",
      reviewSetHash: "different",
      newlyReplacedFormulaIds: ["S1.P1.E1"],
    },
    { type: "learn_failed", jobId: "job-target" },
  ]);
  fs.appendFileSync(
    path.join(gardenDir, ".breadboard", "events.jsonl"),
    "{interrupted-final-line",
    "utf8",
  );

  assert.equal(
    failedGenerationRequiresReplanFromEvents({
      gardenDir,
      jobId: "job-target",
      expectedFormulaReviewSetHash: "expected",
    }),
    false,
  );
});
