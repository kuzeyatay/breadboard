import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeVisualizationOpportunities,
  buildVisualizationPlan,
  requiredGeneratedVisualizationContractProblems,
  selectVisualizationRoutes,
} from "../src/lib/visualization-opportunities.ts";
import {
  decideInteractiveVisualNecessity,
  deriveTeachingMediumPlan,
} from "../src/lib/visual-necessity.ts";

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
      text: "Electric work along a path is obtained by integrating the field component parallel to each differential displacement.",
      subject: "electric-work",
      predicate: "measured-by",
      object: "line-integral",
      conceptIds: ["electric-work", "line-integral"],
      evidenceAnchors: ["Engineering Electromagnetics, Chapter 4, Sections 4.1-4.2"],
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

test("legacy U7 question inference cannot bypass the model-authored control-contract gate", () => {
  const unit = plannedRequiredUnit();
  const opportunities = analyzeVisualizationOpportunities({
    gardenId: "electromagnetism-1",
    learningMap: mapFor(unit),
    learningUnits: [unit],
  });
  const selected = selectVisualizationRoutes({ opportunities, learningUnits: [unit] });
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

  assert.throws(
    () => buildVisualizationPlan({
      gardenId: "opaque",
      learningMap: mapFor(unit),
      learningUnits: [unit],
    }),
    /Visualization opportunity contract validation failed:.*no source-grounded learner input/i,
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
