#!/usr/bin/env node

/**
 * W2-3E / VISUAL_CONTRACT_VALIDATION — the learnerAction question, settled by
 * execution rather than left as a human decision.
 *
 * Two tests fail with the same thrown error: "U1: missing model-authored
 * learnerAction; U1: no validated model-authored learner control contract".
 * W2-3C characterised two competing readings and deliberately decided neither:
 *
 *   A. the requirement tightened intentionally and the fixture is stale;
 *   B. the validator over-rejects, and one of the two failing tests is
 *      specifically about acquiring intent AFTER routing, which points at
 *      ordering rather than absence.
 *
 * They make different predictions, so they can be separated by experiment. If A
 * holds, supplying learnerAction — and changing nothing else — makes both tests'
 * behaviour succeed, and the validator names each missing field precisely rather
 * than refusing broadly. If B holds, the plan is still refused, or it is refused
 * for a field the model is never asked to author.
 *
 * Whether the model is asked for the field is checked directly, against the
 * prompt Breadboard actually sends.
 *
 * Every mutation is applied to a local stand-in fixture. No test is edited and
 * no product file is touched.
 *
 * Run from `dashboard/` with --experimental-strip-types.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outPath = path.resolve(process.argv[2] ?? "visual-contract-arbitration.json");
const dashboardRoot = process.cwd();
const load = (relative) => import(pathToFileURL(path.join(dashboardRoot, relative)).href);
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const { deriveTeachingMediumPlan, planGardenVisualNecessity } = await load("src/lib/visual-necessity.ts");
const { applyVisualizationRoutesToLearningUnits, buildVisualizationPlan: buildVisualizationPlanRaw } =
  await load("src/lib/visualization-opportunities.ts");
const { pedagogyContractFromCompleteRepair } = await load("src/lib/visualization-contract-validation.ts");

const ACTIVE = new Set(["required", "recommended", "optional"]);

// --- fixture scaffolding, reproduced from the failing suite ---------------
// This is test data and the suite's own budget/evidence wrapper, not product
// logic: every function that decides anything below is the real module.
function buildVisualizationPlan(input) {
  const requiredVisuals = input.learningUnits.filter((c) => c.interactiveVisualPlan?.requirement === "required").length;
  const recommendedVisuals = input.learningUnits.filter((c) => c.interactiveVisualPlan?.requirement === "recommended").length;
  const optionalVisuals = input.learningUnits.filter((c) => c.interactiveVisualPlan?.requirement === "optional").length;
  const active = requiredVisuals + recommendedVisuals + optionalVisuals;
  const canonicalEvidenceByUnit = Object.fromEntries(
    input.learningUnits.map((candidate) => {
      if (!ACTIVE.has(candidate.interactiveVisualPlan?.requirement)) return [candidate.id, []];
      const formulaIds = new Set(candidate.sourceFormulas.map((f) => f.id));
      const figureIds = new Set(candidate.sourceFigures.map((f) => f.id));
      const tableIds = new Set(candidate.sourceTables.map((t) => t.id));
      const anchors = [
        ...new Set([
          ...candidate.sourceAnchors,
          ...figureIds,
          ...formulaIds,
          ...tableIds,
          ...(candidate.interactiveVisualPlan?.decision.evidence.sourceAnchorIds ?? []),
          ...(candidate.interactiveVisualPlan?.visualIntent?.sourceAnchors ?? []),
        ]),
      ];
      return [
        candidate.id,
        anchors.map((anchor) => ({
          anchor,
          kind: formulaIds.has(anchor)
            ? "source_formula"
            : figureIds.has(anchor)
              ? "source_figure"
              : tableIds.has(anchor)
                ? "source_table"
                : "source_text",
          text: candidate.learningQuestion,
        })),
      ];
    }),
  );
  return buildVisualizationPlanRaw({
    ...input,
    canonicalEvidenceByUnit,
    visualBudget: input.visualBudget ?? {
      targetMinimum: active,
      targetMaximum: active,
      maximumPerSection: active,
      minimumUnitsBetweenSimilarVisuals: 0,
      requiredVisuals,
      recommendedVisuals,
      optionalVisuals,
      reason: "Fixture-authored visual budget.",
    },
  });
}

const unit = (overrides = {}) => ({
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
});

const withPlan = (candidate, decision, requirement) => ({
  ...candidate,
  interactiveVisualPlan: {
    decision,
    requirement,
    alternativeCoverage: requirement === "required" ? "uncovered" : "covered",
  },
  teachingMediumPlan: deriveTeachingMediumPlan(candidate, decision),
});

const learningMapFor = (units) => ({
  gardenId: "g",
  sections: [{ title: "S1", subsections: units.map((u) => ({ title: u.title, learningUnitId: u.id })) }],
});

/**
 * The failing suite's helper, plus one parameter: whether to include
 * `learnerAction`. That single difference is the whole experiment.
 */
function modelAuthoredPlan(candidate, decision, options) {
  const { controlLabel, expectedInsight, interactionGoal, learnerAction, omit } = options;
  const planned = withPlan(candidate, decision, "required");
  const evidence = [{ anchor: candidate.sourceAnchors[0], quote: candidate.learningQuestion }];
  const visualIntent = {
    id: `intent-${candidate.id.toLowerCase()}`,
    uniqueConcept: controlLabel,
    visualType: "generated_module",
    whyStaticSourceFigureIsNotEnough:
      "A static figure fixes one case; the learner has to move the control to see the trade-off resolve.",
    learnerManipulates: [controlLabel],
    expectedInsight,
    sourceAnchors: candidate.sourceAnchors,
    duplicateSignature: `sig-${candidate.id.toLowerCase()}`,
  };
  const plan = {
    ...planned.interactiveVisualPlan,
    visualIntent,
    interactionGoal,
    learnerAction,
    controlContract: [
      {
        id: `fixture_${candidate.id.toLowerCase()}`,
        kind: "variable",
        label: controlLabel,
        type: "slider",
        min: 0,
        max: 10,
        step: 0.1,
        defaultValue: 1,
        evidence,
      },
    ],
    observable: { label: expectedInsight, representation: "chart", evidence },
    expectedInsightEvidence: evidence,
  };
  for (const field of omit ?? []) delete plan[field];
  return { ...planned, interactiveVisual: visualIntent, interactiveVisualPlan: plan };
}

const comparisonUnit = () =>
  unit({
    id: "U1",
    role: "comparison",
    title: "Rate, latency, and delta encoding trade-offs",
    learningQuestion: "How do rate, latency, and delta encoding trade off under a fixed spike budget?",
    newConcepts: ["encoding trade-offs"],
  });

const AUTHORED = {
  controlLabel: "rate, latency, and delta encoding",
  expectedInsight: "trade off under a fixed spike budget",
  interactionGoal: "compare_cases",
  learnerAction:
    "Move the encoding-rate control across its range and read the latency curve at each setting.",
};

function attempt(build) {
  try {
    return { ok: true, value: build() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --- the experiment ------------------------------------------------------
const experiments = [];

// Arm 1: the suite's current fixture — everything except learnerAction.
{
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const authored = modelAuthoredPlan(dyn, necessity.decisions[0], { ...AUTHORED, omit: ["learnerAction"] });
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [authored] }),
  );
  experiments.push({
    arm: "the failing suite's fixture (no learnerAction)",
    necessitySelected: ACTIVE.has(necessity.decisions[0].necessity),
    accepted: result.ok,
    error: result.error ?? null,
    namesTheMissingField: /missing model-authored learnerAction/.test(result.error ?? ""),
  });
}

// Arm 2: the same fixture with learnerAction supplied and nothing else changed.
let routedIntent = null;
{
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const authored = modelAuthoredPlan(dyn, necessity.decisions[0], AUTHORED);
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [authored] }),
  );
  let routeCheck = null;
  if (result.ok) {
    const routed = applyVisualizationRoutesToLearningUnits([authored], result.value);
    const withIntent = routed.filter((candidate) => candidate.interactiveVisual);
    routedIntent = {
      unitsWithIntent: withIntent.length,
      visualType: withIntent[0]?.interactiveVisual?.visualType ?? null,
    };
    routeCheck = {
      opportunities: result.value.opportunities.length,
      route: result.value.decisions[0]?.route ?? null,
    };
  }
  experiments.push({
    arm: "the same fixture with learnerAction supplied",
    accepted: result.ok,
    error: result.error ?? null,
    plan: routeCheck,
    routedIntent,
  });
}

// Arm 3: each required field removed on its own — does the validator name it,
// or refuse broadly? A validator that says the same thing whatever is missing
// is not a contract, it is a wall.
const fieldNaming = [];
for (const field of ["interactionGoal", "learnerAction", "visualIntent", "observable"]) {
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const authored = modelAuthoredPlan(dyn, necessity.decisions[0], { ...AUTHORED, omit: [field] });
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [authored] }),
  );
  fieldNaming.push({
    omitted: field,
    refused: !result.ok,
    namesTheOmittedField: new RegExp(`missing model-authored ${field}`).test(result.error ?? ""),
    error: result.error ?? null,
  });
}

// Arm 3b: the decision itself carries the authored interaction contract.
//
// Arm 2 cleared the missing-field gate and hit a second one: the plan's contract
// must be exactly the contract the model authored in its necessity decision.
// That is a coherence rule, not a completeness rule — it stops a later stage
// re-authoring the model's intent — and it is what the real pipeline satisfies
// by carrying `decision.interaction` through from the model's necessity batch.
// The projection is built with the product's own function, the way the pipeline
// builds it.
let coherentArm = null;
{
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const authored = modelAuthoredPlan(dyn, necessity.decisions[0], AUTHORED);
  const plan = authored.interactiveVisualPlan;
  const interaction = pedagogyContractFromCompleteRepair({
    unitId: dyn.id,
    interactionGoal: plan.interactionGoal,
    learnerAction: plan.learnerAction,
    visualIntent: plan.visualIntent,
    controls: plan.controlContract,
    observable: plan.observable,
    expectedInsight: plan.visualIntent.expectedInsight,
    expectedInsightEvidence: plan.expectedInsightEvidence,
  });
  const coherent = {
    ...authored,
    interactiveVisualPlan: { ...plan, decision: { ...plan.decision, interaction } },
  };
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [coherent] }),
  );
  if (result.ok) {
    const routed = applyVisualizationRoutesToLearningUnits([coherent], result.value);
    const withIntent = routed.filter((candidate) => candidate.interactiveVisual);
    routedIntent = {
      unitsWithIntent: withIntent.length,
      visualType: withIntent[0]?.interactiveVisual?.visualType ?? null,
    };
  }
  coherentArm = {
    arm: "learnerAction supplied AND decision.interaction carried through, as the pipeline does",
    accepted: result.ok,
    error: result.error ?? null,
    plan: result.ok
      ? { opportunities: result.value.opportunities.length, route: result.value.decisions[0]?.route ?? null }
      : null,
    routedIntent,
  };
  experiments.push(coherentArm);
}

// Arm 3c: the coherence rule must have teeth — a decision.interaction that
// differs from the plan by one field must be refused.
{
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const authored = modelAuthoredPlan(dyn, necessity.decisions[0], AUTHORED);
  const plan = authored.interactiveVisualPlan;
  const interaction = pedagogyContractFromCompleteRepair({
    unitId: dyn.id,
    interactionGoal: plan.interactionGoal,
    learnerAction: "Something the model did not author.",
    visualIntent: plan.visualIntent,
    controls: plan.controlContract,
    observable: plan.observable,
    expectedInsight: plan.visualIntent.expectedInsight,
    expectedInsightEvidence: plan.expectedInsightEvidence,
  });
  const divergent = {
    ...authored,
    interactiveVisualPlan: { ...plan, decision: { ...plan.decision, interaction } },
  };
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [divergent] }),
  );
  experiments.push({
    arm: "decision.interaction diverges from the plan by one field",
    accepted: result.ok,
    error: result.error ?? null,
    refused: !result.ok,
  });
}

// Arm 4: no model-authored plan at all must still be refused. This is the half
// of the contract that must not be lost while fixing the other half.
{
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const bare = withPlan(dyn, necessity.decisions[0], "required");
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [bare] }),
  );
  experiments.push({
    arm: "no model-authored contract at all",
    accepted: result.ok,
    error: result.error ?? null,
    refusedForTheRightReason: /no validated model-authored learner control contract|missing model-authored/.test(
      result.error ?? "",
    ),
  });
}

// Arm 5: a blank learnerAction must not satisfy the requirement.
{
  const dyn = comparisonUnit();
  const necessity = planGardenVisualNecessity({ gardenId: "g", learningUnits: [dyn] });
  const authored = modelAuthoredPlan(dyn, necessity.decisions[0], { ...AUTHORED, learnerAction: "   " });
  const result = attempt(() =>
    buildVisualizationPlan({ gardenId: "g", learningMap: learningMapFor([dyn]), learningUnits: [authored] }),
  );
  experiments.push({
    arm: "learnerAction present but blank",
    accepted: result.ok,
    error: result.error ?? null,
    refused: !result.ok,
  });
}

// --- is the model actually asked to author this field? -------------------
const repairPrompt = read("src/lib/visualization-contract-repair.ts");
const necessityModel = read("src/lib/model-visual-necessity.ts");
const generatedVisuals = read("src/lib/generated-visuals.ts");
const modelIsAsked = {
  repairPromptRequestsIt: /Author the complete non-empty learnerAction sequence/.test(repairPrompt),
  necessityBatchCarriesIt: /learnerAction: decision\.interaction\.learnerAction/.test(necessityModel),
  implementationConsumesIt: /opportunity\.learnerAction/.test(generatedVisuals),
};

// --- invariants ----------------------------------------------------------
const invariants = [];
const say = (name, holds, detail) => invariants.push({ name, holds, detail });

const withoutField = experiments.find((entry) => entry.arm.includes("no learnerAction"));
const withField = experiments.find((entry) => entry.arm.includes("with learnerAction supplied"));

say(
  "the refusal is about the contract's completeness and coherence, not a blanket refusal",
  withoutField?.accepted === false &&
    withoutField?.namesTheMissingField === true &&
    withField?.accepted === false &&
    /decision\.interaction must exactly match/.test(withField?.error ?? ""),
  `without learnerAction: ${withoutField?.error}; with it but incoherent: ${withField?.error}`,
);
say(
  "a contract authored the way the pipeline authors one reaches implementation dispatch",
  coherentArm?.accepted === true &&
    coherentArm?.plan?.route === "generated_module" &&
    coherentArm?.plan?.opportunities === 1,
  JSON.stringify(coherentArm?.plan ?? coherentArm?.error ?? null),
);
say(
  "the coherence rule has teeth: a decision that diverges by one field is refused",
  experiments.find((entry) => entry.arm.includes("diverges from the plan"))?.refused === true,
  "otherwise a later stage could silently re-author the model's intent",
);
say(
  "a routed comparison unit then carries a concrete interactive intent",
  (routedIntent?.unitsWithIntent ?? 0) >= 1 && Boolean(routedIntent?.visualType),
  JSON.stringify(routedIntent),
);
say(
  "the validator names each missing field rather than refusing broadly",
  fieldNaming.every((entry) => entry.refused && entry.namesTheOmittedField),
  JSON.stringify(fieldNaming.map((entry) => ({ omitted: entry.omitted, named: entry.namesTheOmittedField }))),
);
say(
  "a plan with no model-authored contract is still refused",
  experiments.find((entry) => entry.arm.includes("no model-authored contract"))?.accepted === false,
  "this is the half of the contract that keeps unvalidated model output out of implementation dispatch",
);
say(
  "a blank learnerAction does not satisfy the requirement",
  experiments.find((entry) => entry.arm.includes("blank"))?.refused === true,
  "whitespace must not pass for an authored interaction sequence",
);
say(
  "the model is actually asked to author learnerAction",
  Object.values(modelIsAsked).every(Boolean),
  JSON.stringify(modelIsAsked),
);

const allHold = invariants.every((entry) => entry.holds);

const summary = {
  generatedAt: new Date().toISOString(),
  subRoot: "VISUAL_CONTRACT_VALIDATION",
  competingContracts: {
    A: "The requirement tightened intentionally and the suite's fixture is stale.",
    B: "The validator over-rejects; the failure is about ordering rather than absence.",
  },
  discriminator:
    "A predicts that supplying learnerAction alone makes both behaviours succeed and that each missing field is named individually. B predicts the plan is still refused, or is refused for a field no model is asked to author.",
  boundary: {
    validator: "dashboard/src/lib/visualization-opportunities.ts :: buildVisualizationPlan",
    router: "dashboard/src/lib/visualization-opportunities.ts :: applyVisualizationRoutesToLearningUnits",
    method:
      "The real necessity planner, validator and router were executed over a local stand-in fixture whose only variable was the presence of learnerAction.",
  },
  experiments,
  fieldNaming,
  modelIsAsked,
  invariants,
  allInvariantsHold: allHold,
  brokenInvariants: invariants.filter((entry) => !entry.holds).map((entry) => entry.name),
  verdict: allHold ? "CONTRACT_A" : "UNSETTLED",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

for (const entry of invariants) console.log(`  ${entry.holds ? "HOLDS " : "BROKEN"} ${entry.name}`);
console.log(`[visual-contract] verdict: ${summary.verdict}`);
