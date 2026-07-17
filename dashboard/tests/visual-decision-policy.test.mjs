import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  applyGardenZeroVisualSafeguard,
  assessInteractiveVisualFulfillment,
  buildVisualDecisionRecord,
  buildVisualNecessityReviewPacket,
  decideInteractiveVisualNecessity,
  deriveTeachingMediumPlan,
  planGardenVisualNecessity,
  planScopedVisualRepairs,
  resolveVisualNecessityReview,
  reviewAmbiguousVisualNecessityDecisions,
  unresolvedVisualDecisionRecord,
} from "../src/lib/visual-necessity.ts";
import {
  applyVisualizationRoutesToLearningUnits,
  buildVisualizationPlan,
} from "../src/lib/visualization-opportunities.ts";
import { visualTypeCompatibleWithUnit } from "../src/lib/learning-unit-contract.ts";
import { buildDeterministicVisual, buildVisualBlock, validateVisualSpec } from "../src/lib/visual-spec.ts";

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

function withPlan(candidate, decision, requirement) {
  return {
    ...candidate,
    interactiveVisualPlan: {
      decision,
      requirement,
      alternativeCoverage: requirement === "required" ? "uncovered" : "covered",
    },
    teachingMediumPlan: deriveTeachingMediumPlan(candidate, decision),
  };
}

const ACTIVE = new Set(["required", "recommended", "optional"]);

describe("visual decision policy — signal-driven selection", () => {
  test("1. Dynamic threshold behavior selects a visual", () => {
    const decision = decideInteractiveVisualNecessity(
      unit({
        role: "mechanism",
        title: "Threshold crossing and reset dynamics",
        learningQuestion:
          "How does the membrane voltage cross the firing threshold over time as the input current changes?",
        newConcepts: ["threshold crossing", "reset"],
      }),
      {},
    );
    assert.ok(ACTIVE.has(decision.necessity), `expected active, got ${decision.necessity}`);
    assert.equal(decision.preferredMedium, "interactive_visual");
  });

  test("2. Parameter-sensitive equation selects a visual", () => {
    const decision = decideInteractiveVisualNecessity(
      unit({
        role: "formula",
        title: "The leaky integrate-and-fire update equation",
        learningQuestion:
          "How does changing the time-constant parameter alter the voltage trajectory the equation produces?",
        newConcepts: ["time constant", "membrane decay"],
        sourceFormulas: [
          { id: "S1.P4.E1", teachingGoal: "relate parameters to voltage", termsToDefine: ["tau", "V"], placement: "before_example" },
        ],
      }),
      {},
    );
    assert.ok(ACTIVE.has(decision.necessity), `expected active, got ${decision.necessity}`);
    assert.ok(decision.parameterSensitivityValue >= 0.75);
  });

  test("3. Static definition rejects a visual", () => {
    const decision = decideInteractiveVisualNecessity(
      unit({
        role: "core_concept",
        title: "The definition of a biological neuron",
        learningQuestion: "What is the biological definition of a neuron?",
        newConcepts: ["neuron definition"],
      }),
      {},
    );
    assert.ok(!ACTIVE.has(decision.necessity), `expected inactive, got ${decision.necessity}`);
    assert.equal(buildVisualDecisionRecord(decision).decision, "not_useful");
  });

  test("4. Historical introduction rejects a visual", () => {
    const decision = decideInteractiveVisualNecessity(
      unit({
        role: "motivation",
        title: "A brief history of neuromorphic computing",
        learningQuestion: "Which historical milestones shaped the development of the field?",
        newConcepts: ["history"],
      }),
      {},
    );
    assert.ok(!ACTIVE.has(decision.necessity));
    assert.ok(["timeline", "prose"].includes(decision.preferredMedium));
  });

  test("5. A source graph that benefits from manipulation selects an interactive representation", () => {
    // The figure depicts dynamic behavior (an action-potential trace over time),
    // so it is only a partial substitute and must NOT veto interaction.
    const candidate = unit({
      role: "mechanism",
      title: "The action potential over time",
      learningQuestion:
        "How do sodium and potassium currents shape the action potential trajectory over time?",
      newConcepts: ["action potential"],
      sourceFigures: [
        {
          id: "S1.P2.F1",
          placement: "inside_concept_explanation",
          mustBeDiscussedWith: "the action-potential trace",
          interpretationGoal: "Read how the voltage evolves over time.",
        },
      ],
    });
    const decision = decideInteractiveVisualNecessity(candidate, {});
    assert.ok(ACTIVE.has(decision.necessity), `expected active, got ${decision.necessity}`);
    assert.equal(decision.preferredMedium, "interactive_visual");
    assert.ok(decision.sourceFigureSufficiency < 0.8, "a dynamic figure must not be a full substitute");
  });

  test("6. A nearby equivalent visual prevents duplication", () => {
    const codingUnit = (id) =>
      unit({
        id,
        role: "comparison",
        title: "Rate versus temporal coding",
        learningQuestion: "How do rate and temporal coding compare under the same stimulus?",
        newConcepts: ["neural coding"],
      });
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: [codingUnit("U1"), codingUnit("U2")] });
    const active = plan.decisions.filter((d) => ACTIVE.has(d.necessity));
    assert.equal(active.length, 1, "the same interaction must not be repeated on both subsections");
    const downgraded = plan.decisions.find((d) => !ACTIVE.has(d.necessity));
    assert.ok(downgraded.duplicationRisk >= 0.85);
  });
});

describe("visual decision policy — failures are unresolved, never silently not_useful", () => {
  const packet = buildVisualNecessityReviewPacket({
    unit: unit({ role: "comparison", title: "Encoding comparison", learningQuestion: "How do encodings compare?" }),
    deterministicDecision: decideInteractiveVisualNecessity(
      unit({ role: "comparison", title: "Encoding comparison", learningQuestion: "How do encodings compare?" }),
      {},
    ),
  });

  test("7. A failed model call produces unresolved, not not_useful", () => {
    const resolution = resolveVisualNecessityReview({ packet, error: new Error("ChatMock 502") });
    assert.equal(resolution.status, "unresolved");
    assert.equal(resolution.record.decision, "unresolved");
    assert.notEqual(resolution.record.decision, "not_useful");
    assert.equal(resolution.record.failure.stage, "necessity_review");
    assert.equal(resolution.record.failure.code, "model_call_failed");
  });

  test("8. Invalid structured output produces unresolved", () => {
    const resolution = resolveVisualNecessityReview({
      packet,
      response: { action: "downgrade_to_optional", visualType: "invented_renderer", reason: "maybe" },
    });
    assert.equal(resolution.status, "unresolved");
    assert.equal(resolution.record.decision, "unresolved");
    assert.equal(resolution.record.failure.stage, "structured_response");
    assert.match(resolution.record.failure.message, /not supported/);
  });

  test("8b. A throwing reviewer surfaces an unresolved record through the review loop", async () => {
    const ambiguous = unit({
      id: "A",
      role: "comparison",
      title: "Latency versus rate coding trade-off",
      learningQuestion: "How do latency and rate coding trade off under a fixed spike budget?",
      newConcepts: ["latency coding", "rate coding"],
      sourceTables: [{ id: "S1.P1.T1", teachingGoal: "compare encodings", rowsOrColumnsToExplain: ["latency", "rate"], placement: "after_intro" }],
    });
    const deterministic = planGardenVisualNecessity({ gardenId: "g", learningUnits: [ambiguous] });
    const result = await reviewAmbiguousVisualNecessityDecisions({
      units: deterministic.learningUnits,
      decisions: deterministic.decisions,
      reviewer: async () => {
        throw new Error("timeout");
      },
      maxReviews: 3,
    });
    // The candidate is retained as its deterministic decision (never silently
    // dropped), and the failure is surfaced as an explicit unresolved record.
    for (const record of result.unresolvedRecords) {
      assert.equal(record.decision, "unresolved");
      assert.notEqual(record.decision, "not_useful");
    }
  });
});

describe("visual decision policy — garden-level zero safeguard", () => {
  test("9. Garden-level all-zero review recovers at least one strong candidate when warranted", () => {
    const strongUnit = unit({
      id: "S",
      role: "mechanism",
      title: "Threshold dynamics over time",
      learningQuestion: "How does the voltage cross the threshold over time as the current changes?",
    });
    // Simulate an upstream stage that wrongly rejected a strong dynamic unit.
    const strongDecision = {
      ...decideInteractiveVisualNecessity(strongUnit, {}),
      necessity: "not_needed",
      preferredMedium: "prose",
      reason: "Prose was (wrongly) considered sufficient.",
    };
    const weakUnits = [1, 2, 3, 4, 5].map((i) =>
      unit({ id: `H${i}`, role: "motivation", title: `Historical note ${i}`, learningQuestion: "What happened historically?" }),
    );
    const weakDecisions = weakUnits.map((u) => decideInteractiveVisualNecessity(u, {}));
    const { decisions, safeguard } = applyGardenZeroVisualSafeguard({
      decisions: [strongDecision, ...weakDecisions],
      units: [strongUnit, ...weakUnits],
    });
    assert.equal(safeguard.status, "recovered");
    assert.equal(safeguard.recoveredUnitId, "S");
    assert.equal(decisions.filter((d) => ACTIVE.has(d.necessity)).length, 1);
  });

  test("10. A genuinely non-visual garden may still pass with zero", () => {
    const units = [1, 2, 3, 4, 5, 6].map((i) =>
      unit({
        id: `D${i}`,
        role: "motivation",
        title: `Definition and history ${i}`,
        learningQuestion: "What terminology was introduced and what does it mean?",
        newConcepts: [`term ${i}`],
      }),
    );
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: units });
    assert.equal(plan.decisions.filter((d) => ACTIVE.has(d.necessity)).length, 0);
    assert.equal(plan.zeroVisualSafeguard.status, "consistent_zero");
  });

  test("10b. An author force_none unit is never resurrected by the safeguard", () => {
    const units = [1, 2, 3, 4, 5, 6].map((i) =>
      unit({
        id: `M${i}`,
        role: "mechanism",
        title: `Threshold dynamics ${i}`,
        learningQuestion: "How does voltage cross the threshold over time as current changes?",
      }),
    );
    const forcedNoneDecision = {
      ...decideInteractiveVisualNecessity(units[0], {}),
      unitId: "M1",
      necessity: "not_needed",
      preferredMedium: "prose",
    };
    const rest = units.slice(1).map((u) => ({
      ...decideInteractiveVisualNecessity(u, {}),
      necessity: "not_needed",
      preferredMedium: "prose",
    }));
    const { decisions } = applyGardenZeroVisualSafeguard({
      decisions: [forcedNoneDecision, ...rest],
      units,
      protectedUnitIds: new Set(["M1"]),
    });
    const recovered = decisions.find((d) => ACTIVE.has(d.necessity));
    assert.notEqual(recovered?.unitId, "M1");
  });
});

describe("visual decision policy — dispatch, embedding, validation, repair", () => {
  const learningMapFor = (units) => ({
    gardenId: "g",
    sections: [{ title: "S1", subsections: units.map((u) => ({ title: u.title, learningUnitId: u.id })) }],
  });

  test("11. Selected visual contract reaches implementation dispatch", () => {
    const dyn = unit({
      id: "U1",
      role: "comparison",
      title: "Rate, latency, and delta encoding trade-offs",
      learningQuestion: "How do rate, latency, and delta encoding trade off under a fixed spike budget?",
      newConcepts: ["encoding trade-offs"],
    });
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
    assert.ok(ACTIVE.has(plan.decisions[0].necessity));
    const vplan = buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: plan.learningUnits });
    assert.ok(vplan.opportunities.length >= 1, "a candidate opportunity must be produced");
    const route = vplan.decisions[0];
    assert.ok(
      ["trusted_renderer", "generated_module"].includes(route.route),
      `expected dispatch, got ${route.route}`,
    );
  });

  test("12. Implemented visual remains embedded through finalization", () => {
    const dyn = unit({
      id: "U1",
      role: "comparison",
      title: "Rate, latency, and delta encoding trade-offs",
      learningQuestion: "How do rate, latency, and delta encoding trade off under a fixed spike budget?",
      newConcepts: ["encoding trade-offs"],
    });
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
    const vplan = buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: plan.learningUnits });
    const trusted = vplan.decisions.find((d) => d.route === "trusted_renderer");
    assert.ok(trusted, "the encoding trade-off unit must route to a deterministic trusted renderer");

    // Implementation + validation: the deterministic builder yields a real,
    // validated interactive spec (not placeholder markup).
    const spec = buildDeterministicVisual(trusted.selectedRenderer, { gardenId: "g", pageSlug: "learning/u1" });
    assert.ok(spec, "the trusted renderer must build a concrete visual spec");
    assert.equal(validateVisualSpec(spec).spec?.id, spec.id, "the built spec must revalidate");
    assert.ok((spec.controls?.length ?? 0) >= 1, "an interactive visual must expose at least one control");

    // Embedding + finalization survival: the fenced block carries the visual id,
    // and the fulfillment check treats the embedded visual as satisfying the
    // required contract (i.e. it is not silently removed at finalization).
    const block = buildVisualBlock(spec);
    assert.match(block, /breadboard-visual/);
    const requiredUnit = withPlan(dyn, { ...plan.decisions[0], necessity: "required" }, "required");
    const fulfillment = assessInteractiveVisualFulfillment({
      unit: requiredUnit,
      embeddedVisualTypes: [spec.type],
    });
    assert.equal(fulfillment.severity, "none");
  });

  test("13. Validator failure triggers repair rather than silent removal", () => {
    const requiredUnit = withPlan(unit(), { ...decideInteractiveVisualNecessity(unit(), {}), necessity: "required" }, "required");
    const repairs = planScopedVisualRepairs({
      learningUnits: [requiredUnit],
      issues: [{ unitId: requiredUnit.id, kind: "missing" }],
    });
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0].action, "generate_required_visual");
    // A validation failure is represented as unresolved, never as not_useful.
    const record = unresolvedVisualDecisionRecord({
      unitId: requiredUnit.id,
      failure: { stage: "validation", code: "invalid_definition", message: "definition failed schema validation" },
    });
    assert.equal(record.decision, "unresolved");
    assert.notEqual(record.decision, "not_useful");
  });

  test("14. Existing learning-unit contract compatibility rules remain valid", () => {
    const comparison = unit({
      id: "C",
      role: "comparison",
      title: "Energy and latency trade-offs",
      learningQuestion: "How do energy and latency trade off across deployment choices?",
      newConcepts: ["energy latency tradeoff"],
    });
    assert.equal(visualTypeCompatibleWithUnit("tradeoff_explorer", comparison).ok, true);
    const motivation = unit({ id: "M", role: "motivation", title: "Why SNNs matter", learningQuestion: "Why does this topic exist?" });
    assert.equal(visualTypeCompatibleWithUnit("lif_neuron", motivation).ok, false);
  });
});

describe("visual decision policy — routing produces a concrete interactive intent", () => {
  test("a comparison unit acquires an interactive intent after routing", () => {
    const dyn = unit({
      id: "U1",
      role: "comparison",
      title: "Rate, latency, and delta encoding trade-offs",
      learningQuestion: "How do rate, latency, and delta encoding trade off under a fixed spike budget?",
      newConcepts: ["encoding trade-offs"],
    });
    const plan = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
    const vplan = buildVisualizationPlan({
      gardenId: "g",
      learningMap: { gardenId: "g", sections: [{ title: "S1", subsections: [{ title: dyn.title, learningUnitId: "U1" }] }] },
      learningUnits: plan.learningUnits,
    });
    const routed = applyVisualizationRoutesToLearningUnits(plan.learningUnits, vplan);
    const withIntent = routed.filter((u) => u.interactiveVisual);
    assert.ok(withIntent.length >= 1, "at least one unit must carry a concrete interactive intent");
    assert.ok(withIntent[0].interactiveVisual.visualType);
  });
});
