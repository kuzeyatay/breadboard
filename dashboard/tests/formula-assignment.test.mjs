import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFormulaAssignmentPlanToUnits,
  assertPlannedFormulaAssignment,
  buildFormulaAssignmentPlan,
  buildFormulaAssignmentRepairPacket,
  deriveUnitFormulaRequirement,
  formulaCandidatesForUnit,
  formulaAssignmentProvenanceFromPlan,
  resolveFormulaAssignmentAmbiguities,
  scoreFormulaUnitCompatibility,
  validateFormulaAssignment,
  validateFormulaAssignmentPlan,
  verifyFormulaAssignmentRepairDecision,
} from "../src/lib/formula-assignment.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function unit(id, title, role, question, concepts, formulaIds = []) {
  return {
    id, title, role,
    learningQuestion: question,
    prerequisiteConcepts: [],
    newConcepts: concepts,
    sourceAnchors: [...formulaIds],
    sourceFigures: [],
    sourceFormulas: formulaIds.map((formulaId) => ({
      id: formulaId, teachingGoal: question, termsToDefine: concepts, placement: "before_example",
    })),
    sourceTables: [],
    zettelNotes: [],
    semanticConcepts: [],
    knowledgeClaims: [],
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
  };
}

function identity(anchorId, family, canonicalText, title, terms = [], overrides = {}) {
  return {
    anchorId,
    sourceId: "S1",
    page: 6,
    canonicalText,
    title,
    caption: title,
    family,
    evidence: {
      formulaText: canonicalText,
      title,
      caption: title,
      sourceContext: `${title}. ${canonicalText}. Discussed on page 6.`,
      detectedVariables: [],
      detectedTerms: terms,
      familyScores: { [family]: 0.95 },
      selectedFamily: family,
      confidence: "high",
      provenance: "exact_formula_text",
      reason: "test fixture",
    },
    verified: true,
    problems: [],
    ...overrides,
  };
}

// Canonical SNN metric fixtures (family verified upstream).
const ACC = () => identity("S1.P6.E6", "accuracy", "\\text{Accuracy} = N_{correct}/N_{total}", "Classification accuracy", ["correct predictions", "classification accuracy"]);
const LAT = () => identity("S1.P6.E1", "latency", "T = t_{decision} - t_{onset}", "Decision latency", ["decision time", "stimulus onset"]);
const SPK = () => identity("S1.P6.E2", "spike_count", "N = \\sum_{n,t} s_n(t)", "Total spike count", ["total spikes", "spike count"]);
const ENE = () => identity("S1.P6.E3", "energy", "E = N_s E_{spike} + N_c E_{syn}", "Inference energy", ["energy cost", "synaptic operation"]);
const EFF = () => identity("S1.P6.E4", "energy_efficiency", "\\eta = Accuracy/Energy", "Normalized energy efficiency", ["accuracy per energy", "per joule"]);
const CONV = () => identity("S1.P6.E5", "convergence", "e_* = \\min\\{e:A(e)>=A_{target}\\}", "Convergence time", ["convergence epoch", "target accuracy"]);

const U_ACC = () => unit("U9", "Classification Accuracy", "metric", "How is classification accuracy defined?", ["classification accuracy"]);
const U_LAT = () => unit("U10", "Decision Latency", "metric", "How fast does the network reach a decision?", ["decision latency"]);
const U_SPK = () => unit("U8", "Spike Count", "metric", "How is total spike count measured?", ["spike count"]);
const U_MOT = () => unit("U1", "Why Spiking Networks Exist", "motivation", "What problem motivates spiking networks?", ["event-driven computation"]);

// ---------------------------------------------------------------------------
// Requirement derivation (tests 1-5)
// ---------------------------------------------------------------------------

test("1. Decision Latency unit derives required family latency", () => {
  const requirement = deriveUnitFormulaRequirement(U_LAT());
  assert.deepEqual(requirement.requiredFamilies, ["latency"]);
  assert.ok(requirement.acceptedRelatedFamilies.includes("spike_timing"));
  assert.ok(requirement.forbiddenFamilies.includes("accuracy"));
  assert.equal(requirement.strength, "required");
});

test("2. Classification Accuracy unit derives accuracy", () => {
  const requirement = deriveUnitFormulaRequirement(U_ACC());
  assert.deepEqual(requirement.requiredFamilies, ["accuracy"]);
  assert.ok(requirement.forbiddenFamilies.includes("latency"));
});

test("3. Spike Count unit derives spike_count (count) family", () => {
  const requirement = deriveUnitFormulaRequirement(U_SPK());
  assert.deepEqual(requirement.requiredFamilies, ["count"]);
});

test("4. Unit without formula need derives not_needed", () => {
  const requirement = deriveUnitFormulaRequirement(U_MOT());
  assert.equal(requirement.strength, "not_needed");
  assert.deepEqual(requirement.requiredFamilies, []);
});

test("5. Requirement is not inferred from an existing (wrong) assigned formula", () => {
  // U10 is a latency unit but was wrongly given the accuracy formula E6.
  const wrong = unit("U10", "Decision Latency", "metric", "How fast does the network reach a decision?", ["decision latency"], ["S1.P6.E6"]);
  const requirement = deriveUnitFormulaRequirement(wrong);
  // Derivation must ignore the assigned formula and stay latency.
  assert.deepEqual(requirement.requiredFamilies, ["latency"]);
  assert.ok(requirement.forbiddenFamilies.includes("accuracy"));
});

// ---------------------------------------------------------------------------
// Compatibility matrix (tests 6-10)
// ---------------------------------------------------------------------------

test("6. Accuracy formula × latency unit is hard rejected", () => {
  const row = scoreFormulaUnitCompatibility(ACC(), deriveUnitFormulaRequirement(U_LAT()), U_LAT());
  assert.equal(row.familyCompatible, false);
  assert.equal(row.totalScore, Number.NEGATIVE_INFINITY);
  assert.ok(row.hardRejectionReasons.length > 0);
});

test("7. Latency formula × latency unit is compatible", () => {
  const row = scoreFormulaUnitCompatibility(LAT(), deriveUnitFormulaRequirement(U_LAT()), U_LAT());
  assert.equal(row.familyCompatible, true);
  assert.ok(row.totalScore > 0);
  assert.deepEqual(row.hardRejectionReasons, []);
});

test("8. Keyword overlap cannot override a family mismatch", () => {
  // An accuracy formula whose title is stuffed with the latency unit's words.
  const disguised = identity("S1.P6.E6", "accuracy", "\\text{Accuracy} = N_c/N_t",
    "Decision latency fast response time reaction network decision", ["decision", "latency", "response"]);
  const row = scoreFormulaUnitCompatibility(disguised, deriveUnitFormulaRequirement(U_LAT()), U_LAT());
  assert.equal(row.totalScore, Number.NEGATIVE_INFINITY);
  assert.equal(row.familyCompatible, false);
});

test("9. Extraction-anchor number does not influence compatibility", () => {
  const asE6 = scoreFormulaUnitCompatibility(identity("S1.P6.E6", "latency", "T = t_d - t_0", "Decision latency"), deriveUnitFormulaRequirement(U_LAT()), U_LAT());
  const asE1 = scoreFormulaUnitCompatibility(identity("S1.P6.E1", "latency", "T = t_d - t_0", "Decision latency"), deriveUnitFormulaRequirement(U_LAT()), U_LAT());
  assert.equal(asE6.familyCompatible, asE1.familyCompatible);
  assert.equal(asE6.totalScore, asE1.totalScore);
});

test("10. Related family is accepted only when explicitly configured", () => {
  const timing = identity("S1.P6.E7", "spike_timing", "\\Delta t = t_{post} - t_{pre}", "Spike timing");
  const latRow = scoreFormulaUnitCompatibility(timing, deriveUnitFormulaRequirement(U_LAT()), U_LAT());
  // latency accepts spike_timing as related.
  assert.equal(latRow.familyCompatible, true);
  // accuracy does NOT accept spike_timing.
  const accRow = scoreFormulaUnitCompatibility(timing, deriveUnitFormulaRequirement(U_ACC()), U_ACC());
  assert.equal(accRow.familyCompatible, false);
});

// ---------------------------------------------------------------------------
// Global planning (tests 11-16)
// ---------------------------------------------------------------------------

test("11. Multiple formulas are assigned to their correct metric units", () => {
  const plan = buildFormulaAssignmentPlan([ACC(), LAT(), SPK()], [U_ACC(), U_LAT(), U_SPK()]);
  const assigned = plan.assignments.filter((a) => a.status === "assigned");
  const map = Object.fromEntries(assigned.map((a) => [a.formulaAnchorId, a.unitId]));
  assert.equal(map["S1.P6.E6"], "U9");
  assert.equal(map["S1.P6.E1"], "U10");
  assert.equal(map["S1.P6.E2"], "U8");
  assert.equal(plan.valid, true);
});

test("12. Greedy ordering cannot steal the only latency formula for another unit", () => {
  // U10 (latency) and a decoy unit whose title shares latency keywords but is
  // an accuracy unit. The single latency formula must land on U10.
  const decoy = unit("U11", "Latency-aware Accuracy Reporting", "metric", "How is accuracy reported quickly?", ["classification accuracy"]);
  const plan = buildFormulaAssignmentPlan([LAT()], [decoy, U_LAT()]);
  const latAssignment = plan.assignments.find((a) => a.formulaAnchorId === "S1.P6.E1" && a.status === "assigned");
  assert.equal(latAssignment.unitId, "U10");
});

test("13. Duplicate accuracy formula may remain unassigned", () => {
  const dup = identity("S1.P6.E9", "accuracy", "\\text{Accuracy} = N_{correct}/N_{total}", "Accuracy again", ["accuracy"]);
  const plan = buildFormulaAssignmentPlan([ACC(), dup], [U_ACC()]);
  const assignedIds = plan.assignments.filter((a) => a.status === "assigned").map((a) => a.formulaAnchorId);
  assert.equal(assignedIds.length, 1);
  const leftover = plan.assignments.find((a) => a.status === "unassigned_with_reason" && a.formulaAnchorId === "S1.P6.E9");
  assert.ok(leftover);
  assert.match(leftover.reason, /duplicate/i);
});

test("14. Formula with no compatible unit receives an omission reason", () => {
  // Energy formula but only latency + accuracy units present.
  const plan = buildFormulaAssignmentPlan([ENE()], [U_LAT(), U_ACC()]);
  const omission = plan.formulasWithoutCompatibleUnits.find((f) => f.formulaAnchorId === "S1.P6.E3");
  assert.ok(omission);
  assert.ok(omission.reason.length > 0);
  const assignment = plan.assignments.find((a) => a.formulaAnchorId === "S1.P6.E3");
  assert.equal(assignment.status, "unassigned_with_reason");
});

test("15. Unit with no compatible formula remains explicitly source-formula-free", () => {
  // U10 latency unit, but only an accuracy formula exists.
  const plan = buildFormulaAssignmentPlan([ACC()], [U_LAT(), U_ACC()]);
  const u10Assigned = plan.assignments.filter((a) => a.unitId === "U10" && a.status === "assigned");
  assert.equal(u10Assigned.length, 0);
  const missing = plan.unitsMissingRequiredFormulas.find((m) => m.unitId === "U10");
  assert.ok(missing);
  assert.match(missing.reason, /no verified latency formula/i);
});

test("16. Conflicting assignment proposals fail plan validation", () => {
  const plan = buildFormulaAssignmentPlan([ACC()], [U_ACC()]);
  // Manually inject a second primary assignment for the same anchor.
  const bogus = {
    ...plan,
    assignments: [
      ...plan.assignments,
      {
        formulaAnchorId: "S1.P6.E6",
        unitId: "U-other",
        status: "assigned",
        compatibility: plan.assignments.find((a) => a.formulaAnchorId === "S1.P6.E6").compatibility,
        reason: "injected conflict",
      },
    ],
  };
  const validation = validateFormulaAssignmentPlan(bogus);
  assert.equal(validation.valid, false);
  assert.ok(validation.problems.some((p) => /conflicting proposals/i.test(p)));
});

// ---------------------------------------------------------------------------
// U10 regression
// ---------------------------------------------------------------------------

test("U10 regression: E6/accuracy rejected for U10/latency, latency formula selected if available", () => {
  const staleU10 = unit("U10", "Decision Latency", "metric", "How fast does the network reach a decision?", ["decision latency"], ["S1.P6.E6"]);
  const plan = buildFormulaAssignmentPlan([ACC(), LAT()], [staleU10, U_ACC()], {
    previousAssignments: [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }],
  });
  // Rejection is explicit.
  const rejection = plan.rejectedAssignments.find((r) => r.formulaAnchorId === "S1.P6.E6" && r.unitId === "U10");
  assert.ok(rejection);
  assert.match(rejection.reason, /accuracy/);
  // Latency formula lands on U10 instead.
  const u10 = plan.assignments.find((a) => a.unitId === "U10" && a.status === "assigned");
  assert.equal(u10.formulaAnchorId, "S1.P6.E1");
  // E6 goes to the accuracy unit.
  const e6 = plan.assignments.find((a) => a.formulaAnchorId === "S1.P6.E6" && a.status === "assigned");
  assert.equal(e6.unitId, "U9");
});

test("U10 regression: with no latency formula, U10 remains source-formula-free (no wrong-family anchor)", () => {
  const staleU10 = unit("U10", "Decision Latency", "metric", "How fast does the network reach a decision?", ["decision latency"], ["S1.P6.E6"]);
  const plan = buildFormulaAssignmentPlan([ACC()], [staleU10, U_ACC()], {
    previousAssignments: [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }],
  });
  const u10Assigned = plan.assignments.filter((a) => a.unitId === "U10" && a.status === "assigned");
  assert.equal(u10Assigned.length, 0);
  // Apply and confirm no wrong-family anchor reaches the unit.
  const { units, result } = applyFormulaAssignmentPlanToUnits({ units: [staleU10, U_ACC()], plan, formulas: [ACC()] });
  assert.equal(result.applied, true);
  const appliedU10 = units.find((u) => u.id === "U10");
  assert.deepEqual(appliedU10.sourceFormulas.map((f) => f.id), []);
  assert.equal(appliedU10.sourceAnchors.includes("S1.P6.E6"), false);
  assert.equal(result.blockersAfter, 0);
});

// ---------------------------------------------------------------------------
// ChatMock (tests 17-21)
// ---------------------------------------------------------------------------

function ambiguousSetup() {
  // Two near-identical compatible latency formulas for one latency unit.
  const latA = identity("S1.P6.E1", "latency", "T = t_{decision} - t_{onset}", "Decision latency", ["decision time", "stimulus onset"]);
  const latB = identity("S1.P6.E4", "latency", "T = t_{decision} - t_{onset}\\;(alt)", "Response latency", ["decision time", "stimulus onset"]);
  const acc = ACC();
  const units = [U_LAT()];
  const plan = buildFormulaAssignmentPlan([latA, latB, acc], units, { ambiguityMargin: 0.2 });
  return { latA, latB, acc, units, plan };
}

test("17. ChatMock sees only compatible candidates", () => {
  const { latA, latB, acc, units } = ambiguousSetup();
  const packet = buildFormulaAssignmentRepairPacket({
    unit: units[0],
    requirement: deriveUnitFormulaRequirement(units[0]),
    formulas: [latA, latB, acc],
  });
  const candidateIds = packet.candidates.map((c) => c.anchorId);
  assert.ok(candidateIds.includes("S1.P6.E1"));
  assert.ok(candidateIds.includes("S1.P6.E4"));
  assert.equal(candidateIds.includes("S1.P6.E6"), false); // accuracy excluded
});

test("18. Incompatible candidates appear only under rejectedCandidates", () => {
  const { latA, latB, acc, units } = ambiguousSetup();
  const packet = buildFormulaAssignmentRepairPacket({
    unit: units[0],
    requirement: deriveUnitFormulaRequirement(units[0]),
    formulas: [latA, latB, acc],
  });
  assert.ok(packet.rejectedCandidates.some((c) => c.anchorId === "S1.P6.E6"));
  assert.match(packet.rejectedCandidates.find((c) => c.anchorId === "S1.P6.E6").rejectionReason, /accuracy/);
});

test("19. ChatMock cannot select S1.P6.E6 (accuracy) for U10", () => {
  const { latA, latB, acc, units } = ambiguousSetup();
  const requirement = deriveUnitFormulaRequirement(units[0]);
  const packet = buildFormulaAssignmentRepairPacket({ unit: units[0], requirement, formulas: [latA, latB, acc] });
  const verdict = verifyFormulaAssignmentRepairDecision(
    packet,
    { action: "select_candidate", anchorId: "S1.P6.E6", justification: "looks fine", confidence: "high" },
    { unit: units[0], requirement, formulas: [latA, latB, acc] },
  );
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /rejected|not in the packet/i);
});

test("20. Invented candidate is rejected", () => {
  const { latA, latB, acc, units } = ambiguousSetup();
  const requirement = deriveUnitFormulaRequirement(units[0]);
  const packet = buildFormulaAssignmentRepairPacket({ unit: units[0], requirement, formulas: [latA, latB, acc] });
  const verdict = verifyFormulaAssignmentRepairDecision(
    packet,
    { action: "select_candidate", anchorId: "S9.P9.E9", justification: "invented", confidence: "high" },
    { unit: units[0], requirement, formulas: [latA, latB, acc] },
  );
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /not in the packet|invented/i);
});

test("21. no_compatible_formula is allowed and independently verified", async () => {
  const { latA, latB, acc, units, plan } = ambiguousSetup();
  const resolution = await resolveFormulaAssignmentAmbiguities({
    plan,
    formulas: [latA, latB, acc],
    units,
    repairModel: async () => ({ action: "no_compatible_formula", justification: "both are redundant", confidence: "high" }),
  });
  const u10Assigned = resolution.plan.assignments.filter((a) => a.unitId === "U10" && a.status === "assigned");
  assert.equal(u10Assigned.length, 0);
  assert.equal(resolution.decisionsApplied, 0);
  assert.equal(resolution.plan.assignments.some((a) => a.status === "ambiguous"), false);
});

test("21b. a verified select_candidate resolves the ambiguity to that anchor", async () => {
  const { latA, latB, acc, units, plan } = ambiguousSetup();
  const resolution = await resolveFormulaAssignmentAmbiguities({
    plan,
    formulas: [latA, latB, acc],
    units,
    repairModel: async () => ({ action: "select_candidate", anchorId: "S1.P6.E4", justification: "clearer form", confidence: "high" }),
  });
  const assigned = resolution.plan.assignments.find((a) => a.unitId === "U10" && a.status === "assigned");
  assert.equal(assigned.formulaAnchorId, "S1.P6.E4");
  assert.equal(resolution.decisionsApplied, 1);
});

// ---------------------------------------------------------------------------
// Atomic application (tests 22-26)
// ---------------------------------------------------------------------------

test("22. Contract units update together (add + remove) atomically", () => {
  const staleU10 = unit("U10", "Decision Latency", "metric", "How fast does the network reach a decision?", ["decision latency"], ["S1.P6.E6"]);
  const plan = buildFormulaAssignmentPlan([ACC(), LAT()], [staleU10, U_ACC()], {
    previousAssignments: [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }],
  });
  const { units, result } = applyFormulaAssignmentPlanToUnits({ units: [staleU10, U_ACC()], plan, formulas: [ACC(), LAT()] });
  assert.equal(result.applied, true);
  assert.ok(result.assignmentsAdded.some((a) => a.formulaAnchorId === "S1.P6.E1" && a.unitId === "U10"));
  assert.ok(result.assignmentsRemoved.some((a) => a.formulaAnchorId === "S1.P6.E6" && a.unitId === "U10"));
  assert.deepEqual(units.find((u) => u.id === "U10").sourceFormulas.map((f) => f.id), ["S1.P6.E1"]);
  assert.deepEqual(units.find((u) => u.id === "U9").sourceFormulas.map((f) => f.id), ["S1.P6.E6"]);
});

test("23. Provenance is derived from the final plan (rejected/reassigned/verified)", () => {
  const staleU10 = unit("U10", "Decision Latency", "metric", "q", ["decision latency"], ["S1.P6.E6"]);
  const plan = buildFormulaAssignmentPlan([ACC(), LAT()], [staleU10, U_ACC()], {
    previousAssignments: [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }],
  });
  const provenance = formulaAssignmentProvenanceFromPlan(plan, [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }]);
  assert.ok(provenance.some((p) => p.formulaAnchorId === "S1.P6.E6" && p.unitId === "U10" && p.status === "removed_incompatible"));
  assert.ok(provenance.some((p) => p.formulaAnchorId === "S1.P6.E6" && p.unitId === "U9" && p.status === "reassigned"));
});

test("24. Failed (invalid) plan causes no partial writes / rollback", () => {
  const u = U_LAT();
  const invalidPlan = {
    assignments: [{
      formulaAnchorId: "S1.P6.E6",
      unitId: "U10",
      status: "assigned",
      compatibility: scoreFormulaUnitCompatibility(ACC(), deriveUnitFormulaRequirement(u), u),
      reason: "forced wrong-family",
    }],
    formulasWithoutCompatibleUnits: [],
    unitsMissingRequiredFormulas: [],
    ambiguousAssignments: [],
    rejectedAssignments: [],
    reuse: [],
    valid: false,
    problems: ["forced"],
  };
  const { units, result } = applyFormulaAssignmentPlanToUnits({ units: [u], plan: invalidPlan, formulas: [ACC()] });
  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(units[0].sourceFormulas, []); // unchanged
});

test("25. Stale old assignment is removed on application", () => {
  const staleU10 = unit("U10", "Decision Latency", "metric", "q", ["decision latency"], ["S1.P6.E6"]);
  const plan = buildFormulaAssignmentPlan([ACC()], [staleU10, U_ACC()], {
    previousAssignments: [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }],
  });
  const { units } = applyFormulaAssignmentPlanToUnits({ units: [staleU10, U_ACC()], plan, formulas: [ACC()] });
  assert.equal(units.find((u) => u.id === "U10").sourceFormulas.length, 0);
});

test("26. Reconciliation (re-apply) is idempotent", () => {
  const staleU10 = unit("U10", "Decision Latency", "metric", "q", ["decision latency"], ["S1.P6.E6"]);
  const first = (() => {
    const plan = buildFormulaAssignmentPlan([ACC(), LAT()], [staleU10, U_ACC()], {
      previousAssignments: [{ formulaAnchorId: "S1.P6.E6", unitId: "U10" }],
    });
    return applyFormulaAssignmentPlanToUnits({ units: [staleU10, U_ACC()], plan, formulas: [ACC(), LAT()] }).units;
  })();
  const previous = first.flatMap((u) => u.sourceFormulas.map((f) => ({ formulaAnchorId: f.id, unitId: u.id })));
  const plan2 = buildFormulaAssignmentPlan([ACC(), LAT()], first, { previousAssignments: previous });
  const second = applyFormulaAssignmentPlanToUnits({ units: first, plan: plan2, formulas: [ACC(), LAT()] });
  assert.equal(second.result.assignmentsAdded.length, 0);
  assert.equal(second.result.assignmentsRemoved.length, 0);
  assert.deepEqual(
    second.units.map((u) => [u.id, u.sourceFormulas.map((f) => f.id)]),
    first.map((u) => [u.id, u.sourceFormulas.map((f) => f.id)]),
  );
});

// ---------------------------------------------------------------------------
// Cross-domain fixtures (tests 27-30) — planner is topic-agnostic
// ---------------------------------------------------------------------------

const PHYSICS_REGISTRY = [
  { canonicalFamily: "velocity", aliases: ["speed"], evidenceTerms: ["velocity", "speed", "motion rate", "meters per second"] },
  { canonicalFamily: "distance", aliases: [], evidenceTerms: ["distance", "displacement", "path length"] },
];

test("27. Speed formula assigns to the motion-rate unit, not the distance unit", () => {
  const speed = identity("P1.E1", "velocity", "v = \\frac{d}{t}", "Average velocity", ["velocity", "speed"]);
  const motionUnit = unit("M1", "Average Velocity of a Moving Body", "formula", "How is velocity computed from distance and time?", ["velocity"]);
  const distanceUnit = unit("M2", "Measuring Displacement", "formula", "How is displacement measured along a path?", ["distance", "displacement"]);
  const plan = buildFormulaAssignmentPlan([speed], [motionUnit, distanceUnit], { familyRegistry: PHYSICS_REGISTRY });
  const assigned = plan.assignments.find((a) => a.formulaAnchorId === "P1.E1" && a.status === "assigned");
  assert.equal(assigned.unitId, "M1");
});

test("28. Profit-margin formula assigns to the profitability unit", () => {
  const registry = [
    { canonicalFamily: "profit_margin", aliases: ["margin"], evidenceTerms: ["profit margin", "profitability", "net margin", "operating margin"] },
    { canonicalFamily: "revenue", aliases: [], evidenceTerms: ["revenue", "total sales", "top line"] },
  ];
  const margin = identity("E1.E1", "profit_margin", "m = \\frac{profit}{revenue}", "Net profit margin", ["profit margin", "profitability"]);
  const profitUnit = unit("B1", "Profitability and Net Margin", "formula", "How is the net profit margin computed?", ["profit margin", "profitability"]);
  const revenueUnit = unit("B2", "Revenue Recognition", "formula", "How is total revenue recognized?", ["revenue", "total sales"]);
  const plan = buildFormulaAssignmentPlan([margin], [profitUnit, revenueUnit], { familyRegistry: registry });
  const assigned = plan.assignments.find((a) => a.formulaAnchorId === "E1.E1" && a.status === "assigned");
  assert.equal(assigned.unitId, "B1");
});

test("29. Reaction-rate formula assigns to the kinetics unit", () => {
  const registry = [
    { canonicalFamily: "reaction_rate", aliases: ["rate_constant"], evidenceTerms: ["reaction rate", "rate constant", "kinetics", "rate law"] },
    { canonicalFamily: "equilibrium", aliases: [], evidenceTerms: ["equilibrium constant", "equilibrium", "reversible reaction"] },
  ];
  const rate = identity("C1.E1", "reaction_rate", "r = k[A][B]", "Rate law", ["reaction rate", "rate constant"]);
  const kineticsUnit = unit("K1", "Chemical Kinetics and the Rate Law", "formula", "How does the rate law relate concentration to reaction rate?", ["reaction rate", "kinetics"]);
  const equilibriumUnit = unit("K2", "Chemical Equilibrium", "formula", "How is the equilibrium constant defined?", ["equilibrium constant", "equilibrium"]);
  const plan = buildFormulaAssignmentPlan([rate], [kineticsUnit, equilibriumUnit], { familyRegistry: registry });
  const assigned = plan.assignments.find((a) => a.formulaAnchorId === "C1.E1" && a.status === "assigned");
  assert.equal(assigned.unitId, "K1");
});

test("30. Unknown/other formula remains unassigned rather than being forced", () => {
  const mystery = identity("X1.E1", "other", "\\Xi = \\aleph \\otimes \\beth", "Uncharacterized relation", [], { verified: false, evidence: {
    formulaText: "", title: "Uncharacterized relation", caption: "Uncharacterized relation", sourceContext: "",
    detectedVariables: [], detectedTerms: [], familyScores: {}, selectedFamily: "other", confidence: "unsupported",
    provenance: "legacy_inference", reason: "no evidence",
  } });
  const someUnit = unit("Z1", "Average Velocity", "formula", "How is velocity computed?", ["velocity"]);
  const plan = buildFormulaAssignmentPlan([mystery], [someUnit], { familyRegistry: PHYSICS_REGISTRY });
  const assigned = plan.assignments.filter((a) => a.status === "assigned");
  assert.equal(assigned.length, 0);
  assert.ok(plan.formulasWithoutCompatibleUnits.some((f) => f.formulaAnchorId === "X1.E1"));
});

// ---------------------------------------------------------------------------
// Extraction-id opacity (Part 13)
// ---------------------------------------------------------------------------

test("31. numeric anchor suffix never implies a metric/unit/family", () => {
  // E6 with a latency identity must behave exactly like any latency formula.
  const latAsE6 = identity("S1.P6.E6", "latency", "T = t_d - t_0", "Decision latency");
  const plan = buildFormulaAssignmentPlan([latAsE6], [U_LAT(), U_ACC()]);
  const assigned = plan.assignments.find((a) => a.formulaAnchorId === "S1.P6.E6" && a.status === "assigned");
  assert.equal(assigned.unitId, "U10");
});

// ---------------------------------------------------------------------------
// Guard (Part 11)
// ---------------------------------------------------------------------------

test("32. validateFormulaAssignment refuses an unverified identity", () => {
  const unverified = identity("S1.P6.E6", "accuracy", "\\text{Accuracy}", "Accuracy", [], { verified: false });
  const verdict = validateFormulaAssignment(unverified, deriveUnitFormulaRequirement(U_ACC()), U_ACC());
  assert.ok(verdict.hardRejectionReasons.some((r) => /not verified/i.test(r)));
});

test("33. justified reuse across two distinct-role units is provenance-tracked", () => {
  const accFormula = ACC();
  const metricAcc = unit("U9", "Classification Accuracy", "metric", "How is accuracy defined?", ["classification accuracy"], ["S1.P6.E6"]);
  const resultAcc = unit("U15", "Interpreting Accuracy Results", "result_interpretation", "What do the accuracy results show?", ["classification accuracy"], ["S1.P6.E6"]);
  const plan = buildFormulaAssignmentPlan([accFormula], [metricAcc, resultAcc], {
    previousAssignments: [
      { formulaAnchorId: "S1.P6.E6", unitId: "U9" },
      { formulaAnchorId: "S1.P6.E6", unitId: "U15" },
    ],
  });
  assert.ok(plan.reuse.some((r) => r.formulaAnchorId === "S1.P6.E6" && r.primaryUnitId === "U9" && r.reusedByUnitId === "U15"));
  assert.equal(plan.valid, true);
});

test("34. broad multi-metric U11 cannot steal E6 from the focused accuracy unit", () => {
  const broad = unit(
    "U11",
    "Evaluating SNNs with Multiple Metrics",
    "metric",
    "How should accuracy, latency, spike count, energy, and convergence be evaluated together?",
    ["classification accuracy", "decision latency", "total spike count", "energy per inference", "convergence time"],
  );
  const focused = [
    unit("U12", "Classification Accuracy", "formula", "How is classification accuracy defined?", ["classification accuracy"], ["S1.P6.E6"]),
    unit("U13", "Decision Latency", "result_interpretation", "How is decision latency interpreted?", ["decision latency"], ["S1.P6.E1"]),
    unit("U14", "Total Spike Count", "formula", "How is total spike count defined?", ["total spike count"], ["S1.P6.E2"]),
    unit("U15", "Energy per Inference", "result_interpretation", "How is inference energy interpreted?", ["energy per inference"], ["S1.P6.E3"]),
    unit("U16", "Normalized Energy Efficiency", "result_interpretation", "How is normalized efficiency interpreted?", ["normalized energy efficiency"], ["S1.P6.E4"]),
    unit("U17", "Convergence Time", "result_interpretation", "How is convergence time interpreted?", ["convergence time"], ["S1.P6.E5"]),
  ];
  const formulas = [ACC(), LAT(), SPK(), ENE(), EFF(), CONV()];
  const units = [broad, ...focused];
  const previousAssignments = focused.flatMap((entry) =>
    entry.sourceFormulas.map((formula) => ({ formulaAnchorId: formula.id, unitId: entry.id })));

  const broadRequirement = deriveUnitFormulaRequirement(broad);
  assert.equal(broadRequirement.strength, "helpful");
  assert.ok(broadRequirement.requiredFamilies.includes("accuracy"));
  assert.ok(broadRequirement.requiredFamilies.includes("latency"));

  const plan = buildFormulaAssignmentPlan(formulas, units, { previousAssignments });
  const active = plan.assignments.filter((assignment) =>
    assignment.status === "assigned" || assignment.status === "reused_with_reason");
  assert.equal(active.some((assignment) => assignment.unitId === "U11"), false);
  const primaryTargets = Object.fromEntries(
    active.filter((assignment) => assignment.status === "assigned")
      .map((assignment) => [assignment.formulaAnchorId, assignment.unitId]),
  );
  assert.equal(primaryTargets["S1.P6.E6"], "U12");
  assert.equal(primaryTargets["S1.P6.E1"], "U13");
  assert.equal(primaryTargets["S1.P6.E2"], "U14");
  assert.equal(primaryTargets["S1.P6.E4"], "U16");
  // Remaining helpful result families may be left unassigned/critic-bound in
  // this compact fixture, but the broad overview is never their primary home.
  assert.notEqual(primaryTargets["S1.P6.E3"], "U11");
  assert.notEqual(primaryTargets["S1.P6.E5"], "U11");

  const applied = applyFormulaAssignmentPlanToUnits({ units, plan, formulas });
  assert.equal(applied.result.applied, true, applied.result.reason);
  for (const appliedUnit of applied.units) {
    const requirement = deriveUnitFormulaRequirement(appliedUnit);
    for (const formula of appliedUnit.sourceFormulas) {
      const formulaIdentity = formulas.find((candidate) => candidate.anchorId === formula.id);
      assert.ok(formulaIdentity);
      assert.doesNotThrow(() => assertPlannedFormulaAssignment(formulaIdentity, requirement, appliedUnit));
    }
  }
});

test("35. an energy unit cannot receive another unit's count formula candidate", () => {
  const countFormula = SPK();
  const energyFormula = ENE();
  const sourceFigures = [
    {
      figureId: countFormula.anchorId,
      kind: "formula",
      caption: `${countFormula.title}: ${countFormula.canonicalText}`,
    },
    {
      figureId: energyFormula.anchorId,
      kind: "formula",
      caption: `${energyFormula.title}: ${energyFormula.canonicalText}`,
    },
  ];
  const contracts = [{
      id: energyFormula.anchorId,
      teachingGoal: "Define energy per inference",
      termsToDefine: ["energy cost", "spike energy", "synaptic energy"],
      placement: "inside_metric_definition",
  }];

  const candidates = formulaCandidatesForUnit(sourceFigures, contracts);
  assert.deepEqual(candidates.map((candidate) => candidate.figureId), [energyFormula.anchorId]);
  assert.equal(candidates.some((candidate) => candidate.figureId === countFormula.anchorId), false);
  assert.deepEqual(formulaCandidatesForUnit(sourceFigures, []), []);
});
