import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  MODEL_VISUAL_NECESSITY_CALL_BUDGET,
  MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_CALL_BUDGET,
  ModelVisualNecessityPlanningError,
  applyModelVisualNecessityTargetedRepairs,
  buildModelVisualNecessityPacket,
  buildModelVisualNecessityPrompt,
  buildModelVisualNecessityRepairPrompt,
  buildModelVisualNecessityTargetedRepairPrompt,
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

const CANONICAL_U24_TEXT =
  "Electric and magnetic fields form sinusoidal waves represented in the time domain or frequency domain.";
const CANONICAL_U25_TEXT =
  "Intrinsic impedance relates electric-field and magnetic-field amplitudes in an electromagnetic wave.";

function requiredU24(overrides = {}) {
  const question = unit().learningQuestion;
  const questionEvidence = {
    anchor: "S1.P24",
    quote: CANONICAL_U24_TEXT,
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
          id: "representation_domain",
          kind: "select_case",
          label: "time or frequency domain",
          type: "select",
          options: ["time domain", "frequency domain"],
          defaultValue: "frequency domain",
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
    canonicalEvidenceByUnit: {
      U24: [{ anchor: "S1.P24", kind: "source_text", text: CANONICAL_U24_TEXT }],
      U25: [{ anchor: "S1.P25", kind: "source_text", text: CANONICAL_U25_TEXT }],
    },
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
    visualBudget: {
      targetMinimum: 1,
      targetMaximum: 1,
      maximumPerSection: 1,
      minimumUnitsBetweenSimilarVisuals: 2,
      requiredVisuals: 1,
      recommendedVisuals: 0,
      optionalVisuals: 0,
      reason: "One source-grounded interaction is sufficient for this two-unit garden.",
    },
    decisions: [requiredU24(), proseDecision(second)],
  };
  return { learningUnits, packet, response };
}

function predictionU24(overrides = {}) {
  const base = requiredU24();
  const evidence = [{
    anchor: "S1.P24",
    quote: CANONICAL_U24_TEXT,
  }];
  return {
    ...base,
    interaction: {
      ...base.interaction,
      interactionGoal: "test_prediction",
      learnerAction:
        "Choose a representation-domain prediction, commit it, then reveal the represented fields.",
      controls: [
        {
          id: "prediction_domain",
          kind: "select_case",
          label: "time or frequency domain",
          type: "select",
          protocolRole: "prediction_input",
          options: ["time domain", "frequency domain"],
          defaultValue: "frequency domain",
          evidence,
        },
        {
          id: "commit_prediction",
          kind: "protocol_action",
          label: "Commit prediction",
          type: "button",
          protocolRole: "commit_prediction",
          defaultValue: 0,
          evidence: [],
        },
        {
          id: "reveal_outcome",
          kind: "protocol_action",
          label: "Reveal outcome",
          type: "button",
          protocolRole: "reveal_outcome",
          defaultValue: 0,
          evidence: [],
        },
      ],
    },
    ...overrides,
  };
}

const U16_WAVE_FORMULA = "E_x(z,t)=f(z-vt)+g(z+vt)";
const U17_WAVENUMBER_FORMULA =
  "k=\\omega\\sqrt{\\mu\\epsilon}=k_0\\sqrt{\\mu_r\\epsilon_r}";

function electromagnetismFormulaFixture() {
  const learningUnits = [
    unit({
      id: "U16",
      title: "Deriving the One-Dimensional Electromagnetic Wave Equation",
      role: "formula",
      learningQuestion:
        "How do Maxwell's coupled curl equations produce electric and magnetic fields that propagate through space?",
      prerequisiteConcepts: ["Maxwell's equations", "partial derivatives"],
      newConcepts: ["electromagnetic wave equation", "forward wave", "backward wave"],
      sourceAnchors: ["S1.P383.E8"],
    }),
    unit({
      id: "U17",
      title: "Plane-Wave Impedance and Time-Harmonic Propagation",
      role: "formula",
      learningQuestion:
        "How are electric and magnetic wave amplitudes related, and how does phasor notation convert time-varying waves into spatial propagation equations?",
      prerequisiteConcepts: ["electromagnetic wave equation", "complex numbers"],
      newConcepts: ["wavenumber", "phase propagation"],
      sourceAnchors: ["S1.P390.E2"],
    }),
  ];
  const packet = buildModelVisualNecessityPacket({
    gardenId: "electromagnetism-1",
    learningUnits,
    canonicalEvidenceByUnit: {
      U16: [{ anchor: "S1.P383.E8", kind: "source_formula", text: U16_WAVE_FORMULA }],
      U17: [{ anchor: "S1.P390.E2", kind: "source_formula", text: U17_WAVENUMBER_FORMULA }],
    },
    budget: {
      maximumInteractiveUnits: 2,
      maximumRequiredInteractiveUnits: 1,
    },
  });
  const decision = ({
    candidate,
    necessity,
    interactionGoal,
    controls,
    observable,
    expectedInsight,
    anchor,
    duplicateSignature,
  }) => ({
    unitId: candidate.unitId,
    pageId: candidate.pageId,
    necessity,
    preferredMedium: "interactive_visual",
    learningGoal: candidate.learningQuestion,
    ...scores,
    evidence: {
      unitRole: candidate.role,
      concepts: [...candidate.concepts],
      learningQuestion: candidate.learningQuestion,
      sourceAnchorIds: [...candidate.sourceAnchorIds],
      nearbyVisualIntentIds: [],
    },
    reason: "The exact source relationship benefits from learner-controlled inspection.",
    confidence: 0.96,
    alternativeCoverage: "uncovered",
    teachingMediumReason: "The model selected a source-grounded interactive representation.",
    interaction: {
      interactionGoal,
      uniqueConcept: `Source-grounded ${candidate.unitId} relationship`,
      whyStaticSourceFigureIsNotEnough:
        "The model judged direct manipulation necessary to inspect the exact source relationship.",
      learnerAction: "Change the cited source variable and inspect the cited source output.",
      controls,
      observable,
      expectedInsight,
      expectedInsightEvidence: [{ anchor, quote: expectedInsight }],
      duplicateSignature,
    },
  });
  const response = {
    schemaVersion: 1,
    gardenId: "electromagnetism-1",
    gardenRationale: "The two distinct source formulas receive distinct model-authored interactions.",
    visualBudget: {
      targetMinimum: 2,
      targetMaximum: 2,
      maximumPerSection: 2,
      minimumUnitsBetweenSimilarVisuals: 0,
      requiredVisuals: 1,
      recommendedVisuals: 1,
      optionalVisuals: 0,
      reason: "The model selected two distinct formula interactions.",
    },
    decisions: [
      decision({
        candidate: packet.units[0],
        necessity: "required",
        interactionGoal: "observe_change_over_time",
        controls: [{
          id: "wave_time_t",
          kind: "process_position",
          label: "t",
          type: "slider",
          min: 0,
          max: 10,
          step: 0.1,
          defaultValue: 0,
          evidence: [{ anchor: "S1.P383.E8", quote: U16_WAVE_FORMULA }],
        }],
        observable: {
          label: "E_x(z,t)",
          representation: "animation",
          evidence: [{ anchor: "S1.P383.E8", quote: U16_WAVE_FORMULA }],
        },
        expectedInsight: U16_WAVE_FORMULA,
        anchor: "S1.P383.E8",
        duplicateSignature: "forward-backward-wave-time-translation",
      }),
      decision({
        candidate: packet.units[1],
        necessity: "recommended",
        interactionGoal: "inspect_relationship",
        controls: ["\\omega", "\\mu", "\\epsilon"].map((label, index) => ({
          id: ["wavenumber_omega", "wavenumber_mu", "wavenumber_epsilon"][index],
          kind: "variable",
          label,
          type: "number",
          min: 1,
          max: 10,
          step: 1,
          defaultValue: 1,
          evidence: [{ anchor: "S1.P390.E2", quote: U17_WAVENUMBER_FORMULA }],
        })),
        observable: {
          label: "k",
          representation: "value",
          evidence: [{ anchor: "S1.P390.E2", quote: U17_WAVENUMBER_FORMULA }],
        },
        expectedInsight: U17_WAVENUMBER_FORMULA,
        anchor: "S1.P390.E2",
        duplicateSignature: "wavenumber-frequency-permeability-permittivity-response",
      }),
    ],
  };
  return { learningUnits, packet, response };
}

describe("model-authored visual necessity batch", () => {
  test("packages the entire garden without making a necessity decision", () => {
    const { packet } = fixture();
    assert.deepEqual(packet.units.map((candidate) => candidate.unitId), ["U24", "U25"]);
    assert.equal(packet.units[0].learningQuestion, unit().learningQuestion);
    assert.equal(packet.units[0].evidence.some((item) => item.kind === "source_text"), true);
    assert.equal(packet.units[0].evidence.some((item) => item.kind === "learning_question"), false);
    assert.equal("necessity" in packet.units[0], false);
    const prompt = buildModelVisualNecessityPrompt(packet);
    assert.match(prompt.system, /sole pedagogical decision-maker/i);
    assert.match(prompt.system, /maximums, not quotas/i);
    assert.match(prompt.system, /exact source symbols and formulas.*identifier boundaries/i);
  });

  test("accepts U24 only when the model authors a source-grounded case control", () => {
    const { packet, learningUnits, response } = fixture();
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.problems));
    assert.equal(result.plan.counts.required, 1);
    assert.equal(result.plan.decisionRecords[0].decisionSource, "model_batch");
    assert.equal(result.plan.budget.targetMinimum, 1);
    assert.equal(result.plan.budget.minimumUnitsBetweenSimilarVisuals, 2);
    assert.equal(result.plan.interactionDrafts.U24.controls[0].kind, "select_case");
    assert.equal(result.plan.interactionDrafts.U24.controls[0].id, "representation_domain");
    assert.equal(result.plan.interactionDrafts.U24.controls[0].type, "select");
    assert.equal(result.plan.interactionDrafts.U24.controls[0].defaultValue, "frequency domain");
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
      persistedVisualizationControlContractProblems(
        result.plan.learningUnits[0],
        packet.units[0].evidence,
      ),
      [],
    );
  });

  test("planner control IDs allow z but reserve runtime x and t", () => {
    const accepted = fixture();
    accepted.response.decisions[0].interaction.controls[0].id = "z";
    const acceptedResult = validateModelVisualNecessityBatch(accepted);
    assert.equal(
      acceptedResult.ok,
      true,
      acceptedResult.ok ? "" : JSON.stringify(acceptedResult.problems),
    );
    assert.equal(acceptedResult.plan.interactionDrafts.U24.controls[0].id, "z");
    const prompt = buildModelVisualNecessityPrompt(accepted.packet);
    assert.match(prompt.system, /control id must match \^\[a-z\]\[a-z0-9_\]\{0,79\}\$/i);
    assert.match(prompt.system, /x, t are runtime expression variables and are forbidden control ids/i);

    for (const reservedId of ["x", "t"]) {
      const rejected = fixture();
      rejected.response.decisions[0].interaction.controls[0].id = reservedId;
      const rejectedResult = validateModelVisualNecessityBatch(rejected);
      assert.equal(rejectedResult.ok, false, `${reservedId} planner control was accepted`);
      assert.equal(
        rejectedResult.problems.some((problem) =>
          /reserved by the generated visual runtime/i.test(problem.message)),
        true,
      );
    }
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
      id: "temperature",
      kind: "variable",
      label: "temperature",
      type: "slider",
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 20,
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

  test("accepts a complete model-authored prediction protocol in the whole-garden batch", () => {
    const { packet, learningUnits, response } = fixture();
    const predictionResponse = structuredClone(response);
    predictionResponse.decisions[0] = predictionU24();
    const result = validateModelVisualNecessityBatch({
      packet,
      learningUnits,
      response: predictionResponse,
    });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.problems));
    assert.deepEqual(
      result.plan.response.decisions[0].interaction.controls.map((control) =>
        control.protocolRole),
      ["prediction_input", "commit_prediction", "reveal_outcome"],
    );
  });

  test("accepts the exact U16 and U17 symbolic contracts from canonical source formulas", () => {
    const { packet, learningUnits, response } = electromagnetismFormulaFixture();
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.problems));
    assert.equal(result.plan.interactionDrafts.U16.observable.label, "E_x(z,t)");
    assert.equal(result.plan.interactionDrafts.U17.observable.label, "k");
    assert.equal(result.plan.interactionDrafts.U16.expectedInsight, U16_WAVE_FORMULA);
    assert.equal(result.plan.interactionDrafts.U17.expectedInsight, U17_WAVENUMBER_FORMULA);
  });

  test("does not mistake a one-letter symbol for a fragment of a LaTeX command", () => {
    const { packet, learningUnits, response } = electromagnetismFormulaFixture();
    response.decisions[1].interaction.controls[0] = {
      ...response.decisions[1].interaction.controls[0],
      id: "unsupported_r",
      label: "r",
      evidence: [{ anchor: "S1.P390.E2", quote: "\\sqrt" }],
    };
    const result = validateModelVisualNecessityBatch({ packet, learningUnits, response });
    assert.equal(result.ok, false);
    assert.equal(result.problems.some((problem) =>
      problem.code === "invalid_interaction_grounding" &&
      /control "r" is not present/.test(problem.message)), true);
  });

  test("keeps exact mathematical symbols and their source quotes case-sensitive", () => {
    const symbolCase = electromagnetismFormulaFixture();
    symbolCase.response.decisions[1].interaction.observable = {
      ...symbolCase.response.decisions[1].interaction.observable,
      label: "K",
    };
    const symbolResult = validateModelVisualNecessityBatch(symbolCase);
    assert.equal(symbolResult.ok, false);
    assert.equal(symbolResult.problems.some((problem) =>
      problem.code === "invalid_interaction_grounding" &&
      /observable "K" is not present/.test(problem.message)), true);

    const quoteCase = electromagnetismFormulaFixture();
    quoteCase.response.decisions[1].interaction.observable = {
      ...quoteCase.response.decisions[1].interaction.observable,
      evidence: [{
        anchor: "S1.P390.E2",
        quote: U17_WAVENUMBER_FORMULA.replace(/^k=/, "K="),
      }],
    };
    const quoteResult = validateModelVisualNecessityBatch(quoteCase);
    assert.equal(quoteResult.ok, false);
    assert.equal(quoteResult.problems.some((problem) =>
      problem.code === "invalid_interaction_grounding" &&
      /observable has an invalid evidence quote or anchor/.test(problem.message)), true);
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

  test("targeted prompt contains only failed units, exact canonical evidence, and a compact untouched index", () => {
    const { packet, response } = fixture();
    const invalid = structuredClone(response);
    invalid.decisions[0].interaction.expectedInsight = "an inferred conclusion absent from the source";
    const problems = [{
      code: "invalid_interaction_grounding",
      path: "decision:U24.interaction",
      message: "U24: expected insight is not grounded in its cited evidence",
      unitId: "U24",
    }];
    const prompt = buildModelVisualNecessityTargetedRepairPrompt({
      packet,
      invalidResponse: invalid,
      problems,
      targetUnitIds: ["U24"],
      repairAttempt: 1,
    });

    assert.deepEqual(MODEL_VISUAL_NECESSITY_TARGETED_REPAIR_CALL_BUDGET, {
      maximumRepairCalls: 2,
    });
    assert.deepEqual(prompt.sourceContext.units.map((entry) => entry.unit.unitId), ["U24"]);
    assert.deepEqual(prompt.sourceContext.units[0].unit.evidence, packet.units[0].evidence);
    assert.equal(prompt.sourceContext.units[0].invalidDecision, invalid.decisions[0]);
    assert.deepEqual(prompt.sourceContext.wholeGardenConstraints.untouchedDecisionIndex, [{
      unitId: "U25",
      sectionId: "waves",
      necessity: "not_needed",
      preferredMedium: "prose",
    }]);
    assert.equal(prompt.user.includes(CANONICAL_U25_TEXT), false);
    assert.match(prompt.system, /complete replacement decision record/i);
    assert.match(prompt.system, /every meaningful normalized token/i);
    assert.match(prompt.system, /exact substring/i);
    assert.match(prompt.system, /exact source symbols and formulas.*identifier boundaries/i);
    assert.doesNotMatch(prompt.system, /single-symbol labels that have no meaningful normalized token/i);
  });

  test("targeted merge atomically replaces complete failed decisions and preserves every untouched record", () => {
    const { packet, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const untouched = invalid.decisions[1];
    const replacement = requiredU24({
      reason: "The model authored this entire corrected decision record.",
    });
    const merged = applyModelVisualNecessityTargetedRepairs({
      packet,
      invalidResponse: invalid,
      repairResponse: {
        schemaVersion: 1,
        gardenId: packet.gardenId,
        decisions: [replacement],
      },
      targetUnitIds: ["U24"],
    });

    assert.equal(merged.ok, true, merged.ok ? "" : JSON.stringify(merged.problems));
    assert.equal(merged.response.decisions[0], replacement);
    assert.equal(merged.response.decisions[1], untouched);
    assert.equal(merged.response.visualBudget, invalid.visualBudget);
    assert.equal(merged.response.gardenRationale, invalid.gardenRationale);
  });

  test("repairs only failed units with a complete model-authored record, then validates the merged whole batch", async () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    invalid.decisions[0].interaction.controls[0].label = "invented temperature";
    const fullRequests = [];
    const targetedRequests = [];
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async (request) => {
        fullRequests.push(request);
        return invalid;
      },
      targetedRepairProvider: async (request) => {
        targetedRequests.push(request);
        return {
          schemaVersion: 1,
          gardenId: packet.gardenId,
          decisions: [requiredU24()],
        };
      },
    });

    assert.equal(result.calls, 2);
    assert.equal(result.repairCalls, 1);
    assert.equal(result.targetedRepairCalls, 1);
    assert.equal(fullRequests.length, 1);
    assert.deepEqual(targetedRequests[0].unitIds, ["U24"]);
    assert.equal(result.plan.response.decisions[1].unitId, "U25");
    assert.deepEqual(result.plan.response.decisions[1], response.decisions[1]);
    assert.equal(result.plan.response.decisions[0].interaction.controls[0].label, "time or frequency domain");
  });

  test("targeted repair accepts and preserves a complete prediction protocol", async () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async () => invalid,
      targetedRepairProvider: async () => ({
        schemaVersion: 1,
        gardenId: packet.gardenId,
        decisions: [predictionU24()],
      }),
    });
    assert.equal(result.targetedRepairCalls, 1);
    assert.deepEqual(
      result.plan.response.decisions[0].interaction.controls.map((control) => ({
        id: control.id,
        protocolRole: control.protocolRole,
        evidence: control.evidence,
      })),
      [
        { id: "prediction_domain", protocolRole: "prediction_input", evidence: [{ anchor: "S1.P24", quote: CANONICAL_U24_TEXT }] },
        { id: "commit_prediction", protocolRole: "commit_prediction", evidence: [] },
        { id: "reveal_outcome", protocolRole: "reveal_outcome", evidence: [] },
      ],
    );
  });

  test("malformed targeted output is rejected as a whole and retried without applying a partial decision", async () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const requests = [];
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async () => invalid,
      targetedRepairProvider: async (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return { schemaVersion: 1, gardenId: packet.gardenId, decisions: [] };
        }
        return {
          schemaVersion: 1,
          gardenId: packet.gardenId,
          decisions: [requiredU24()],
        };
      },
    });

    assert.equal(result.targetedRepairCalls, 2);
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].problems.some((problem) =>
        problem.code === "invalid_targeted_repair_response" && /omitted affected unit U24/.test(problem.message)),
      true,
    );
  });

  test("a global mismatch after targeted replacement uses the remaining whole-batch model repair", async () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const replacementThatChangesAllocation = proseDecision(learningUnits[0]);
    const fullRequests = [];
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async (request) => {
        fullRequests.push(request);
        return request.attempt === 0 ? invalid : response;
      },
      targetedRepairProvider: async () => ({
        schemaVersion: 1,
        gardenId: packet.gardenId,
        decisions: [replacementThatChangesAllocation],
      }),
    });

    assert.equal(result.targetedRepairCalls, 1);
    assert.deepEqual(fullRequests.map((request) => request.attempt), [0, 1]);
    assert.equal(
      fullRequests[1].problems.some((problem) =>
        problem.code === "visual_budget_count_mismatch" ||
        problem.code === "visual_budget_decision_mismatch"),
      true,
    );
    assert.equal(result.plan.counts.required, 1);
  });

  test("transport failure is rethrown after one logical call and never consumes semantic repair budget", async () => {
    const { packet, learningUnits } = fixture();
    const transportError = new Error("Connection error after bounded HTTP retries");
    let fullCalls = 0;
    let targetedCalls = 0;
    await assert.rejects(
      runModelVisualNecessityPlanning({
        packet,
        learningUnits,
        provider: async () => {
          fullCalls += 1;
          throw transportError;
        },
        targetedRepairProvider: async () => {
          targetedCalls += 1;
          return {};
        },
      }),
      (error) => error === transportError,
    );
    assert.equal(fullCalls, 1);
    assert.equal(targetedCalls, 0);
  });

  test("absent structured model output consumes a semantic repair call instead of masquerading as transport failure", async () => {
    const { packet, learningUnits, response } = fixture();
    const requests = [];
    const result = await runModelVisualNecessityPlanning({
      packet,
      learningUnits,
      provider: async (request) => {
        requests.push(request);
        return request.attempt === 0 ? undefined : response;
      },
    });
    assert.equal(result.calls, 2);
    assert.equal(result.repairCalls, 1);
    assert.equal(result.targetedRepairCalls, 0);
    assert.deepEqual(requests.map((request) => request.attempt), [0, 1]);
    assert.equal(requests[1].problems.some((problem) =>
      problem.code === "invalid_response"), true);
  });

  test("targeted repair rejects missing, legacy, undeclared, or empty canonical evidence before a model call", () => {
    const cases = [
      {
        name: "missing",
        mutate: (packet) => { packet.units[0].evidence = []; },
        expected: /requires non-empty canonical source evidence/i,
      },
      {
        name: "legacy",
        mutate: (packet) => { packet.units[0].evidence[0].kind = "learning_question"; },
        expected: /non-canonical kind learning_question/i,
      },
      {
        name: "undeclared",
        mutate: (packet) => { packet.units[0].evidence[0].anchor = "S1.P999"; },
        expected: /undeclared anchor S1\.P999/i,
      },
      {
        name: "empty",
        mutate: (packet) => { packet.units[0].evidence[0].text = "   "; },
        expected: /empty source text/i,
      },
    ];
    for (const scenario of cases) {
      const { packet, response } = fixture();
      scenario.mutate(packet);
      assert.throws(() => buildModelVisualNecessityTargetedRepairPrompt({
        packet,
        invalidResponse: response,
        problems: [{
          code: "invalid_interaction_grounding",
          path: "decision:U24.interaction",
          message: `${scenario.name} evidence`,
          unitId: "U24",
        }],
        targetUnitIds: ["U24"],
        repairAttempt: 1,
      }), scenario.expected);
    }
  });

  test("fabricated targeted quotes remain rejected by the complete merged-batch validator", () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const fabricated = requiredU24();
    fabricated.interaction.controls[0].evidence = [{
      anchor: "S1.P24",
      quote: "fabricated temperature scale",
    }];
    const merged = applyModelVisualNecessityTargetedRepairs({
      packet,
      invalidResponse: invalid,
      repairResponse: {
        schemaVersion: 1,
        gardenId: packet.gardenId,
        decisions: [fabricated],
      },
      targetUnitIds: ["U24"],
    });
    assert.equal(merged.ok, true);
    const validation = validateModelVisualNecessityBatch({
      packet,
      learningUnits,
      response: merged.response,
    });
    assert.equal(validation.ok, false);
    assert.equal(validation.problems.some((problem) =>
      problem.code === "invalid_interaction_grounding" &&
      /invalid evidence quote or anchor/i.test(problem.message)), true);
  });

  test("targeted replacement must author every canonical anchor used by its interaction contract", () => {
    const { packet, learningUnits, response } = fixture();
    const invalid = structuredClone(response);
    delete invalid.decisions[0].interaction;
    const replacement = requiredU24();
    replacement.evidence.sourceAnchorIds = [];
    const merged = applyModelVisualNecessityTargetedRepairs({
      packet,
      invalidResponse: invalid,
      repairResponse: {
        schemaVersion: 1,
        gardenId: packet.gardenId,
        decisions: [replacement],
      },
      targetUnitIds: ["U24"],
    });
    assert.equal(merged.ok, true);
    const validation = validateModelVisualNecessityBatch({
      packet,
      learningUnits,
      response: merged.response,
    });
    assert.equal(validation.ok, false);
    assert.equal(validation.problems.some((problem) =>
      problem.code === "missing_interaction_source_anchors"), true);
    assert.equal(validation.problems.some((problem) =>
      problem.code === "interaction_source_anchor_omission" &&
      /S1\.P24/.test(problem.message)), true);
  });

  test("preserves a valid model-authored zero-interaction garden without promotion", async () => {
    const { packet, learningUnits, response } = fixture();
    response.decisions = learningUnits.map(proseDecision);
    response.visualBudget = {
      ...response.visualBudget,
      targetMinimum: 0,
      targetMaximum: 0,
      maximumPerSection: 0,
      requiredVisuals: 0,
      recommendedVisuals: 0,
      optionalVisuals: 0,
      reason: "The model judged both units complete without interaction.",
    };
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
