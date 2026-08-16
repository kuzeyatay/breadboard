import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  describeLearningSpineRepairAttempts,
  learningSpineFullRepairFeedback,
  learningSpineFullRepairIsComplete,
  recordLearningSpineFullRepairCandidate,
  startLearningSpineFullRepairLineage,
} from "../src/lib/learning-spine-full-repair.ts";

function candidate(payload, invalidResponse, unitCount, validationProblems) {
  return { payload, invalidResponse, unitCount, validationProblems };
}

describe("learning-spine full-repair candidate lineage", () => {
  test("carries an empty response into a nonempty invalid candidate and then a repaired candidate", () => {
    const emptyRaw = '\r\n{"learningUnits":[]}\n';
    let lineage = startLearningSpineFullRepairLineage(candidate(
      "initial",
      emptyRaw,
      0,
      ["planner returned no learningUnits"],
    ));

    const firstFeedback = learningSpineFullRepairFeedback(lineage, 1);
    assert.equal(firstFeedback.invalidResponse, emptyRaw);
    assert.deepEqual(firstFeedback.validationProblems, ["planner returned no learningUnits"]);
    assert.equal(learningSpineFullRepairIsComplete(lineage), false);

    const nonemptyInvalidRaw = ' {"learningUnits":[{"id":"U1","title":"Fields"}]}\r\n';
    const residualProblems = [
      "learningUnits[0].role must be one of the supported roles",
      "learningUnits[0].sectionPlan must be an object",
      "garden has too few learning units",
    ];
    lineage = recordLearningSpineFullRepairCandidate({
      lineage,
      semanticAttempt: 2,
      candidate: candidate("repair-1", nonemptyInvalidRaw, 1, residualProblems),
    });

    assert.equal(
      lineage.incumbent.payload,
      "repair-1",
      "a usable nonempty spine must outrank an empty incumbent despite having more residual failures",
    );
    assert.equal(learningSpineFullRepairIsComplete(lineage), false);
    const secondFeedback = learningSpineFullRepairFeedback(lineage, 2);
    assert.equal(secondFeedback.invalidResponse, nonemptyInvalidRaw);
    assert.deepEqual(secondFeedback.validationProblems, residualProblems);
    assert.deepEqual(secondFeedback.repairHistory, [
      {
        semanticAttempt: 1,
        unitCount: 0,
        validationProblems: ["planner returned no learningUnits"],
        promotedToIncumbent: true,
      },
      {
        semanticAttempt: 2,
        unitCount: 1,
        validationProblems: residualProblems,
        promotedToIncumbent: true,
      },
    ]);

    const repairedRaw = '{"learningUnits":[{"id":"U1","title":"Fields","role":"core_concept"}]}';
    lineage = recordLearningSpineFullRepairCandidate({
      lineage,
      semanticAttempt: 3,
      candidate: candidate("repair-2", repairedRaw, 1, []),
    });
    assert.equal(lineage.incumbent.payload, "repair-2");
    assert.equal(lineage.incumbent.invalidResponse, repairedRaw);
    assert.equal(learningSpineFullRepairIsComplete(lineage), true);
  });

  test("keeps a stronger incumbent when a later rejected candidate regresses", () => {
    const strongerRaw = '{"learningUnits":[{"id":"U1"}]}';
    let lineage = startLearningSpineFullRepairLineage(candidate(
      "stronger",
      strongerRaw,
      1,
      ["learningUnits[0].title must be a non-empty string"],
    ));
    lineage = recordLearningSpineFullRepairCandidate({
      lineage,
      semanticAttempt: 2,
      candidate: candidate(
        "empty-regression",
        '{"learningUnits":[]}',
        0,
        ["planner returned no learningUnits"],
      ),
    });

    const feedback = learningSpineFullRepairFeedback(lineage, 2);
    assert.equal(lineage.incumbent.payload, "stronger");
    assert.equal(feedback.invalidResponse, strongerRaw);
    assert.deepEqual(feedback.validationProblems, [
      "learningUnits[0].title must be a non-empty string",
    ]);
    assert.equal(feedback.repairHistory.at(-1).promotedToIncumbent, false);
  });

  test("terminal attempt wording distinguishes skipped from attempted targeted repair", () => {
    assert.equal(
      describeLearningSpineRepairAttempts({
        fullContractAttempts: 3,
        targetedCalls: 0,
        targetedStatus: "unscoped",
      }),
      "after 3 bounded full-contract attempts; targeted model repair was skipped because the remaining failures were not safely scoped to complete learning-unit records",
    );
    assert.equal(
      describeLearningSpineRepairAttempts({
        fullContractAttempts: 3,
        targetedCalls: 2,
        targetedStatus: "exhausted",
      }),
      "after 3 bounded full-contract attempts plus 2 bounded targeted model repair attempts (exhausted)",
    );
  });
});
