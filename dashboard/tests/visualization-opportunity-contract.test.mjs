import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeVisualizationOpportunities,
  buildVisualizationPlan as buildVisualizationPlanRaw,
  persistedVisualizationOpportunityContractProblems,
  requiredGeneratedVisualizationContractProblems,
  saveVisualizationPlan,
  selectVisualizationRoutes,
} from "../src/lib/visualization-opportunities.ts";
import {
  decideInteractiveVisualNecessity,
  deriveTeachingMediumPlan,
} from "../src/lib/visual-necessity.ts";

const ELECTRIC_WORK_SOURCE_ANCHOR =
  "Engineering Electromagnetics, Chapter 4, Sections 4.1-4.2";
const ELECTRIC_WORK_SOURCE_TEXT =
  "Electric work along a path is obtained by integrating the field component parallel to each differential displacement.";

function modelAuthoredBudget(units) {
  return {
    targetMinimum: units.filter((unit) => unit.interactiveVisualPlan?.requirement !== "none").length,
    targetMaximum: units.filter((unit) => unit.interactiveVisualPlan?.requirement !== "none").length,
    maximumPerSection: units.length,
    minimumUnitsBetweenSimilarVisuals: 2,
    requiredVisuals: units.filter((unit) => unit.interactiveVisualPlan?.requirement === "required").length,
    recommendedVisuals: units.filter((unit) => unit.interactiveVisualPlan?.requirement === "recommended").length,
    optionalVisuals: units.filter((unit) => unit.interactiveVisualPlan?.requirement === "optional").length,
    reason: "Fixture-authored visual budget.",
  };
}

function buildVisualizationPlan(input) {
  return buildVisualizationPlanRaw({
    ...input,
    visualBudget: input.visualBudget ?? modelAuthoredBudget(input.learningUnits),
    canonicalEvidenceByUnit: input.canonicalEvidenceByUnit ?? {},
  });
}

function canonicalEvidenceForUnit(unit, extra = []) {
  return {
    [unit.id]: [
      ...(unit.knowledgeClaims ?? []).flatMap((claim) =>
        [...claim.evidenceAnchors, ...(claim.derivationAnchors ?? [])].map((anchor) => ({
          anchor,
          kind: "source_text",
          text: claim.text,
        }))),
      ...extra,
    ],
  };
}

function plannedRequiredUnit(overrides = {}) {
  const unit = {
    id: "U7",
    title: "Work, Line Integrals, and Electrostatic Energy",
    role: "mechanism",
    learningQuestion: "How does an electric field perform work when a charge moves along a path?",
    prerequisiteConcepts: ["Electric field"],
    newConcepts: ["Electric work", "Line integral", "Path independence", "Electrostatic energy"],
    sourceAnchors: [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    interactiveVisual: undefined,
    zettelNotes: [],
    semanticConcepts: [{
      slug: "electric-work",
      preferredLabel: "Electric work",
      role: "primary",
      aliases: [],
      evidenceAnchors: [],
    }],
    knowledgeClaims: [{
      id: "claim-electric-work-line-integral",
      text: ELECTRIC_WORK_SOURCE_TEXT,
      subject: "electric-work",
      predicate: "measured-by",
      object: "line-integral",
      conceptIds: ["electric-work", "line-integral"],
      evidenceAnchors: [ELECTRIC_WORK_SOURCE_ANCHOR],
      derivationAnchors: [],
      connectedClaimIds: [],
    }],
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
    ...overrides,
  };
  const decision = {
    ...decideInteractiveVisualNecessity(unit, {}),
    necessity: "required",
    preferredMedium: "interactive_visual",
    reason: "Moving the charge exposes how work accumulates along the path.",
  };
  return {
    ...unit,
    interactiveVisualPlan: {
      decision,
      requirement: "required",
      alternativeCoverage: "uncovered",
    },
    teachingMediumPlan: deriveTeachingMediumPlan(unit, decision),
  };
}

function mapFor(unit) {
  return {
    gardenId: "electromagnetism-1",
    title: "Electromagnetism",
    summary: "Source-grounded electromagnetism lessons.",
    sourceOnly: true,
    createdAt: "2026-08-13T00:00:00.000Z",
    warnings: [],
    sections: [{
      id: "section-2",
      title: "Electrostatic work",
      purpose: "Relate fields, paths, and work.",
      sourceAnchors: unit.sourceAnchors,
      subsections: [{
        id: "subsection-2-4",
        title: unit.title,
        purpose: unit.learningQuestion,
        sourceAnchors: unit.sourceAnchors,
        conceptTags: unit.newConcepts,
        learningUnitId: unit.id,
      }],
    }],
  };
}

function modelAuthoredInteractiveUnit() {
  const unit = plannedRequiredUnit();
  const claim = unit.knowledgeClaims[0];
  const anchor = claim.evidenceAnchors[0];
  const quote = claim.text;
  const expectedInsight =
    ELECTRIC_WORK_SOURCE_TEXT;
  const learnerAction =
    "Vary the field component parallel to each differential displacement and observe electric work along the path.";
  const controlContract = [{
    id: "parallel_field_component",
    kind: "variable",
    label: "field component parallel to each differential displacement",
    type: "number",
    unit: "V/m",
    min: -20,
    max: 20,
    step: 0.5,
    defaultValue: 2.5,
    evidence: [{ anchor, quote }],
  }];
  const observable = {
    label: "electric work along a path",
    representation: "value",
    evidence: [{ anchor, quote }],
  };
  const visualIntent = {
    id: "visual-u7-authored",
    uniqueConcept: "Accumulation of electric work along a path",
    visualType: "generated_module",
    whyStaticSourceFigureIsNotEnough:
      "The learner must vary the field contribution along the path and observe accumulated work.",
    learnerManipulates: ["field component parallel to each differential displacement"],
    expectedInsight,
    sourceAnchors: [anchor],
    duplicateSignature: "electric-work-path-integral-authored",
  };
  return {
    ...unit,
    interactiveVisual: visualIntent,
    interactiveVisualPlan: {
      ...unit.interactiveVisualPlan,
      decision: {
        ...unit.interactiveVisualPlan.decision,
        interaction: {
          interactionGoal: "manipulate_variables",
          uniqueConcept: visualIntent.uniqueConcept,
          whyStaticSourceFigureIsNotEnough: visualIntent.whyStaticSourceFigureIsNotEnough,
          learnerAction,
          controls: controlContract,
          observable,
          expectedInsight,
          expectedInsightEvidence: [{ anchor, quote }],
          duplicateSignature: visualIntent.duplicateSignature,
        },
      },
      interactionGoal: "manipulate_variables",
      learnerAction,
      controlContract,
      observable,
      expectedInsightEvidence: [{ anchor, quote }],
      visualIntent,
    },
  };
}

test("legacy U7 question inference cannot bypass the model-authored control-contract gate", () => {
  const unit = plannedRequiredUnit();
  const opportunities = analyzeVisualizationOpportunities({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    canonicalEvidenceByUnit: canonicalEvidenceForUnit(unit),
  });
  const selected = selectVisualizationRoutes({ opportunities, learningUnits: [unit] });
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].interactionGoal, undefined);
  assert.equal(opportunities[0].learningObjective, "");
  assert.deepEqual(opportunities[0].requiredInputs, []);
  assert.deepEqual(opportunities[0].requiredOutputs, []);
  assert.match(
    requiredGeneratedVisualizationContractProblems(selected).join(" "),
    /validated model-authored learner control contract/i,
  );
  assert.throws(
    () => buildVisualizationPlan({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
    }),
    /validated model-authored learner control contract/i,
  );
});

test("active planning rejects legacy model-authored question evidence as canonical grounding", () => {
  const unit = modelAuthoredInteractiveUnit();
  assert.throws(
    () => buildVisualizationPlan({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
      canonicalEvidenceByUnit: {
        U7: [{
          anchor: ELECTRIC_WORK_SOURCE_ANCHOR,
          kind: "learning_question",
          text: unit.learningQuestion,
        }],
      },
    }),
    /evidence kind learning_question is not canonical extracted-source evidence/i,
  );
});

test("required generated opportunities use the complete model-authored goal, control, and observable", () => {
  const unit = modelAuthoredInteractiveUnit();
  const plan = buildVisualizationPlan({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    canonicalEvidenceByUnit: canonicalEvidenceForUnit(unit),
  });
  assert.equal(plan.opportunities.length, 1);
  assert.equal(plan.opportunities[0].interactionGoal, "manipulate_variables");
  assert.deepEqual(plan.opportunities[0].sourceAnchorIds, [unit.knowledgeClaims[0].evidenceAnchors[0]]);
  assert.equal(plan.visualBudget.minimumUnitsBetweenSimilarVisuals, 2);
  assert.deepEqual(
    plan.opportunities[0].requiredInputs,
    [{
      id: "parallel_field_component",
      kind: "variable",
      label: "field component parallel to each differential displacement",
      type: "number",
      unit: "V/m",
      min: -20,
      max: 20,
      step: 0.5,
      defaultValue: 2.5,
    }],
  );
  assert.deepEqual(
    plan.opportunities[0].requiredOutputs.map(({ label }) => label),
    ["electric work along a path"],
  );

  const invalidPlans = [
    {
      label: "interaction goal",
      patch: { interactionGoal: undefined },
      error: /missing model-authored interactionGoal/i,
    },
    {
      label: "visual intent",
      patch: { visualIntent: undefined },
      error: /missing model-authored visualIntent/i,
    },
    {
      label: "learner control",
      patch: { controlContract: [] },
      error: /validated model-authored learner control contract/i,
    },
    {
      label: "observable",
      patch: { observable: undefined },
      error: /missing model-authored observable/i,
    },
  ];
  for (const fixture of invalidPlans) {
    const invalidUnit = {
      ...unit,
      interactiveVisualPlan: {
        ...unit.interactiveVisualPlan,
        ...fixture.patch,
      },
    };
    assert.throws(
      () => buildVisualizationPlan({
        gardenId: "electromagnetism-1",
        learningMap: mapFor(invalidUnit),
        learningUnits: [invalidUnit],
        canonicalEvidenceByUnit: canonicalEvidenceForUnit(invalidUnit),
      }),
      fixture.error,
      fixture.label,
    );
  }
});

test("regeneration rejects saved input or output contracts that drift from the persisted unit", () => {
  const unit = modelAuthoredInteractiveUnit();
  const plan = buildVisualizationPlan({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    canonicalEvidenceByUnit: canonicalEvidenceForUnit(unit),
  });
  const opportunity = plan.opportunities[0];
  assert.deepEqual(
    persistedVisualizationOpportunityContractProblems({ unit, opportunity }),
    [],
  );

  const changedInput = {
    ...opportunity,
    requiredInputs: opportunity.requiredInputs.map((control, index) =>
      index === 0 ? { ...control, max: control.max + 1 } : control),
  };
  assert.match(
    persistedVisualizationOpportunityContractProblems({ unit, opportunity: changedInput }).join("; "),
    /requiredInputs\[0\]\.max/i,
  );

  const changedKind = {
    ...opportunity,
    requiredInputs: opportunity.requiredInputs.map((control, index) =>
      index === 0 ? { ...control, kind: "process_position" } : control),
  };
  assert.match(
    persistedVisualizationOpportunityContractProblems({ unit, opportunity: changedKind }).join("; "),
    /requiredInputs\[0\]\.kind/i,
  );

  const changedOutput = {
    ...opportunity,
    requiredOutputs: opportunity.requiredOutputs.map((output, index) =>
      index === 0 ? { ...output, representation: "diagram" } : output),
  };
  assert.match(
    persistedVisualizationOpportunityContractProblems({ unit, opportunity: changedOutput }).join("; "),
    /requiredOutputs\[0\]\.representation/i,
  );
});

test("generated-visual regeneration derives anchor availability from the canonical registry", () => {
  const routeSource = fs.readFileSync(
    new URL(
      "../src/app/api/gardens/[gardenId]/visualizations/[visualId]/regenerate/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    routeSource,
    /buildCanonicalSourceAnchors\(gardenDir, \{ allowInferredFormulaText: false \}\)/,
  );
  assert.match(routeSource, /persistedVisualizationOpportunityContractProblems/);
  assert.match(routeSource, /acquireGardenLearnLease\(gardenDir,/);
  assert.match(
    routeSource,
    /durableRecoveryDir:\s*stableGeneratedVisualCouncilRecoveryRoot\(gardenDir\)/,
  );
  assert.match(routeSource, /if \(!lease\.heartbeat\(\)\)/);
  assert.match(routeSource, /finally \{\s*lease\.release\(\);\s*\}/);
  assert.doesNotMatch(
    routeSource,
    /availableSourceAnchorIds:\s*new Set\(opportunity\.sourceAnchorIds\)/,
  );
});

test("saving a visualization plan cannot overwrite the model necessity artifact", () => {
  const unit = modelAuthoredInteractiveUnit();
  const plan = buildVisualizationPlan({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    canonicalEvidenceByUnit: canonicalEvidenceForUnit(unit),
  });
  const gardenDir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-visual-plan-"));
  try {
    const breadboardDir = path.join(gardenDir, ".breadboard");
    fs.mkdirSync(breadboardDir, { recursive: true });
    const necessityPath = path.join(breadboardDir, "visual-necessity-decisions.json");
    const original = "model-authored-necessity-artifact\n";
    fs.writeFileSync(necessityPath, original, "utf8");
    saveVisualizationPlan(gardenDir, plan);
    assert.equal(fs.readFileSync(necessityPath, "utf8"), original);
    assert.deepEqual(plan.visualBudget, modelAuthoredBudget([unit]));
  } finally {
    fs.rmSync(gardenDir, { recursive: true, force: true });
  }
});

test("opportunity provenance is the exact cited source/artifact union with neutral figure metadata", () => {
  const base = modelAuthoredInteractiveUnit();
  const claimAnchor = base.knowledgeClaims[0].evidenceAnchors[0];
  const unit = {
    ...base,
    sourceAnchors: ["S1.P3.T1"],
    sourceFigures: [{
      id: "S1.P3.F1",
      placement: "inside_concept_explanation",
      mustBeDiscussedWith: "field direction",
      interpretationGoal: "Compare field direction with the path.",
    }],
    sourceFormulas: [{
      id: "S1.P3.E1",
      teachingGoal: "Relate the field component to work.",
      termsToDefine: ["field component"],
      placement: "before_example",
    }],
    sourceTables: [{
      id: "S1.P3.T2",
      teachingGoal: "Compare path cases.",
      rowsOrColumnsToExplain: ["path"],
      placement: "inside_comparison",
    }],
  };
  const plan = buildVisualizationPlan({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
    canonicalEvidenceByUnit: canonicalEvidenceForUnit(unit, [
      { anchor: "S1.P3.T1", kind: "source_table", text: "Path comparison cases." },
      { anchor: "S1.P3.F1", kind: "source_figure", text: "Field direction compared with the path." },
      { anchor: "S1.P3.E1", kind: "source_formula", text: "Field component and electric work." },
      { anchor: "S1.P3.T2", kind: "source_table", text: "Comparison of path cases." },
    ]),
  });
  assert.deepEqual(plan.opportunities[0].sourceAnchorIds, [
    "S1.P3.T1",
    "S1.P3.F1",
    "S1.P3.E1",
    "S1.P3.T2",
    claimAnchor,
  ]);
  assert.deepEqual(plan.opportunities[0].sourceVisualRelationships, [
    { sourceVisualId: "S1.P3.F1" },
  ]);
});

test("legacy encode and acts-like question parsers do not satisfy required generated contracts", () => {
  const fixtures = [
    {
      unit: plannedRequiredUnit({
        id: "U8",
        title: "Electric Potential, Gradient, and Energy Density",
        role: "formula",
        learningQuestion: "How does a scalar potential encode an electrostatic field, and how is stored energy distributed through that field?",
        prerequisiteConcepts: ["Electric work", "Line integrals", "Partial derivatives", "Electric flux density"],
        newConcepts: ["Electric potential", "Potential difference", "Voltage", "Gradient", "Electric energy density"],
        semanticConcepts: [{
          slug: "electric-potential",
          preferredLabel: "Electric potential",
          role: "primary",
          aliases: [],
          evidenceAnchors: [],
        }],
        knowledgeClaims: [],
      }),
      input: { id: "scalar_potential", label: "scalar potential" },
      output: { id: "electrostatic_field", label: "electrostatic field" },
    },
    {
      unit: plannedRequiredUnit({
        id: "U22",
        title: "Displacement Current and Electromagnetic Waves",
        role: "formula",
        learningQuestion: "Why must a changing electric field act like current, and how does this correction permit self-propagating electromagnetic waves?",
        prerequisiteConcepts: ["Charge continuity", "Ampere's law", "Faraday's law", "Maxwell's equations"],
        newConcepts: ["Displacement current", "Ampere-Maxwell law", "Wave equation", "Time-domain wave"],
        semanticConcepts: [{
          slug: "displacement-current",
          preferredLabel: "Displacement current",
          role: "primary",
          aliases: [],
          evidenceAnchors: [],
        }],
        knowledgeClaims: [],
      }),
      input: { id: "changing_electric_field", label: "changing electric field" },
      output: { id: "current", label: "current" },
    },
  ];

  for (const fixture of fixtures) {
    assert.throws(
      () => buildVisualizationPlan({
        gardenId: "electromagnetism-1",
        learningMap: mapFor(fixture.unit),
        learningUnits: [fixture.unit],
      }),
      /validated model-authored learner control contract/i,
      fixture.unit.id,
    );
  }
});

test("an unparseable required generated relationship fails planning instead of receiving generic controls", () => {
  const unit = plannedRequiredUnit({
    id: "U-OPAQUE",
    title: "An Opaque Relationship",
    learningQuestion: "Why is this relationship useful?",
    newConcepts: ["Opaque relationship"],
    semanticConcepts: [{
      slug: "opaque-relationship",
      preferredLabel: "Opaque relationship",
      role: "primary",
      aliases: [],
      evidenceAnchors: ["S1.P8.opaque"],
    }],
    sourceAnchors: ["S1.P8.opaque"],
    knowledgeClaims: [],
  });

  // The model-authored contract gate rejects this unit before input grounding
  // is even reached, so the failure names the missing contract rather than the
  // missing input. Either way planning stops; no generic control is invented.
  assert.throws(
    () => buildVisualizationPlan({
      gardenId: "opaque",
      learningMap: mapFor(unit),
      learningUnits: [unit],
    }),
    /Visualization opportunity contract validation failed:.*validated model-authored learner control contract/i,
  );
});

test("visualization routing never invents a necessity plan when the model-authored plan is absent", () => {
  const planned = plannedRequiredUnit();
  const unit = {
    ...planned,
    interactiveVisualPlan: undefined,
    teachingMediumPlan: undefined,
  };
  assert.throws(
    () => buildVisualizationPlan({
      gardenId: "electromagnetism-1",
      learningMap: mapFor(unit),
      learningUnits: [unit],
    }),
    /requires a validated model-authored necessity and teaching-medium decision/i,
  );
});
