import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  buildVisualizationPlanWithContractRepair,
  buildVisualizationContractRepairPrompt,
  exactVisualizationContractRepairResponse,
  parseVisualizationContractRepairResponse,
  validateVisualizationContractUnitRepair,
} from "../src/lib/visualization-contract-repair.ts";
import {
  MAX_VISUALIZATION_CONTRACT_REPAIR_RESPONSE_BYTES,
} from "../src/lib/visualization-contract-validation.ts";
import {
  applyVisualizationRoutesToLearningUnits,
} from "../src/lib/visualization-opportunities.ts";
import { normalizeLearningUnits } from "../src/lib/learning-unit-contract.ts";

const QUESTION =
  "How do Maxwell's equations support propagating electric and magnetic fields, and how are sinusoidal waves represented in time and frequency domains?";
const CLAIM =
  "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations.";
const CLAIM_ANCHOR = "S1.P24.claim-maxwell-waves";
const CANONICAL_EVIDENCE_BY_UNIT = Object.freeze({
  U24: Object.freeze([{ anchor: CLAIM_ANCHOR, kind: "source_text", text: CLAIM }]),
});
const VISUAL_BUDGET = Object.freeze({
  targetMinimum: 1,
  targetMaximum: 1,
  maximumPerSection: 1,
  minimumUnitsBetweenSimilarVisuals: 2,
  requiredVisuals: 1,
  recommendedVisuals: 0,
  optionalVisuals: 0,
  reason: "The model authored one required comparison interaction.",
});

function requiredU24() {
  const decision = {
    unitId: "U24",
    pageId: "U24",
    necessity: "required",
    preferredMedium: "interactive_visual",
    learningGoal: QUESTION,
    manipulationValue: 0.9,
    dynamicBehaviorValue: 0.9,
    comparisonValue: 0.8,
    spatialValue: 0.4,
    parameterSensitivityValue: 0.8,
    sourceFigureSufficiency: 0.1,
    proseSufficiency: 0.3,
    formulaSufficiency: 0.3,
    workedExampleSufficiency: 0.2,
    cognitiveLoadRisk: 0.3,
    duplicationRisk: 0.1,
    implementationRisk: 0.4,
    evidence: {
      unitRole: "synthesis",
      concepts: ["Maxwell's equations", "Electromagnetic wave", "Time domain", "Frequency domain"],
      learningQuestion: QUESTION,
      sourceAnchorIds: [CLAIM_ANCHOR],
      nearbyVisualIntentIds: [],
    },
    reason: "Interaction is required to compare the source-defined representations.",
  };
  return {
    id: "U24",
    title: "Maxwell's Equations and Electromagnetic Waves",
    role: "synthesis",
    learningQuestion: QUESTION,
    prerequisiteConcepts: ["Maxwell's equations"],
    newConcepts: ["Electromagnetic wave", "Time domain", "Frequency domain"],
    sourceAnchors: [CLAIM_ANCHOR],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    interactiveVisual: undefined,
    interactiveVisualPlan: {
      decision,
      requirement: "required",
      alternativeCoverage: "uncovered",
      interactionGoal: "compare_cases",
      visualIntent: {
        id: "visual-u24-wave-representation",
        uniqueConcept: "Time-domain and frequency-domain wave representations",
        visualType: "generated_module",
        whyStaticSourceFigureIsNotEnough:
          "The learner must switch representations to compare the source-defined operations.",
        learnerManipulates: ["time differentiation and frequency-domain operations"],
        expectedInsight:
          "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
        sourceAnchors: [CLAIM_ANCHOR],
        duplicateSignature: "wave-representation-operation-comparison",
      },
      observable: {
        label: "Phasor representation",
        representation: "animation",
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      },
    },
    teachingMediumPlan: {
      unitId: "U24",
      preferredMedium: "interactive_visual",
      reason: decision.reason,
    },
    zettelNotes: [],
    semanticConcepts: [{
      slug: "electromagnetic-wave",
      preferredLabel: "Electromagnetic wave",
      role: "primary",
      aliases: [],
      evidenceAnchors: [CLAIM_ANCHOR],
    }],
    knowledgeClaims: [{
      id: "claim-maxwell-waves",
      text: CLAIM,
      subject: "electric-and-magnetic-fields",
      predicate: "support",
      object: "electromagnetic-waves",
      conceptIds: ["electromagnetic-wave"],
      evidenceAnchors: [CLAIM_ANCHOR],
      derivationAnchors: [],
      connectedClaimIds: [],
    }],
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
  };
}

function mapFor(unit) {
  return {
    gardenId: "electromagnetism-1",
    title: "Electromagnetism",
    summary: "Source-grounded electromagnetism lessons.",
    sourceOnly: true,
    createdAt: "2026-08-14T00:00:00.000Z",
    warnings: [],
    sections: [{
      id: "section-6",
      title: "Electromagnetic waves",
      purpose: unit.learningQuestion,
      sourceAnchors: unit.sourceAnchors,
      subsections: [{
        id: "subsection-6-4",
        title: unit.title,
        purpose: unit.learningQuestion,
        sourceAnchors: unit.sourceAnchors,
        conceptTags: unit.newConcepts,
        learningUnitId: unit.id,
      }],
    }],
  };
}

function validU24Repair(extra = {}) {
  return {
    repairs: [{
      unitId: "U24",
      interactionGoal: "compare_cases",
      learnerAction:
        "Choose each source-defined operation, compare the resulting representation, and state the difference.",
      visualIntent: {
        id: "visual-u24-repaired-wave-representation",
        uniqueConcept: "Time-domain and frequency-domain wave representations",
        visualType: "generated_module",
        whyStaticSourceFigureIsNotEnough:
          "The learner must switch representations to compare the source-defined operations.",
        learnerManipulates: ["time differentiation and frequency-domain operations"],
        expectedInsight:
          "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
        sourceAnchors: [CLAIM_ANCHOR],
        duplicateSignature: "repaired-wave-representation-operation-comparison",
      },
      controls: [{
        id: "representation_operation",
        kind: "select_case",
        label: "time differentiation and frequency-domain operations",
        type: "select",
        options: ["time differentiation", "frequency-domain operations"],
        defaultValue: "frequency-domain operations",
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      }],
      observable: {
        label: "Phasor representation",
        representation: "animation",
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      },
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      ...extra,
    }],
  };
}

test("U24 complete interaction contract is model-repaired, typed, and preserved on generated routing", async () => {
  const unit = requiredU24();
  let calls = 0;
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    repairProvider: async (packet) => {
      calls += 1;
      assert.equal(packet.units[0]?.unitId, "U24");
      assert.deepEqual(packet.units[0]?.evidence, CANONICAL_EVIDENCE_BY_UNIT.U24);
      assert.equal(packet.units[0]?.evidence.some((entry) => entry.kind === "learning_question"), false);
      assert.match(packet.problems.join(" "), /validated model-authored learner control contract/i);
      return validU24Repair();
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.repairSource, "model");
  assert.equal(result.repairAudit.attempts.length, 1);
  assert.equal(result.repairAudit.attempts[0].responseEncoding, "json");
  assert.deepEqual(result.repairAudit.acceptedResponse, result.repairAudit.attempts[0].response);
  assert.equal(
    result.repairAudit.attempts[0].packetHash,
    crypto.createHash("sha256")
      .update(JSON.stringify(result.repairAudit.attempts[0].packet))
      .digest("hex"),
  );
  assert.equal(
    result.repairAudit.attempts[0].requestHash,
    crypto.createHash("sha256")
      .update(JSON.stringify(buildVisualizationContractRepairPrompt(
        result.repairAudit.attempts[0].packet,
      )))
      .digest("hex"),
  );
  assert.equal(result.repairAudit.attempts[0].canonicalEvidenceHashes.U24.length, 64);
  assert.equal(result.learningUnits[0].interactiveVisualPlan.requirement, "required");
  assert.equal(result.learningUnits[0].interactiveVisualPlan.decision.necessity, "required");
  assert.equal(
    result.learningUnits[0].interactiveVisualPlan.visualIntent.id,
    "visual-u24-repaired-wave-representation",
  );
  assert.deepEqual(result.learningUnits[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  assert.deepEqual(result.plan.opportunities[0].requiredInputs[0], {
    id: "representation_operation",
    kind: "select_case",
    label: "time differentiation and frequency-domain operations",
    type: "select",
    options: ["time differentiation", "frequency-domain operations"],
    defaultValue: "frequency-domain operations",
  });
  assert.equal(result.plan.decisions[0].route, "generated_module");

  const routed = applyVisualizationRoutesToLearningUnits(result.learningUnits, result.plan);
  assert.equal(routed[0].interactiveVisualPlan.requirement, "required");
  assert.equal(routed[0].interactiveVisual.visualType, "generated_module");
  assert.deepEqual(routed[0].interactiveVisual.learnerManipulates, [
    "time differentiation and frequency-domain operations",
  ]);
  assert.deepEqual(routed[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  const roundTripped = normalizeLearningUnits(JSON.parse(JSON.stringify(routed)));
  assert.equal(
    roundTripped[0].interactiveVisualPlan.visualIntent.id,
    "visual-u24-repaired-wave-representation",
  );
  assert.equal(roundTripped[0].interactiveVisualPlan.interactionGoal, "compare_cases");
  assert.deepEqual(roundTripped[0].interactiveVisualPlan.observable, {
    label: "Phasor representation",
    representation: "animation",
    evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
  });
  assert.deepEqual(roundTripped[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  assert.deepEqual(roundTripped[0].interactiveVisualPlan.expectedInsightEvidence, [
    { anchor: CLAIM_ANCHOR, quote: CLAIM },
  ]);
});

test("control IDs permit z, reserve runtime x/t, and keep the immutable projection exact", async () => {
  const unit = requiredU24();
  const acceptedRepair = validU24Repair();
  acceptedRepair.repairs[0].controls[0].id = "z";

  const acceptedProblems = validateVisualizationContractUnitRepair({
    unit,
    evidence: CANONICAL_EVIDENCE_BY_UNIT.U24,
    repair: acceptedRepair.repairs[0],
    requireCompleteContract: true,
  });
  assert.deepEqual(acceptedProblems, []);

  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    repairProvider: async () => acceptedRepair,
  });
  const repairedControls = result.learningUnits[0].interactiveVisualPlan.controlContract;
  assert.deepEqual(repairedControls, acceptedRepair.repairs[0].controls);
  assert.deepEqual(
    result.learningUnits[0].interactiveVisualPlan.decision.interaction.controls,
    acceptedRepair.repairs[0].controls,
  );
  const routed = applyVisualizationRoutesToLearningUnits(result.learningUnits, result.plan);
  assert.deepEqual(routed[0].interactiveVisualPlan.controlContract, acceptedRepair.repairs[0].controls);

  for (const reservedId of ["x", "t"]) {
    const rejectedRepair = validU24Repair().repairs[0];
    rejectedRepair.controls[0].id = reservedId;
    const parsed = parseVisualizationContractRepairResponse({
      repairs: [rejectedRepair],
    }, {
      requireCompleteContract: true,
      expectedUnitIds: ["U24"],
    });
    assert.match(parsed.problems.join(" "), /reserved by the generated visual runtime/i);
    const problems = validateVisualizationContractUnitRepair({
      unit: requiredU24(),
      evidence: CANONICAL_EVIDENCE_BY_UNIT.U24,
      repair: rejectedRepair,
      requireCompleteContract: true,
    });
    assert.match(problems.join(" "), new RegExp(`control id "${reservedId}" is reserved`, "i"));
  }
});

test("a malformed recommended interaction receives the same bounded model repair without deterministic demotion", async () => {
  const unit = requiredU24();
  unit.interactiveVisualPlan.requirement = "recommended";
  unit.interactiveVisualPlan.decision.necessity = "recommended";
  const visualBudget = {
    ...VISUAL_BUDGET,
    requiredVisuals: 0,
    recommendedVisuals: 1,
    reason: "The model authored one recommended comparison interaction.",
  };
  let calls = 0;
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    repairProvider: async (packet) => {
      calls += 1;
      assert.equal(packet.units[0]?.requirement, "recommended");
      return validU24Repair();
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.repairSource, "model");
  assert.equal(result.learningUnits[0].interactiveVisualPlan.requirement, "recommended");
  assert.equal(result.learningUnits[0].interactiveVisualPlan.decision.necessity, "recommended");
  assert.equal(result.plan.decisions[0].route, "generated_module");
});

test("active repair rejects legacy question evidence before invoking the model", async () => {
  const unit = requiredU24();
  let calls = 0;
  await assert.rejects(
    () => buildVisualizationPlanWithContractRepair({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
      visualBudget: VISUAL_BUDGET,
      canonicalEvidenceByUnit: {
        U24: [{ anchor: CLAIM_ANCHOR, kind: "learning_question", text: QUESTION }],
      },
      repairProvider: async () => {
        calls += 1;
        return validU24Repair();
      },
    }),
    /evidence kind learning_question is not canonical extracted-source evidence/i,
  );
  assert.equal(calls, 0);
});

test("hallucinated U24 control is rejected, then a grounded retry sees the rejection", async () => {
  const unit = requiredU24();
  const packets = [];
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    maxRepairAttempts: 2,
    repairProvider: async (packet) => {
      packets.push(packet);
      if (packets.length === 1) {
        const invalid = validU24Repair();
        invalid.repairs[0].controls = [{
          id: "wave_amplitude",
          kind: "variable",
          label: "wave amplitude",
          type: "slider",
          min: 0,
          max: 10,
          step: 0.1,
          defaultValue: 1,
          evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
        }];
        return invalid;
      }
      return validU24Repair();
    },
  });

  assert.equal(result.repairAttempts, 2);
  assert.match(packets[1].previousRejectionReasons.join(" "), /wave amplitude.*not present/i);
  assert.match(packets[1].previousRejectionReasons.join(" "), /visualIntent/i);
});

test("persistent generic or unanchored controls exhaust the bounded repair budget", async () => {
  const unit = requiredU24();
  let calls = 0;
  await assert.rejects(
    () => buildVisualizationPlanWithContractRepair({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
      visualBudget: VISUAL_BUDGET,
      canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
      maxRepairAttempts: 2,
      repairProvider: async () => {
        calls += 1;
        return {
          repairs: [{
            unitId: "U24",
            controls: [{
              id: "process_position",
              kind: "process_position",
              label: calls === 1 ? "process step" : "time",
              type: "slider",
              min: 0,
              max: 1,
              step: 0.1,
              defaultValue: 0,
              evidence: [{ anchor: "S1.P999.invented", quote: "invented time" }],
            }],
            expectedInsight: "observe the response",
            expectedInsightEvidence: [{ anchor: "S1.P999.invented", quote: "invented response" }],
          }],
        };
      },
    }),
    /Automatic model-approved visualization contract repair exhausted 2 bounded attempt/i,
  );
  assert.equal(calls, 2);
  assert.equal(unit.interactiveVisualPlan.controlContract, undefined);
});

test("wrong-unit and invented select cases fail independent evidence validation", () => {
  const unit = requiredU24();
  const problems = validateVisualizationContractUnitRepair({
    unit,
    evidence: CANONICAL_EVIDENCE_BY_UNIT.U24,
    repair: {
      unitId: "U25",
      controls: [{
        id: "representation_operation",
        kind: "select_case",
        label: "time differentiation and frequency-domain operations",
        type: "select",
        options: ["time differentiation", "spatial operations"],
        defaultValue: "time differentiation",
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      }],
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
    },
  });
  assert.match(problems.join(" "), /targets U25, expected U24/i);
  assert.match(problems.join(" "), /spatial operations.*not present/i);

  const duplicateProblems = validateVisualizationContractUnitRepair({
    unit,
    evidence: CANONICAL_EVIDENCE_BY_UNIT.U24,
    repair: {
      unitId: "U24",
      controls: [{
        id: "representation_operation",
        kind: "select_case",
        label: "time differentiation and frequency-domain operations",
        type: "select",
        options: ["time differentiation", "Time Differentiation"],
        defaultValue: "time differentiation",
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      }],
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
    },
  });
  assert.match(duplicateProblems.join(" "), /duplicate cases/i);
});

test("strict repair parsing reports malformed and extra controls without truncating valid records", () => {
  const control = (index) => ({
    id: `case_${index}`,
    kind: "select_case",
    label: "time differentiation and frequency-domain operations",
    type: "select",
    options: ["time differentiation", "frequency-domain operations"],
    defaultValue: "frequency-domain operations",
    evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
  });
  const parsed = parseVisualizationContractRepairResponse({
    repairs: [{
      unitId: "U24",
      controls: [control(1), null, control(2), control(3), control(4)],
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
    }],
  });
  assert.equal(parsed.repairs[0].controls.length, 4, "valid controls are preserved, not sliced");
  assert.match(parsed.problems.join(" "), /contains 5 controls; at most 3/i);
  assert.match(parsed.problems.join(" "), /controls\[1\] must be an object/i);
});

test("complete repair parsing rejects duplicate, unknown, unexpected, and oversized records", () => {
  const valid = validU24Repair().repairs[0];
  const duplicate = parseVisualizationContractRepairResponse({
    repairs: [valid, structuredClone(valid)],
  }, {
    requireCompleteContract: true,
    expectedUnitIds: ["U24"],
  });
  assert.match(duplicate.problems.join(" "), /duplicates repair for U24/i);
  assert.match(duplicate.problems.join(" "), /exactly 1 repair/i);

  const unknown = structuredClone(valid);
  unknown.unitId = "U99";
  unknown.controls[0].unexpected = true;
  const unknownResult = parseVisualizationContractRepairResponse({ repairs: [unknown] }, {
    requireCompleteContract: true,
    expectedUnitIds: ["U24"],
  });
  assert.match(unknownResult.problems.join(" "), /unexpected/i);
  assert.match(unknownResult.problems.join(" "), /unaffected or unknown unit U99/i);
  assert.match(unknownResult.problems.join(" "), /omitted affected unit U24/i);

  const oversized = parseVisualizationContractRepairResponse({
    repairs: [valid],
    padding: "x".repeat(MAX_VISUALIZATION_CONTRACT_REPAIR_RESPONSE_BYTES),
  }, { requireCompleteContract: true, expectedUnitIds: ["U24"] });
  assert.match(oversized.problems.join(" "), /response exceeds/i);
});

test("structural repair provider transport failure escapes one semantic attempt", async () => {
  const unit = requiredU24();
  let calls = 0;
  const events = [];
  await assert.rejects(
    () => buildVisualizationPlanWithContractRepair({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
      visualBudget: VISUAL_BUDGET,
      canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
      maxRepairAttempts: 3,
      repairProvider: async () => {
        calls += 1;
        throw new Error("repair transport failed");
      },
      onEvent: (type) => events.push(type),
    }),
    /repair transport failed/,
  );
  assert.equal(calls, 1);
  assert.equal(events.includes("visual_opportunity_contract_repair_transport_aborted"), true);
  assert.equal(events.includes("visual_opportunity_contract_repair_exhausted"), false);
});

test("repair transport identity survives throwing cancellation and event observers", async () => {
  const unit = requiredU24();
  const providerFailure = Object.assign(new Error("nested reset"), {
    cause: { code: "ECONNRESET" },
  });
  let calls = 0;
  let cancellationChecks = 0;
  await assert.rejects(
    buildVisualizationPlanWithContractRepair({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
      visualBudget: VISUAL_BUDGET,
      canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
      maxRepairAttempts: 3,
      repairProvider: async () => {
        calls += 1;
        throw providerFailure;
      },
      checkCancelled: () => {
        cancellationChecks += 1;
        if (cancellationChecks > 1) {
          throw new Error("post-provider cancellation must not replace provider failure");
        }
      },
      onEvent: () => {
        throw new Error("event sink must not replace provider failure");
      },
    }),
    (error) => error === providerFailure,
  );
  assert.equal(calls, 1);
  assert.equal(cancellationChecks, 1);
});

test("missing and literal-null exact repair responses are terminal after one provider call", async () => {
  const unit = requiredU24();
  for (const response of [undefined, "", "null", "```json\nnull\n```"]) {
    let calls = 0;
    await assert.rejects(
      buildVisualizationPlanWithContractRepair({
        gardenId: "electromagnetism-1",
        learningMap: mapFor(unit),
        learningUnits: [unit],
        visualBudget: VISUAL_BUDGET,
        canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
        maxRepairAttempts: 3,
        repairProvider: async () => {
          calls += 1;
          return typeof response === "string"
            ? exactVisualizationContractRepairResponse(response)
            : response;
        },
      }),
      /no candidate|empty response|literal JSON null/i,
    );
    assert.equal(calls, 1, `unexpected replay for ${JSON.stringify(response)}`);
  }
});

test("nonempty malformed exact repair text permits one validation-targeted correction", async () => {
  const unit = requiredU24();
  let calls = 0;
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    maxRepairAttempts: 2,
    repairProvider: async () => {
      calls += 1;
      return calls === 1
        ? exactVisualizationContractRepairResponse("{malformed")
        : validU24Repair();
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.repairAudit.attempts[0].response, "{malformed");
  assert.match(result.repairAudit.attempts[0].rejectionReasons.join(" "), /response must be an object/i);
});

test("a fulfilled valid repair is parsed before any later cancellation checkpoint", async () => {
  const unit = requiredU24();
  let cancellationChecks = 0;
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    repairProvider: async () => validU24Repair(),
    checkCancelled: () => {
      cancellationChecks += 1;
      if (cancellationChecks > 1) throw new Error("late cancellation observer");
    },
  });
  assert.equal(result.repairSource, "model");
  assert.equal(cancellationChecks, 1);
});

test("active repair parsing reports an incomplete replacement contract", () => {
  const parsed = parseVisualizationContractRepairResponse({
    repairs: [{
      unitId: "U24",
      controls: validU24Repair().repairs[0].controls,
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
    }],
  }, { requireCompleteContract: true });
  assert.match(parsed.problems.join(" "), /interactionGoal is required/i);
  assert.match(parsed.problems.join(" "), /visualIntent is required/i);
  assert.match(parsed.problems.join(" "), /observable is required/i);
});

test("complete repair validation rejects stale intent fields and non-canonical anchors", () => {
  const repair = validU24Repair().repairs[0];
  repair.visualIntent = {
    ...repair.visualIntent,
    learnerManipulates: ["stale prior control"],
    sourceAnchors: ["S1.P999.invented"],
  };
  const problems = validateVisualizationContractUnitRepair({
    unit: requiredU24(),
    evidence: CANONICAL_EVIDENCE_BY_UNIT.U24,
    repair,
    requireCompleteContract: true,
  });
  assert.match(problems.join(" "), /learnerManipulates must exactly match/i);
  assert.match(problems.join(" "), /not canonical evidence/i);
  assert.match(problems.join(" "), /omits cited evidence anchor/i);
});

test("numeric control domains and defaults fail closed instead of receiving normalized values", () => {
  const problems = validateVisualizationContractUnitRepair({
    unit: requiredU24(),
    evidence: CANONICAL_EVIDENCE_BY_UNIT.U24,
    repair: {
      unitId: "U24",
      controls: [{
        id: "time_position",
        kind: "process_position",
        label: "time differentiation",
        type: "slider",
        min: 10,
        max: 0,
        step: 0,
        defaultValue: 11,
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      }],
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
    },
  });
  assert.match(problems.join(" "), /requires min < max/i);
  assert.match(problems.join(" "), /requires step > 0/i);
  assert.match(problems.join(" "), /default is outside min\/max/i);
});

test("a later incomplete contract is repaired by the model, never restored by code", async () => {
  const unit = requiredU24();
  const planned = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    repairProvider: async () => validU24Repair(),
  });
  const grounded = applyVisualizationRoutesToLearningUnits(planned.learningUnits, planned.plan);
  const cleared = grounded.map((item) => ({
    ...item,
    interactiveVisual: undefined,
    interactiveVisualPlan: {
      ...item.interactiveVisualPlan,
      visualIntent: undefined,
      interactionGoal: undefined,
      controlContract: undefined,
      observable: undefined,
      expectedInsightEvidence: undefined,
    },
  }));
  let extraCalls = 0;
  const regenerated = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: cleared,
    visualBudget: VISUAL_BUDGET,
    canonicalEvidenceByUnit: CANONICAL_EVIDENCE_BY_UNIT,
    repairProvider: async () => {
      extraCalls += 1;
      return validU24Repair();
    },
  });

  assert.equal(extraCalls, 1);
  assert.equal(regenerated.repairSource, "model");
  assert.equal(regenerated.learningUnits[0].interactiveVisual.id, "visual-u24-repaired-wave-representation");
  assert.equal(regenerated.learningUnits[0].interactiveVisualPlan.interactionGoal, "compare_cases");
  assert.deepEqual(regenerated.learningUnits[0].interactiveVisualPlan.observable, {
    label: "Phasor representation",
    representation: "animation",
    evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
  });
  assert.deepEqual(regenerated.learningUnits[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  assert.equal(regenerated.plan.opportunities[0].requiredInputs[0].type, "select");
});
