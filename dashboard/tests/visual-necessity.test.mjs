import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";

import {
  applyVisualNecessityDecisionsToUnits,
  applyVisualNecessityReview,
  assessInteractiveVisualFulfillment,
  buildVisualNecessityReviewPacket,
  coordinateGardenVisualDecisions,
  decideInteractiveVisualNecessity,
  deriveGardenVisualBudget,
  deriveTeachingMediumPlan,
  planGardenVisualNecessity,
  planScopedVisualRepairs,
  loadVisualDecisionOverrides,
  saveVisualDecisionOverrides,
  saveVisualNecessityArtifacts,
  validateVisualNecessityReview,
} from "../src/lib/visual-necessity.ts";

function visual(id = "lif_neuron", concept = "membrane dynamics") {
  return {
    id: `visual-${id}`,
    uniqueConcept: concept,
    visualType: id,
    whyStaticSourceFigureIsNotEnough: "The learner changes a parameter and observes the causal response.",
    learnerManipulates: ["input current", "threshold"],
    expectedInsight: "Changing the parameter changes the observed behavior.",
    sourceAnchors: ["S1.P1.F1"],
    duplicateSignature: `${id}:${concept}`,
  };
}

function unit(overrides = {}) {
  return {
    id: "U1",
    title: "Membrane current and voltage dynamics",
    role: "mechanism",
    learningQuestion: "How does changing membrane current alter voltage dynamics over time?",
    prerequisiteConcepts: [],
    newConcepts: ["membrane dynamics"],
    sourceAnchors: ["S1.P1.T1"],
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

function withPlan(candidate, decision, requirement, extra = {}) {
  return {
    ...candidate,
    interactiveVisualPlan: {
      decision,
      requirement,
      alternativeCoverage: requirement === "required" ? "uncovered" : "covered",
      ...extra,
    },
    teachingMediumPlan: deriveTeachingMediumPlan(candidate, decision),
  };
}

describe("visual necessity decisions", () => {
  test("1. Dynamic parameter-sensitive concept becomes required", () => {
    assert.equal(decideInteractiveVisualNecessity(unit(), {}).necessity, "required");
  });

  test("2. Useful but nonessential comparison becomes recommended", () => {
    const decision = decideInteractiveVisualNecessity(unit({
      role: "comparison",
      title: "Rate versus temporal encoding",
      learningQuestion: "How do rate and temporal encoding compare under the same input?",
      newConcepts: ["rate encoding", "temporal encoding"],
    }), {});
    assert.equal(decision.necessity, "recommended");
  });

  test("3. Adequate source figure for a static concept causes not-needed decision", () => {
    // The figure depicts a genuinely static/definitional concept (no dynamic,
    // parameter, comparative, or spatial behavior), so it is a full substitute
    // and interaction adds nothing. A figure of *dynamic* behavior is only a
    // partial substitute and is covered by test "5.".
    const decision = decideInteractiveVisualNecessity(unit({
      role: "core_concept",
      title: "The definition of a biological neuron",
      learningQuestion: "What is the biological definition of a neuron?",
      newConcepts: ["neuron definition"],
      sourceFigures: [{
        id: "S1.P2.F1",
        placement: "inside_concept_explanation",
        mustBeDiscussedWith: "neuron anatomy",
        interpretationGoal: "Identify each labeled part of the neuron.",
      }],
    }), {});
    assert.equal(decision.necessity, "not_needed");
    assert.equal(decision.preferredMedium, "source_figure");
  });

  test("4. Adequate formula derivation causes not-needed decision", () => {
    const candidate = unit({
      role: "formula",
      title: "Deriving the membrane update equation",
      learningQuestion: "How is the membrane update equation derived?",
      sourceFormulas: [{ id: "S1.P3.E1", teachingGoal: "derive the update", termsToDefine: ["V", "tau"], placement: "before_example" }],
    });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.equal(decision.necessity, "not_needed");
    assert.equal(decision.preferredMedium, "formula_derivation");
  });

  test("5. Historical descriptive unit chooses prose or timeline", () => {
    const decision = decideInteractiveVisualNecessity(unit({
      role: "motivation",
      title: "History of neuromorphic computing",
      learningQuestion: "Which milestones shaped the historical development of the field?",
      newConcepts: ["history"],
    }), {});
    assert.equal(decision.necessity, "not_needed");
    assert.ok(["timeline", "prose"].includes(decision.preferredMedium));
  });

  test("6. Repeated interaction is downgraded", () => {
    const first = unit({ interactiveVisual: visual("neural_coding", "encoding comparison") });
    const firstDecision = decideInteractiveVisualNecessity(first, {});
    const secondDecision = decideInteractiveVisualNecessity(unit({
      id: "U2",
      interactiveVisual: visual("neural_coding", "encoding comparison"),
      newConcepts: ["membrane dynamics"],
    }), { nearbyVisualDecisions: [firstDecision] });
    assert.ok(["not_needed", "harmful_or_distracting"].includes(secondDecision.necessity));
    assert.ok(secondDecision.duplicationRisk >= 0.85);
  });

  test("7. Decorative interaction is rejected", () => {
    const decision = decideInteractiveVisualNecessity(unit({
      title: "Decorative visual variety for terminology",
      learningQuestion: "How can aesthetic controls make definitions look interesting?",
      interactiveVisual: visual("lif_neuron", "decorative terminology"),
    }), {});
    assert.equal(decision.necessity, "harmful_or_distracting");
  });

  test("8. Missing prerequisites increase cognitive-load risk", () => {
    const candidate = unit({ prerequisiteConcepts: ["spike", "threshold", "membrane", "differential equations"] });
    const missing = decideInteractiveVisualNecessity(candidate, { availablePrerequisiteConcepts: [] });
    const present = decideInteractiveVisualNecessity(candidate, { availablePrerequisiteConcepts: candidate.prerequisiteConcepts });
    assert.ok(missing.cognitiveLoadRisk > present.cognitiveLoadRisk);
  });

  test("9. Decision is deterministic for equivalent inputs", () => {
    const candidate = unit();
    assert.deepEqual(decideInteractiveVisualNecessity(candidate, {}), decideInteractiveVisualNecessity(structuredClone(candidate), {}));
  });

  test("necessity is stable before and after a legacy visual type is attached", () => {
    const candidate = unit({ interactiveVisual: undefined });
    const routed = { ...candidate, interactiveVisual: visual("lif_neuron", "legacy routed intent") };
    assert.deepEqual(
      decideInteractiveVisualNecessity(candidate, {}),
      decideInteractiveVisualNecessity(routed, {}),
    );
    const plan = planGardenVisualNecessity({ gardenId: "stable", learningUnits: [routed] });
    assert.equal(plan.learningUnits[0].interactiveVisual, undefined);
    assert.equal(plan.learningUnits[0].interactiveVisualPlan.visualIntent, undefined);
  });
});

describe("contract behavior", () => {
  const requiredDecision = decideInteractiveVisualNecessity(unit(), {});
  const comparison = unit({ role: "comparison", title: "Encoding comparison", learningQuestion: "How do encoding alternatives compare?" });
  const recommendedDecision = decideInteractiveVisualNecessity(comparison, {});
  const optionalDecision = { ...recommendedDecision, necessity: "optional" };
  const noneDecision = { ...recommendedDecision, necessity: "not_needed", preferredMedium: "prose" };
  const harmfulDecision = { ...noneDecision, necessity: "harmful_or_distracting" };

  test("10. Required visual missing is blocking", () => {
    assert.equal(assessInteractiveVisualFulfillment({ unit: withPlan(unit(), requiredDecision, "required") }).severity, "blocker");
  });

  test("11. Recommended visual missing is a warning", () => {
    assert.equal(assessInteractiveVisualFulfillment({ unit: withPlan(comparison, recommendedDecision, "recommended") }).severity, "warning");
  });

  test("12. Optional visual missing is not an issue", () => {
    assert.equal(assessInteractiveVisualFulfillment({ unit: withPlan(comparison, optionalDecision, "optional") }).severity, "none");
  });

  test("strict Learn finalization blocks every missing model-approved interaction", () => {
    for (const [requirement, decision] of [
      ["required", requiredDecision],
      ["recommended", recommendedDecision],
      ["optional", optionalDecision],
    ]) {
      const assessment = assessInteractiveVisualFulfillment({
        unit: withPlan(comparison, decision, requirement),
        intentionallyOmitted: true,
        strictModelApprovedRequirement: true,
      });
      assert.equal(assessment.severity, "blocker", `${requirement} must remain blocking`);
      assert.equal(assessment.code, "model_approved_missing");
      assert.match(assessment.reason, new RegExp(`model-approved ${requirement}`, "i"));
    }
  });

  test("13. No-visual unit does not trigger fulfillment failure", () => {
    assert.equal(assessInteractiveVisualFulfillment({ unit: withPlan(comparison, noneDecision, "none") }).severity, "none");
  });

  test("14. Harmful visual is rejected", () => {
    const assessment = assessInteractiveVisualFulfillment({
      unit: withPlan(comparison, harmfulDecision, "none"),
      embeddedVisualTypes: ["lif_neuron"],
    });
    assert.equal(assessment.code, "harmful_visual");
    assert.equal(assessment.severity, "blocker");
  });

  test("15. Contract requirement updates when decision changes", () => {
    const first = applyVisualNecessityDecisionsToUnits({ gardenId: "g", learningUnits: [unit()], decisions: [requiredDecision] });
    const changed = { ...requiredDecision, necessity: "not_needed", preferredMedium: "prose", reason: "Prose now covers the goal." };
    const second = applyVisualNecessityDecisionsToUnits({ gardenId: "g", learningUnits: first.learningUnits, decisions: [changed] });
    assert.equal(first.learningUnits[0].interactiveVisualPlan.requirement, "required");
    assert.equal(second.learningUnits[0].interactiveVisualPlan.requirement, "none");
  });
});

describe("alternative media", () => {
  test("16. Source figure may satisfy visual need for a static concept", () => {
    const candidate = unit({
      role: "core_concept",
      title: "The definition of a biological neuron",
      learningQuestion: "What is the biological definition of a neuron?",
      newConcepts: ["neuron definition"],
      sourceFigures: [{ id: "F1", placement: "inside_concept_explanation", mustBeDiscussedWith: "anatomy", interpretationGoal: "identify labeled parts" }],
    });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.equal(deriveTeachingMediumPlan(candidate, decision).sourceFigureAnchorId, "F1");
  });

  test("17. Worked example may satisfy visual need", () => {
    const candidate = unit({ role: "worked_example", title: "Worked example of spike counting", learningQuestion: "How is spike count calculated step by step?" });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.equal(deriveTeachingMediumPlan(candidate, decision).preferredMedium, "worked_example");
  });

  test("18. Formula derivation may satisfy visual need", () => {
    const candidate = unit({ role: "formula", title: "Derive the decay equation", learningQuestion: "How is the decay equation derived?", sourceFormulas: [{ id: "E1", teachingGoal: "derive", termsToDefine: ["tau"], placement: "before_example" }] });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.deepEqual(deriveTeachingMediumPlan(candidate, decision).formulaAnchorIds, ["E1"]);
  });

  test("19. Static diagram may be selected", () => {
    const candidate = unit({ role: "core_concept", title: "Network topology and spatial layer structure", learningQuestion: "What is the spatial structure of the network?", newConcepts: ["topology"] });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.equal(decision.preferredMedium, "generated_static_diagram");
  });

  test("20. No additional visual may be selected honestly", () => {
    const candidate = unit({ role: "synthesis", title: "Summary and takeaways", learningQuestion: "How do the previously introduced ideas fit together?" });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.equal(decision.preferredMedium, "no_additional_visual");
  });
});

describe("garden coordination", () => {
  function codingUnits() {
    return [0, 1, 2, 3].map((index) => unit({
      id: `U${index + 1}`,
      title: `Neural coding comparison ${index + 1}`,
      learningQuestion: "How does changing the code alter temporal information?",
      newConcepts: index < 2 ? ["neural coding"] : [`coding depth ${index}`],
      interactiveVisual: visual("neural_coding", index < 2 ? "neural coding" : `coding depth ${index}`),
    }));
  }

  test("21. Duplicate coding interaction receives one primary owner", () => {
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: codingUnits().slice(0, 2) });
    assert.equal(plan.decisions.filter((decision) => ["required", "recommended", "optional"].includes(decision.necessity)).length, 1);
  });

  test("22. Later duplicate unit is assigned a different medium", () => {
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: codingUnits().slice(0, 2) });
    assert.notEqual(plan.decisions[1].preferredMedium, "interactive_visual");
  });

  test("23. Visual budget does not force weak visuals", () => {
    const units = Array.from({ length: 20 }, (_, index) => unit({ id: `H${index}`, role: "motivation", title: `Historical definition ${index}`, learningQuestion: "What terminology was used historically?" }));
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: units });
    assert.ok(plan.budget.targetMinimum > 0);
    assert.equal(plan.decisions.filter((decision) => decision.preferredMedium === "interactive_visual").length, 0);
  });

  test("24. Required visual may exceed soft budget", () => {
    const units = codingUnits().slice(0, 2);
    const decisions = units.map((candidate, index) => ({ ...decideInteractiveVisualNecessity(candidate, {}), unitId: candidate.id, necessity: "required", recommendedVisualType: `distinct_${index}` }));
    const coordinated = coordinateGardenVisualDecisions(decisions, { units, budget: { ...deriveGardenVisualBudget(units, decisions), targetMaximum: 0, minimumUnitsBetweenSimilarVisuals: 0 } });
    assert.equal(coordinated.filter((decision) => decision.necessity === "required").length, 2);
  });

  test("25. Similar visual spacing is respected", () => {
    const units = codingUnits();
    const decisions = units.map((candidate) => ({ ...decideInteractiveVisualNecessity(candidate, {}), unitId: candidate.id, necessity: "recommended", evidence: { ...decideInteractiveVisualNecessity(candidate, {}).evidence, concepts: [candidate.newConcepts[0]] }, recommendedVisualType: "neural_coding" }));
    const coordinated = coordinateGardenVisualDecisions(decisions, { units, budget: { ...deriveGardenVisualBudget(units, decisions), minimumUnitsBetweenSimilarVisuals: 3, targetMaximum: 10 } });
    assert.notEqual(coordinated[1].necessity, "recommended");
    assert.equal(coordinated[3].necessity, "recommended");
  });

  test("26. Garden coordination is deterministic", () => {
    const units = codingUnits();
    const decisions = units.map((candidate) => decideInteractiveVisualNecessity(candidate, {}));
    assert.deepEqual(coordinateGardenVisualDecisions(decisions, { units }), coordinateGardenVisualDecisions(structuredClone(decisions), { units: structuredClone(units) }));
  });
});

describe("ChatMock review guard", () => {
  // A static concept whose figure is a *full* substitute (sufficiency ≥ 0.8), so
  // the "a sufficient non-interactive medium cannot be ignored" guard applies.
  const sourceUnit = unit({
    role: "core_concept",
    title: "The definition of a biological neuron",
    learningQuestion: "What is the biological definition of a neuron?",
    newConcepts: ["neuron definition"],
    sourceFigures: [{ id: "F1", placement: "inside_concept_explanation", mustBeDiscussedWith: "anatomy", interpretationGoal: "identify labeled parts" }],
  });
  const sourceDecision = decideInteractiveVisualNecessity(sourceUnit, {});
  const packet = buildVisualNecessityReviewPacket({ unit: sourceUnit, deterministicDecision: sourceDecision });

  test("27. Ambiguous decision receives a narrow packet", () => {
    assert.deepEqual(Object.keys(packet.unit), ["id", "title", "role", "learningQuestion", "concepts"]);
    assert.ok(packet.allowedActions.length <= 5);
    assert.ok(packet.relevantSourceEvidence.every((item) => item.anchorId));
  });

  test("28. ChatMock cannot invent unsupported visual type", () => {
    const problems = validateVisualNecessityReview(packet, { action: "downgrade_to_optional", visualType: "invented_renderer", reason: "Maybe useful." }, ["lif_neuron"]);
    assert.ok(problems.some((problem) => /not supported/.test(problem)));
  });

  test("29. ChatMock cannot ignore a sufficient source figure", () => {
    const problems = validateVisualNecessityReview(packet, { action: "confirm_required", reason: "Use interaction." });
    assert.ok(problems.some((problem) => /sufficient non-interactive/.test(problem)));
  });

  test("30. ChatMock cannot add interaction for aesthetics alone", () => {
    const dynamicPacket = buildVisualNecessityReviewPacket({ unit: unit(), deterministicDecision: decideInteractiveVisualNecessity(unit(), {}) });
    const problems = validateVisualNecessityReview(dynamicPacket, { action: "confirm_required", reason: "Add aesthetic visual variety." });
    assert.ok(problems.some((problem) => /aesthetic variety/.test(problem)));
  });

  test("31. Invalid decision is rejected", () => {
    assert.throws(() => applyVisualNecessityReview(packet, { action: "invalid_action", reason: "No." }));
  });

  test("32. Verified downgrade updates the contract", () => {
    const candidate = unit({ role: "comparison", title: "Encoding comparison", learningQuestion: "How do two encodings compare?" });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    const reviewPacket = buildVisualNecessityReviewPacket({ unit: candidate, deterministicDecision: decision });
    const reviewed = applyVisualNecessityReview(reviewPacket, { action: "downgrade_to_optional", reason: "A static comparison remains adequate." });
    const plan = applyVisualNecessityDecisionsToUnits({ gardenId: "g", learningUnits: [candidate], decisions: [reviewed] });
    assert.equal(plan.learningUnits[0].interactiveVisualPlan.requirement, "optional");
  });
});

describe("scoped repair", () => {
  const requiredUnit = unit();
  const requiredDecision = decideInteractiveVisualNecessity(requiredUnit, {});
  const recommendedUnit = unit({ id: "R", role: "comparison", title: "Encoding comparison", learningQuestion: "How do encoding alternatives compare?" });
  const recommendedDecision = decideInteractiveVisualNecessity(recommendedUnit, {});
  const optionalUnit = unit({ id: "O" });
  const optionalDecision = { ...decideInteractiveVisualNecessity(optionalUnit, {}), necessity: "optional" };
  const noneUnit = unit({ id: "N", role: "motivation", title: "Historical definition", learningQuestion: "What was defined historically?" });
  const noneDecision = decideInteractiveVisualNecessity(noneUnit, {});
  const planned = [
    withPlan(requiredUnit, requiredDecision, "required"),
    withPlan(recommendedUnit, recommendedDecision, "recommended"),
    withPlan(optionalUnit, optionalDecision, "optional"),
    withPlan(noneUnit, noneDecision, "none"),
  ];

  test("33. Missing required visual is repaired", () => {
    assert.equal(planScopedVisualRepairs({ learningUnits: planned, issues: [{ unitId: "U1", kind: "missing" }] })[0].action, "generate_required_visual");
  });

  test("34. Missing optional visual is ignored", () => {
    assert.equal(planScopedVisualRepairs({ learningUnits: planned, issues: [{ unitId: "O", kind: "missing" }] })[0].action, "ignore_optional_absence");
  });

  test("35. Missing recommended visual may be downgraded after alternative verification", () => {
    assert.equal(planScopedVisualRepairs({ learningUnits: planned, issues: [{ unitId: "R", kind: "missing" }] })[0].action, "replace_with_alternative_medium");
  });

  test("36. Unnecessary stale requirement is removed", () => {
    assert.equal(planScopedVisualRepairs({ learningUnits: planned, issues: [{ unitId: "N", kind: "missing" }] })[0].action, "remove_stale_requirement");
  });

  test("37. Repair does not add visuals to unrelated units", () => {
    const instructions = planScopedVisualRepairs({ learningUnits: planned, issues: [{ unitId: "U1", kind: "missing" }] });
    assert.deepEqual(instructions.map((item) => item.unitId), ["U1"]);
  });

  test("38. Unaffected page bodies remain unchanged", () => {
    const bodies = { U1: "required body", R: "recommended body", O: "optional body", N: "no-visual body" };
    const before = structuredClone(bodies);
    const instructions = planScopedVisualRepairs({ learningUnits: planned, issues: [{ unitId: "U1", kind: "missing" }] });
    for (const instruction of instructions) bodies[instruction.unitId] += "\nvisual repaired";
    assert.equal(bodies.R, before.R);
    assert.equal(bodies.O, before.O);
    assert.equal(bodies.N, before.N);
  });
});

test("regression fixture: eight stale planned visuals become a sparse, satisfiable contract", () => {
  const dynamic = Array.from({ length: 4 }, (_, index) => unit({
    id: `D${index + 1}`,
    title: `Parameter-sensitive dynamic process ${index + 1}`,
    learningQuestion: `How does changing parameter ${index + 1} alter the dynamic trajectory over time?`,
    newConcepts: [`dynamic process ${index + 1}`],
    interactiveVisual: visual(["lif_neuron", "stdp_window", "tradeoff_explorer", "neural_coding"][index], `dynamic process ${index + 1}`),
  }));
  const sourceFigures = [1, 2].map((index) => unit({
    id: `F${index}`,
    title: `Static source result ${index}`,
    role: "result_interpretation",
    learningQuestion: `What does source result ${index} show?`,
    newConcepts: [`result ${index}`],
    sourceFigures: [{ id: `S1.P${index}.F1`, placement: "inside_result_interpretation", mustBeDiscussedWith: "the result", interpretationGoal: "explain the complete result" }],
    interactiveVisual: visual("tradeoff_explorer", `stale source result ${index}`),
  }));
  const worked = unit({ id: "W1", role: "worked_example", title: "Worked example of event counting", learningQuestion: "How is event count calculated step by step?", newConcepts: ["event count"], interactiveVisual: visual("metric_calculator", "stale calculation") });
  const duplicate = unit({ id: "X1", title: dynamic[0].title, learningQuestion: dynamic[0].learningQuestion, newConcepts: dynamic[0].newConcepts, interactiveVisual: { ...dynamic[0].interactiveVisual, duplicateSignature: dynamic[0].interactiveVisual.duplicateSignature } });
  const units = [...dynamic, ...sourceFigures, worked, duplicate];
  const plan = planGardenVisualNecessity({ gardenId: "regression", learningUnits: units });

  assert.equal(plan.decisions.length, 8);
  const retained = plan.learningUnits.filter((candidate) => candidate.interactiveVisualPlan.requirement === "required");
  assert.equal(retained.length, 4);
  assert.equal(plan.teachingMedia.filter((medium) => medium.preferredMedium === "source_figure").length, 2);
  assert.equal(plan.teachingMedia.filter((medium) => medium.preferredMedium === "worked_example").length, 1);
  assert.notEqual(plan.learningUnits.find((candidate) => candidate.id === "X1").interactiveVisualPlan.requirement, "required");

  const mismatched = retained.slice(0, 3).map((candidate) => ({ unitId: candidate.id, kind: "type_mismatch" }));
  const repairs = planScopedVisualRepairs({ learningUnits: plan.learningUnits, issues: mismatched });
  assert.equal(repairs.filter((repair) => repair.action === "replace_required_visual_type").length, 3);
  assert.ok(retained.every((candidate) => candidate.interactiveVisual === undefined));
  for (const candidate of plan.learningUnits) {
    const generatedVisualIds = candidate.interactiveVisualPlan.requirement === "required"
      ? [`generated-${candidate.id}`]
      : [];
    assert.notEqual(assessInteractiveVisualFulfillment({ unit: candidate, generatedVisualIds }).severity, "blocker");
  }
  assert.ok(retained.length < units.length);
});

test("author overrides and audit artifacts persist across replanning", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visual-necessity-"));
  try {
    const overrides = [{ unitId: "U1", action: "force_none", reason: "Author uses a physical demonstration.", createdBy: "user" }];
    saveVisualDecisionOverrides(root, overrides);
    const loaded = loadVisualDecisionOverrides(root);
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: [unit()], overrides: loaded });
    assert.equal(plan.learningUnits[0].interactiveVisualPlan.requirement, "none");
    saveVisualNecessityArtifacts(root, "g", plan);
    assert.ok(fs.existsSync(path.join(root, ".breadboard", "visual-necessity-decisions.json")));
    const markdown = fs.readFileSync(path.join(root, ".breadboard", "visual-necessity-decisions.md"), "utf-8");
    assert.match(markdown, /# Interactive Visual Decisions/);
    assert.match(markdown, /Author override/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("prerequisite cognitive load is position-aware (regression: garden produced zero visuals)", () => {
  // Real gardens author prerequisites as high-level themes ("spike encoding")
  // that never string-match the granular new concepts earlier units introduce
  // ("rate coding", "spike train"). The old logic read that as "prerequisites
  // unmet" for nearly every unit, slammed cognitive-load risk to 0.85, and
  // suppressed every interactive visual. These pin the corrected behavior.

  function thematicDynamicUnits() {
    const topics = ["membrane", "network", "gradient", "surrogate", "plasticity", "efficiency"];
    return topics.map((topic, index) =>
      unit({
        id: `U${index + 1}`,
        role: "formula",
        title: `Parameter-driven ${topic} dynamics`,
        learningQuestion: `How does adjusting the threshold reshape the ${topic} voltage trajectory over time?`,
        // Thematic prerequisites that deliberately do NOT match any newConcepts.
        prerequisiteConcepts: [`upstream ${topic} theme`, `background idea ${index}`],
        newConcepts: [`${topic} dynamics`],
        sourceFigures: [],
      }),
    );
  }

  test("40. a coherent sequence of dynamic units with thematic prerequisites still yields interactive visuals", () => {
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: thematicDynamicUnits() });
    const interactive = plan.decisions.filter((decision) =>
      ["required", "recommended", "optional"].includes(decision.necessity),
    );
    assert.ok(interactive.length >= 2, `expected several interactive visuals, got ${interactive.length}`);
  });

  test("41. unmet prerequisites never brand a visual distracting; they cap it at optional", () => {
    const decision = decideInteractiveVisualNecessity(
      unit({ role: "mechanism", prerequisiteConcepts: ["a", "b", "c", "d"] }),
      { unitIndex: 0, totalUnits: 10, availablePrerequisiteConcepts: [] },
    );
    assert.notEqual(decision.necessity, "harmful_or_distracting");
    assert.ok(decision.cognitiveLoadRisk <= 0.7, `cognitive load ${decision.cognitiveLoadRisk} should stay <= 0.70`);
  });

  test("42. a later unit carries less prerequisite load than the identical earlier unit", () => {
    const candidate = unit({ role: "formula", title: "Threshold dynamics", prerequisiteConcepts: ["x", "y"] });
    const early = decideInteractiveVisualNecessity(candidate, { unitIndex: 1, totalUnits: 20, availablePrerequisiteConcepts: [] });
    const late = decideInteractiveVisualNecessity(candidate, { unitIndex: 18, totalUnits: 20, availablePrerequisiteConcepts: [] });
    assert.ok(late.cognitiveLoadRisk < early.cognitiveLoadRisk);
  });
});
