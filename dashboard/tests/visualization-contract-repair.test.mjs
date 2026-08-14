import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVisualizationPlanWithContractRepair,
  validateVisualizationContractUnitRepair,
} from "../src/lib/visualization-contract-repair.ts";
import {
  applyVisualizationRoutesToLearningUnits,
} from "../src/lib/visualization-opportunities.ts";
import { normalizeLearningUnits } from "../src/lib/learning-unit-contract.ts";

const QUESTION =
  "How do Maxwell's equations support propagating electric and magnetic fields, and how are sinusoidal waves represented in time and frequency domains?";
const CLAIM =
  "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations.";
const CLAIM_ANCHOR = "S1.P24.claim-maxwell-waves";

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
      controls: [{
        kind: "select_case",
        label: "time differentiation and frequency-domain operations",
        options: ["time differentiation", "frequency-domain operations"],
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      }],
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      // These unsupported fields prove the provider cannot change policy.
      requirement: "optional",
      necessity: "not_needed",
      renderer: "metric_calculator",
      ...extra,
    }],
  };
}

test("U24 required control is model-repaired, typed, and preserved on generated-module routing", async () => {
  const unit = requiredU24();
  let calls = 0;
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    repairProvider: async (packet) => {
      calls += 1;
      assert.equal(packet.units[0]?.unitId, "U24");
      assert.match(packet.problems.join(" "), /validated model-authored learner control contract/i);
      return validU24Repair();
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.repairSource, "model");
  assert.equal(result.learningUnits[0].interactiveVisualPlan.requirement, "required");
  assert.deepEqual(result.learningUnits[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  assert.deepEqual(result.plan.opportunities[0].requiredInputs[0], {
    id: "time_differentiation_and_frequency_domain_operations",
    label: "time differentiation and frequency-domain operations",
    type: "select",
    options: ["time differentiation", "frequency-domain operations"],
    defaultValue: "time differentiation",
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
  assert.deepEqual(roundTripped[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  assert.deepEqual(roundTripped[0].interactiveVisualPlan.expectedInsightEvidence, [
    { anchor: CLAIM_ANCHOR, quote: CLAIM },
  ]);
});

test("hallucinated U24 control is rejected, then a grounded retry sees the rejection", async () => {
  const unit = requiredU24();
  const packets = [];
  const result = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    maxRepairAttempts: 2,
    repairProvider: async (packet) => {
      packets.push(packet);
      if (packets.length === 1) {
        return {
          repairs: [{
            unitId: "U24",
            controls: [{
              kind: "variable",
              label: "wave amplitude",
              evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
            }],
            expectedInsight: "Phasor representation replaces sinusoidal time differentiation",
            expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
          }],
        };
      }
      return validU24Repair();
    },
  });

  assert.equal(result.repairAttempts, 2);
  assert.match(packets[1].previousRejectionReasons.join(" "), /wave amplitude.*not present/i);
});

test("persistent generic or unanchored controls exhaust the bounded repair budget", async () => {
  const unit = requiredU24();
  let calls = 0;
  await assert.rejects(
    () => buildVisualizationPlanWithContractRepair({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
      maxRepairAttempts: 2,
      repairProvider: async () => {
        calls += 1;
        return {
          repairs: [{
            unitId: "U24",
            controls: [{
              kind: "process_position",
              label: calls === 1 ? "process step" : "time",
              evidence: [{ anchor: "S1.P999.invented", quote: "invented time" }],
            }],
            expectedInsight: "observe the response",
            expectedInsightEvidence: [{ anchor: "S1.P999.invented", quote: "invented response" }],
          }],
        };
      },
    }),
    /Automatic required-visual contract repair exhausted 2 bounded attempt/i,
  );
  assert.equal(calls, 2);
  assert.equal(unit.interactiveVisualPlan.controlContract, undefined);
});

test("wrong-unit and invented select cases fail independent evidence validation", () => {
  const unit = requiredU24();
  const problems = validateVisualizationContractUnitRepair({
    unit,
    repair: {
      unitId: "U25",
      controls: [{
        kind: "select_case",
        label: "time differentiation and frequency-domain operations",
        options: ["time differentiation", "spatial operations"],
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
    repair: {
      unitId: "U24",
      controls: [{
        kind: "select_case",
        label: "time differentiation and frequency-domain operations",
        options: ["time differentiation", "Time Differentiation"],
        evidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
      }],
      expectedInsight:
        "Phasor representation replaces sinusoidal time differentiation with algebraic frequency-domain operations",
      expectedInsightEvidence: [{ anchor: CLAIM_ANCHOR, quote: CLAIM }],
    },
  });
  assert.match(duplicateProblems.join(" "), /duplicate cases/i);
});

test("generation rerun restores the validated typed contract without another model call", async () => {
  const unit = requiredU24();
  const planned = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    repairProvider: async () => validU24Repair(),
  });
  const grounded = applyVisualizationRoutesToLearningUnits(planned.learningUnits, planned.plan);
  const cleared = grounded.map((item) => ({
    ...item,
    interactiveVisual: undefined,
    interactiveVisualPlan: {
      ...item.interactiveVisualPlan,
      visualIntent: undefined,
      controlContract: undefined,
      expectedInsightEvidence: undefined,
    },
  }));
  let extraCalls = 0;
  const regenerated = await buildVisualizationPlanWithContractRepair({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: cleared,
    groundingUnits: grounded,
    repairProvider: async () => {
      extraCalls += 1;
      throw new Error("generation must reuse the validated planning contract");
    },
  });

  assert.equal(extraCalls, 0);
  assert.equal(regenerated.repairSource, "persisted_contract");
  assert.deepEqual(regenerated.learningUnits[0].interactiveVisualPlan.controlContract[0].options, [
    "time differentiation",
    "frequency-domain operations",
  ]);
  assert.equal(regenerated.plan.opportunities[0].requiredInputs[0].type, "select");
});
