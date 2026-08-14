import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  MODEL_VISUAL_NECESSITY_CALL_BUDGET,
  ModelVisualNecessityPlanningError,
  buildModelVisualNecessityPacket,
  buildModelVisualNecessityPrompt,
  buildModelVisualNecessityRepairPrompt,
  runModelVisualNecessityPlanning,
  validateModelVisualNecessityBatch,
} from "../src/lib/model-visual-necessity.ts";
import {
  persistedVisualizationControlContractProblems,
} from "../src/lib/visualization-contract-validation.ts";

function unit(overrides = {}) {
  return {
    id: "U24",
    title: "Electromagnetic-wave representations",
    role: "mechanism",
    learningQuestion:
      "How do Maxwell's equations support propagating electric and magnetic fields, and how are sinusoidal waves represented in time and frequency domains?",
    prerequisiteConcepts: ["Maxwell's equations"],
    newConcepts: ["electromagnetic wave", "time domain", "frequency domain"],
    sourceAnchors: ["S1.P24"],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: [],
    semanticConcepts: [],
    knowledgeClaims: [],
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
    ...overrides,
  };
}

const scores = {
  manipulationValue: 0.82,
  dynamicBehaviorValue: 0.9,
  comparisonValue: 0.68,
  spatialValue: 0.78,
  parameterSensitivityValue: 0.86,
  sourceFigureSufficiency: 0.1,
  proseSufficiency: 0.35,
  formulaSufficiency: 0.55,
  workedExampleSufficiency: 0.42,
  cognitiveLoadRisk: 0.25,
  duplicationRisk: 0.1,
  implementationRisk: 0.35,
};

function requiredU24(overrides = {}) {
  const question = unit().learningQuestion;
  const questionEvidence = {
    anchor: "unit:U24:learning-question",
    quote: question,
  };
  return {
    unitId: "U24",
    pageId: "U24",
    necessity: "required",
    preferredMedium: "interactive_visual",
    learningGoal: question,
    ...scores,
    evidence: {
      unitRole: "mechanism",
      concepts: ["electromagnetic wave", "time domain", "frequency domain"],
      learningQuestion: question,
      sourceAnchorIds: ["S1.P24"],
      nearbyVisualIntentIds: [],
    },
    reason:
      "Switching representation cases makes the same wave relationship inspectable in both domains.",
    confidence: 0.91,
    alternativeCoverage: "uncovered",
    teachingMediumReason:
      "Learner-controlled comparison is the selected teaching medium for this relationship.",
    interaction: {
      interactionGoal: "compare_cases",
      uniqueConcept: "time-domain and frequency-domain representations of one wave",
      whyStaticSourceFigureIsNotEnough:
        "A static figure cannot let the learner switch between the two supplied representation domains.",
      learnerAction:
        "Switch between the time-domain and frequency-domain cases and inspect the represented fields.",
      controls: [
        {
          kind: "select_case",
          label: "time or frequency domain",
          options: ["time domain", "frequency domain"],
          evidence: [questionEvidence],
        },
      ],
      observable: {
        label: "electric and magnetic fields",
        representation: "animation",
        evidence: [questionEvidence],
      },
      expectedInsight: "sinusoidal waves represented in time and frequency domains",
      expectedInsightEvidence: [questionEvidence],
      duplicateSignature: "u24-wave-domain-representation",
    },
    ...overrides,
  };
}

function proseDecision(candidate) {
  return {
    unitId: candidate.id,
    pageId: candidate.id,
    necessity: "not_needed",
    preferredMedium: "prose",
    learningGoal: candidate.learningQuestion,
    manipulationValue: 0.1,
    dynamicBehaviorValue: 0.1,
    comparisonValue: 0.1,
    spatialValue: 0.1,
    parameterSensitivityValue: 0.1,
    sourceFigureSufficiency: 0,
    proseSufficiency: 0.9,
    formulaSufficiency: 0.1,
    workedExampleSufficiency: 0.1,
    cognitiveLoadRisk: 0.2,
    duplicationRisk: 0,
    implementationRisk: 0.1,
    evidence: {
      unitRole: candidate.role,
      concepts: [...candidate.newConcepts],
      learningQuestion: candidate.learningQuestion,
      sourceAnchorIds: [...candidate.sourceAnchors],
      nearbyVisualIntentIds: [],
    },
    reason: "The model judged direct explanation sufficient for this descriptive unit.",
    confidence: 0.88,
    alternativeCoverage: "covered",
    teachingMediumReason: "Prose directly answers the supplied learning question.",
  };
}

function fixture(options = {}) {
  const second = unit({
    id: "U25",
    title: "Wave terminology",
    role: "core_concept",
    learningQuestion: "What does intrinsic impedance mean for an electromagnetic wave?",
    prerequisiteConcepts: [],
    newConcepts: ["intrinsic impedance"],
    sourceAnchors: ["S1.P25"],
  });
  const learningUnits = [unit(), second];
  const packet = buildModelVisualNecessityPacket({
    gardenId: "electromagnetism-1",
    learningUnits,
    budget: options.budget ?? {
      maximumInteractiveUnits: 1,
      maximumRequiredInteractiveUnits: 1,
      maximumInteractiveUnitsPerSection: 1,
      maximumRepeatedInteractionSignature: 1,
    },
    sectionByUnit: { U24: "waves", U25: "waves" },
    overrides: options.overrides,
  });
  const response = {
    schemaVersion: 1,
    gardenId: "electromagnetism-1",
    gardenRationale: "The model selected one interaction and one prose explanation across the batch.",
    decisions: [requiredU24(), proseDecision(second)],
  };
  return { learningUnits, packet, response };
}

describe("model-authored visual necessity batch", () => {
  test("packages the entire garden without making a necessity decision", () => {
    const { packet } = fixture();
    assert.deepEqual(packet.units.map((candidate) => candidate.unitId), ["U24", "U25"]);
    assert.equal(packet.units[0].learningQuestion, unit().learningQuestion);
    assert.equal(packet.units[0].evidence.some((item) => item.kind === "learning_question"), true);
    assert.equal("necessity" in packet.units[0], false);
    const prompt = buildModelVisualNecessityPrompt(packet);
    assert.match(prompt.system, /sole pedagogical decision-maker/i);
    assert.match(prompt.system, /maximums, not quotas/i);
  });

  test("accepts U24 only when the model authors a source-grounded case control", () => {
    const { packet, learningUnits, response } = fixture();
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.problems));
    assert.equal(result.plan.counts.required, 1);
    assert.equal(result.plan.decisionRecords[0].decisionSource, "model_batch");
    assert.equal(result.plan.budget.targetMinimum, 0);
    assert.equal(result.plan.interactionDrafts.U24.controls[0].kind, "select_case");
    assert.equal(result.plan.learningUnits[0].interactiveVisualPlan.interactionGoal, "compare_cases");
    assert.equal(result.plan.learningUnits[0].interactiveVisualPlan.observable.representation, "animation");
    assert.equal(
      result.plan.learningUnits[0].interactiveVisualPlan.controlContract[0].label,
      "time or frequency domain",
    );
    assert.equal(
      result.plan.learningUnits[0].interactiveVisualPlan.visualIntent.visualType,
      "generated_module",
    );
    assert.deepEqual(
      result.plan.learningUnits[0].interactiveVisualPlan.visualIntent.learnerManipulates,
      ["time or frequency domain"],
    );
    assert.deepEqual(
      result.plan.learningUnits[0].interactiveVisualPlan.expectedInsightEvidence,
      response.decisions[0].interaction.expectedInsightEvidence,
    );
    assert.deepEqual(
      persistedVisualizationControlContractProblems(result.plan.learningUnits[0]),
      [],
    );
  });

  test("fails closed when the model omits any learning unit", () => {
    const { packet, learningUnits, response } = fixture();
    response.decisions.pop();
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) => problem.code === "missing_unit" && problem.unitId === "U25"), true);
    assert.equal("plan" in result, false);
  });

  test("fails closed when a required decision has no model-authored learner input", () => {
    const { packet, learningUnits, response } = fixture();
    delete response.decisions[0].interaction;
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) => problem.code === "missing_interaction_contract"), true);
  });

  test("fails closed when interaction behavior or observable representation is not model-authored", () => {
    const { packet, learningUnits, response } = fixture();
    delete response.decisions[0].interaction.interactionGoal;
    delete response.decisions[0].interaction.observable.representation;
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) => problem.code === "invalid_interaction_goal"), true);
    assert.equal(
      result.problems.some((problem) => problem.code === "invalid_observable_representation"),
      true,
    );
  });

  test("rejects coerced strings and nulls for schema, scores, and confidence", () => {
    const { packet, learningUnits, response } = fixture();
    response.schemaVersion = "1";
    response.decisions[0].manipulationValue = "";
    response.decisions[0].confidence = null;
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) => problem.code === "schema_version_mismatch"), true);
    assert.equal(result.problems.some((problem) =>
      problem.code === "invalid_score" && problem.path.endsWith("manipulationValue")), true);
    assert.equal(result.problems.some((problem) => problem.code === "invalid_confidence"), true);
  });

  test("uses the shared evidence validator and rejects an invented control", () => {
    const { packet, learningUnits, response } = fixture();
    response.decisions[0].interaction.controls[0] = {
      kind: "variable",
      label: "temperature",
      evidence: [{
        anchor: "unit:U24:learning-question",
        quote: unit().learningQuestion,
      }],
    };
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) =>
      problem.code === "invalid_interaction_grounding" &&
      /temperature/.test(problem.message)), true);
  });

  test("reports a budget violation without demoting or replacing the model decision", () => {
    const { packet, learningUnits, response } = fixture({
      budget: {
        maximumInteractiveUnits: 0,
        maximumRequiredInteractiveUnits: 0,
      },
    });
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) => problem.code === "garden_budget_exceeded"), true);
    assert.equal(result.problems.some((problem) => problem.code === "required_budget_exceeded"), true);
    assert.equal(response.decisions[0].necessity, "required");
    assert.equal("plan" in result, false);
  });

  test("treats explicit user overrides as validation constraints, not heuristic hints", () => {
    const { packet, learningUnits, response } = fixture({
      overrides: [{
        unitId: "U24",
        action: "force_none",
        reason: "The author explicitly disabled interaction here.",
        createdBy: "user",
      }],
    });
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) => problem.code === "override_conflict"), true);
    assert.equal(response.decisions[0].necessity, "required");
  });

  test("bounds repair at two full model-authored retries and never emits a fallback", () => {
    const { packet, response } = fixture();
    const problems = [{
      code: "missing_learner_input",
      path: "decisions[0].interaction.controls",
      message: "at least one learner control is required",
      unitId: "U24",
    }];
    assert.deepEqual(MODEL_VISUAL_NECESSITY_CALL_BUDGET, {
      initialCalls: 1,
      maximumRepairCalls: 2,
      maximumTotalCalls: 3,
    });
    const repair = buildModelVisualNecessityRepairPrompt({
      packet,
      invalidResponse: response,
      problems,
      repairAttempt: 1,
    });
    assert.match(repair.system, /complete replacement batch/i);
    assert.doesNotMatch(repair.system, /heuristic fallback/i);
    assert.throws(() => buildModelVisualNecessityRepairPrompt({
      packet,
      invalidResponse: response,
      problems,
      repairAttempt: 3,
    }), /between 1 and 2/);
  });

  test("repairs an invalid first response with a second full model-authored batch", async () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const requests = [];
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async (request) => {
        requests.push(request);
        return request.attempt === 0 ? invalid : response;
      },
    });
    assert.equal(result.calls, 2);
    assert.equal(result.repairCalls, 1);
    assert.equal(result.plan.counts.required, 1);
    assert.deepEqual(requests.map((request) => request.attempt), [0, 1]);
    assert.equal(requests[1].problems.some((problem) => problem.code === "missing_interaction_contract"), true);
    assert.match(requests[1].system, /complete replacement batch/i);
  });

  test("persistent invalid output exhausts exactly three calls and throws final problems", async () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    let calls = 0;
    await assert.rejects(
      runModelVisualNecessityPlanning({
        packet,
        learningUnits,
        provider: async () => {
          calls += 1;
          return invalid;
        },
      }),
      (error) => {
        assert.equal(error instanceof ModelVisualNecessityPlanningError, true);
        assert.equal(error.calls, 3);
        assert.equal(error.problems.some((problem) => problem.code === "missing_interaction_contract"), true);
        return true;
      },
    );
    assert.equal(calls, 3);
  });

  test("preserves a valid model-authored zero-interaction garden without promotion", async () => {
    const { packet, learningUnits, response } = fixture();
    response.decisions = learningUnits.map(proseDecision);
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async () => response,
    });
    assert.equal(result.calls, 1);
    assert.equal(result.plan.counts.interactive, 0);
    assert.equal(result.plan.counts.nonInteractive, 2);
    assert.equal(result.plan.learningUnits.every((candidate) =>
      candidate.interactiveVisualPlan.requirement === "none"), true);
    assert.deepEqual(result.plan.interactionDrafts, {});
    assert.equal(result.plan.zeroVisualSafeguard.triggered, false);
    assert.equal(result.plan.zeroVisualSafeguard.status, "consistent_zero");
    assert.equal(result.plan.zeroVisualSafeguard.recoveredUnitId, undefined);
  });
});
