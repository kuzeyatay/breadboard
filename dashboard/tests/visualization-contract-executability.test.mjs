import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildVisualizationContractRepairPrompt,
  validateVisualizationContractUnitRepair,
  VISUALIZATION_CONTRACT_REPAIR_RESPONSE_SCHEMA_HASH,
  visualizationContractRepairSystemPrompt,
} from "../src/lib/visualization-contract-repair.ts";
import {
  buildFinalVisualizationPlanFromRoutedContracts,
  buildVisualContractExecutabilityPrompt,
  buildVisualContractExecutabilityLedger,
  completeVisualContractForUnit,
  VisualContractExecutabilityReviewError,
  loadVisualContractExecutabilityLedger,
  reviewedWholeGardenConstraintProblems,
  reviewVisualizationPlanExecutability,
  runVisualContractExecutabilityReview,
  saveVisualContractExecutabilityLedger,
  strictVisualContractExecutabilityResponseOrExactRaw,
  visualContractExecutabilityArtifactProvenanceProblems,
  visualContractExecutabilityLinkageProblems,
} from "../src/lib/visualization-contract-executability.ts";
import {
  renderAuthoritativeLearningUnitContractMarkdown,
} from "../src/lib/learning-unit-contract-markdown.ts";
import { normalizeLearningUnits } from "../src/lib/learning-unit-contract.ts";
import { verifyFinalArtifactNoMutation } from "../src/lib/garden-finalize.ts";
import {
  GENERATED_VISUAL_CAPABILITY_MANIFEST,
  GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
  GENERATED_VISUAL_PREDICTION_PROTOCOL_RULE,
} from "../src/lib/generated-visual-capabilities.ts";
import {
  applyVisualizationRoutesToLearningUnits,
  buildVisualizationPlan,
} from "../src/lib/visualization-opportunities.ts";

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function refreshLedgerIntegrity(ledger) {
  const { integrityHash: _oldHash, ...payload } = ledger;
  ledger.integrityHash = hashJson(payload);
  return ledger;
}

function refreshExecutabilityAttemptHashes(attempt) {
  const prompt = buildVisualContractExecutabilityPrompt(attempt.packet);
  attempt.packetHash = hashJson(attempt.packet);
  attempt.requestHash = hashJson({ system: prompt.system, user: prompt.user });
  attempt.canonicalEvidenceHashes = Object.fromEntries(
    attempt.packet.units.map((unit) => [unit.unitId, hashJson(unit.canonicalEvidence)]),
  );
  attempt.wholeGardenConstraintsHash = attempt.packet.wholeGardenConstraints
    ? hashJson(attempt.packet.wholeGardenConstraints)
    : null;
}

function refreshStructuralAttemptHashes(attempt) {
  const prompt = buildVisualizationContractRepairPrompt(attempt.packet);
  attempt.packetHash = hashJson(attempt.packet);
  attempt.requestHash = hashJson(prompt);
  attempt.systemPromptHash = hashText(visualizationContractRepairSystemPrompt());
  attempt.responseSchemaHash = VISUALIZATION_CONTRACT_REPAIR_RESPONSE_SCHEMA_HASH;
  attempt.canonicalEvidenceHashes = Object.fromEntries(
    attempt.packet.units.map((unit) => [unit.unitId, hashJson(unit.evidence)]),
  );
}

const GARDEN_ID = "prediction-garden";
const ANCHOR = "source.case-outcome";
const EVIDENCE =
  "Case A and Case B determine whether the outcome is higher or lower; a learner predicts higher or lower before the outcome is revealed.";
const EXPECTED_INSIGHT =
  "Case A and Case B determine whether the outcome is higher or lower";
const EVIDENCE_BY_UNIT = Object.freeze({
  U3: Object.freeze([{ anchor: ANCHOR, kind: "source_text", text: EVIDENCE }]),
});

// Exact model-authored interaction from the durable failed Electromagnetics 1
// job learn_job_msts2z15_ku4jpll. The top-level learnerAction is the exact
// nested decision.interaction value from that record; no new semantics are
// supplied by this fixture or by deterministic production code.
const DURABLE_U3_P65 = "text-engineering-electromagnetics-9th-ed-9nbsped-compress-page-65";
const DURABLE_U3_P68 = "text-engineering-electromagnetics-9th-ed-9nbsped-compress-page-68";
const DURABLE_U3_RELATION_QUOTE =
  "$\\mathbf{D}_{S}$ is everywhere either normal or tangential to the closed surface";
const DURABLE_U3_INSIGHT =
  "Only a knowledge of the symmetry of the problem enables us to choose such a closed surface.";
const DURABLE_U3_SOURCE_ANCHORS = [
  DURABLE_U3_P65,
  DURABLE_U3_P68,
  "S1.P65.F1",
  "S1.P65.E1",
  "S1.P68.E1",
  "S1.P68.E2",
  "S1.P68.E3",
  "S1.P68.E4",
];

function durableU3SurfaceContract() {
  return {
    unitId: "U3",
    interactionGoal: "test_prediction",
    learnerAction:
      "Choose a field relationship to the closed surface and predict whether that part of the surface contributes to electric flux.",
    visualIntent: {
      id: "visual-u3-model",
      uniqueConcept:
        "Whether field orientation and constant magnitude make a closed surface useful for Gauss's law.",
      visualType: "generated_module",
      whyStaticSourceFigureIsNotEnough:
        "The source figure shows one local decomposition, but it does not let learners test why some closed surfaces simplify the integral and others do not.",
      learnerManipulates: ["closed surface"],
      expectedInsight: DURABLE_U3_INSIGHT,
      sourceAnchors: [...DURABLE_U3_SOURCE_ANCHORS],
      duplicateSignature: "u3_gaussian_surface_symmetry_test",
    },
    controls: [{
      id: "surface_field_relationship",
      kind: "select_case",
      label: "closed surface",
      type: "select",
      options: ["normal", "tangential"],
      defaultValue: "normal",
      evidence: [{ anchor: DURABLE_U3_P68, quote: DURABLE_U3_RELATION_QUOTE }],
    }],
    observable: {
      label: "electric flux density",
      representation: "diagram",
      evidence: [{ anchor: DURABLE_U3_P65, quote: "electric flux density" }],
    },
    expectedInsight: DURABLE_U3_INSIGHT,
    expectedInsightEvidence: [{ anchor: DURABLE_U3_P68, quote: DURABLE_U3_INSIGHT }],
  };
}

function durableU3CanonicalEvidence() {
  return DURABLE_U3_SOURCE_ANCHORS.map((anchor) => ({
    anchor,
    kind: anchor === DURABLE_U3_P65 || anchor === DURABLE_U3_P68
      ? "source_text"
      : anchor.includes(".F") ? "source_figure" : "source_formula",
    text: anchor === DURABLE_U3_P65
      ? "The oriented area element and electric flux density determine the flux contribution."
      : anchor === DURABLE_U3_P68
        ? `${DURABLE_U3_RELATION_QUOTE}. ${DURABLE_U3_INSIGHT}`
        : `Canonical extracted evidence for ${anchor}.`,
  }));
}

function durableU3Unit() {
  const contract = durableU3SurfaceContract();
  const unit = activeUnit(contract);
  unit.title = "Electric Flux Density and Gauss's Law";
  unit.role = "formula";
  unit.learningQuestion =
    "When can symmetry turn a difficult electric-field calculation into a simple closed-surface flux calculation?";
  unit.prerequisiteConcepts = [
    "electric field intensity",
    "dot product",
    "surface integration",
    "coordinate symmetry",
  ];
  unit.newConcepts = [
    "electric flux density",
    "electric flux",
    "Gaussian surface",
    "enclosed charge",
    "Gauss's law",
  ];
  unit.sourceAnchors = [DURABLE_U3_P65, DURABLE_U3_P68];
  unit.sourceFigures = [{
    id: "S1.P65.F1",
    placement: "inside_concept_explanation",
    mustBeDiscussedWith: "the oriented area element in an electric-flux integral",
    interpretationGoal:
      "Notice that only the normal component of electric flux density crosses the surface.",
  }];
  unit.sourceFormulas = DURABLE_U3_SOURCE_ANCHORS.slice(3).map((id) => ({
    id,
    teachingGoal: `Canonical teaching goal for ${id}.`,
    termsToDefine: ["electric flux density"],
    placement: "before_example",
  }));
  unit.semanticConcepts = [{
    slug: "electric-flux-density",
    preferredLabel: "Electric flux density",
    role: "primary",
    aliases: [],
    evidenceAnchors: [DURABLE_U3_P65],
  }, {
    slug: "gauss-law",
    preferredLabel: "Gauss's law",
    role: "primary",
    aliases: [],
    evidenceAnchors: [DURABLE_U3_P68],
  }];
  unit.sectionPlan = {
    id: "S1",
    title: "Fields, Vectors, and Electrostatic Sources",
    purpose: "Connect field behavior to enclosed sources.",
  };
  return unit;
}

function pedagogy(contract) {
  return {
    interactionGoal: contract.interactionGoal,
    uniqueConcept: contract.visualIntent.uniqueConcept,
    whyStaticSourceFigureIsNotEnough:
      contract.visualIntent.whyStaticSourceFigureIsNotEnough,
    learnerAction: contract.learnerAction,
    controls: contract.controls,
    observable: contract.observable,
    expectedInsight: contract.expectedInsight,
    expectedInsightEvidence: contract.expectedInsightEvidence,
    duplicateSignature: contract.visualIntent.duplicateSignature,
  };
}

function surfacePredictionContract() {
  return {
    unitId: "U3",
    interactionGoal: "test_prediction",
    learnerAction: "Select Case A or Case B and view the outcome.",
    visualIntent: {
      id: "visual-u3-surface",
      uniqueConcept: "Case and outcome relationship",
      visualType: "generated_module",
      whyStaticSourceFigureIsNotEnough:
        "The learner must switch cases and inspect the corresponding outcome.",
      learnerManipulates: ["Case A and Case B"],
      expectedInsight: EXPECTED_INSIGHT,
      sourceAnchors: [ANCHOR],
      duplicateSignature: "case-outcome-surface-selector",
    },
    controls: [{
      id: "case",
      kind: "select_case",
      label: "Case A and Case B",
      type: "select",
      options: ["Case A", "Case B"],
      defaultValue: "Case A",
      evidence: [{ anchor: ANCHOR, quote: EVIDENCE }],
    }],
    observable: {
      label: "outcome",
      representation: "diagram",
      evidence: [{ anchor: ANCHOR, quote: EVIDENCE }],
    },
    expectedInsight: EXPECTED_INSIGHT,
    expectedInsightEvidence: [{ anchor: ANCHOR, quote: EVIDENCE }],
  };
}

function executablePredictionContract(id = "visual-u3-prediction") {
  return {
    ...surfacePredictionContract(),
    learnerAction:
      "Choose a case, commit a higher-or-lower prediction, then reveal and evaluate the outcome while retaining the committed choice.",
    visualIntent: {
      ...surfacePredictionContract().visualIntent,
      id,
      whyStaticSourceFigureIsNotEnough:
        "The learner must commit a prediction before revealing the outcome and compare both states.",
      learnerManipulates: ["Case A and Case B", "Commit prediction", "Reveal outcome"],
      duplicateSignature: "case-prediction-commit-reveal-evaluate",
    },
    controls: [
      {
        ...surfacePredictionContract().controls[0],
        protocolRole: "prediction_input",
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
  };
}

function numericPredictionContract(id = "visual-u3-numeric-prediction") {
  const contract = executablePredictionContract(id);
  contract.controls[0] = {
    id: "case_a_value",
    kind: "variable",
    label: "Case A",
    type: "slider",
    protocolRole: "prediction_input",
    min: 0,
    max: 50,
    step: 1,
    defaultValue: 0,
    evidence: [{ anchor: ANCHOR, quote: EVIDENCE }],
  };
  contract.visualIntent = {
    ...contract.visualIntent,
    learnerManipulates: ["Case A", "Commit prediction", "Reveal outcome"],
    duplicateSignature: "case-a-numeric-prediction-commit-reveal",
  };
  return contract;
}

function decision(unitId, necessity, contract) {
  return {
    unitId,
    pageId: unitId,
    necessity,
    preferredMedium: necessity === "not_needed" ? "prose" : "interactive_visual",
    learningGoal: necessity === "not_needed" ? "Read the overview." : EXPECTED_INSIGHT,
    manipulationValue: necessity === "not_needed" ? 0 : 0.9,
    dynamicBehaviorValue: necessity === "not_needed" ? 0 : 0.8,
    comparisonValue: necessity === "not_needed" ? 0 : 0.9,
    spatialValue: 0.1,
    parameterSensitivityValue: necessity === "not_needed" ? 0 : 0.6,
    sourceFigureSufficiency: 0.2,
    proseSufficiency: necessity === "not_needed" ? 0.9 : 0.2,
    formulaSufficiency: 0.2,
    workedExampleSufficiency: 0.2,
    cognitiveLoadRisk: 0.2,
    duplicationRisk: 0.1,
    implementationRisk: 0.2,
    evidence: {
      unitRole: "mechanism",
      concepts: necessity === "not_needed" ? ["Overview"] : ["Case", "Outcome"],
      learningQuestion: necessity === "not_needed" ? "What is the overview?" : EXPECTED_INSIGHT,
      sourceAnchorIds: necessity === "not_needed" ? [] : [ANCHOR],
      nearbyVisualIntentIds: [],
    },
    reason: necessity === "not_needed"
      ? "The model selected prose."
      : "The model selected an interactive prediction.",
    ...(necessity === "not_needed" ? {} : { recommendedVisualType: "generated_module" }),
    ...(contract ? { interaction: pedagogy(contract) } : {}),
  };
}

function activeUnit(contract = surfacePredictionContract()) {
  const necessityDecision = decision("U3", "required", contract);
  return {
    id: "U3",
    title: "Predicting a Case Outcome",
    role: "mechanism",
    learningQuestion: EXPECTED_INSIGHT,
    prerequisiteConcepts: ["Case"],
    newConcepts: ["Outcome"],
    sourceAnchors: [ANCHOR],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    interactiveVisual: contract.visualIntent,
    interactiveVisualPlan: {
      decision: necessityDecision,
      requirement: "required",
      alternativeCoverage: "uncovered",
      interactionGoal: contract.interactionGoal,
      learnerAction: contract.learnerAction,
      visualIntent: contract.visualIntent,
      controlContract: contract.controls,
      observable: contract.observable,
      expectedInsightEvidence: contract.expectedInsightEvidence,
    },
    teachingMediumPlan: {
      unitId: "U3",
      preferredMedium: "interactive_visual",
      reason: necessityDecision.reason,
    },
    zettelNotes: [],
    semanticConcepts: [{
      slug: "outcome",
      preferredLabel: "Outcome",
      role: "primary",
      aliases: [],
      evidenceAnchors: [ANCHOR],
    }],
    knowledgeClaims: [{
      id: "claim-case-outcome",
      text: EVIDENCE,
      subject: "case",
      predicate: "determines",
      object: "outcome",
      conceptIds: ["outcome"],
      evidenceAnchors: [ANCHOR],
      derivationAnchors: [],
      connectedClaimIds: [],
    }],
    mustNotRepeat: [],
    expectedWordRange: [500, 800],
    sectionPlan: {
      id: "section-prediction",
      title: "Prediction",
      purpose: "Test a case prediction.",
    },
  };
}

function secondActiveUnit() {
  const contract = executablePredictionContract("visual-u4-prediction");
  contract.unitId = "U4";
  contract.visualIntent.duplicateSignature = "second-case-prediction";
  const unit = activeUnit(contract);
  unit.id = "U4";
  unit.title = "Second Predictive Comparison";
  unit.interactiveVisualPlan.decision.unitId = "U4";
  unit.interactiveVisualPlan.decision.pageId = "U4";
  unit.teachingMediumPlan.unitId = "U4";
  unit.knowledgeClaims[0].id = "claim-second-case-outcome";
  unit.sectionPlan = {
    id: "section-second-prediction",
    title: "Second Prediction",
    purpose: "Test a second prediction.",
  };
  return unit;
}

function inactiveUnit() {
  const necessityDecision = decision("U0", "not_needed");
  return {
    id: "U0",
    title: "Overview",
    role: "orientation",
    learningQuestion: "What is the overview?",
    prerequisiteConcepts: [],
    newConcepts: ["Overview"],
    sourceAnchors: [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    interactiveVisual: undefined,
    interactiveVisualPlan: {
      decision: necessityDecision,
      requirement: "none",
      alternativeCoverage: "covered_by_prose",
    },
    teachingMediumPlan: {
      unitId: "U0",
      preferredMedium: "prose",
      reason: necessityDecision.reason,
    },
    zettelNotes: [],
    semanticConcepts: [],
    knowledgeClaims: [],
    mustNotRepeat: [],
    expectedWordRange: [300, 500],
    sectionPlan: {
      id: "section-overview",
      title: "Overview",
      purpose: "Read the overview.",
    },
  };
}

function learningMap() {
  return {
    gardenId: GARDEN_ID,
    title: "Prediction Garden",
    summary: "A generic prediction fixture.",
    sourceOnly: true,
    createdAt: "2026-08-15T00:00:00.000Z",
    warnings: [],
    sections: [
      {
        id: "section-overview",
        title: "Overview",
        purpose: "Read the overview.",
        sourceAnchors: [],
        subsections: [{
          id: "overview-unit",
          title: "Overview",
          purpose: "Read the overview.",
          sourceAnchors: [],
          conceptTags: ["Overview"],
          learningUnitId: "U0",
        }],
      },
      {
        id: "section-prediction",
        title: "Prediction",
        purpose: "Test a case prediction.",
        sourceAnchors: [ANCHOR],
        subsections: [{
          id: "prediction-unit",
          title: "Predicting a Case Outcome",
          purpose: "Test a case prediction.",
          sourceAnchors: [ANCHOR],
          conceptTags: ["Outcome"],
          learningUnitId: "U3",
        }],
      },
    ],
  };
}

function twoActiveLearningMap() {
  const map = structuredClone(learningMap());
  map.sections.push({
    id: "section-second-prediction",
    title: "Second Prediction",
    purpose: "Test a second prediction.",
    sourceAnchors: [ANCHOR],
    subsections: [{
      id: "second-prediction-unit",
      title: "Second Predictive Comparison",
      purpose: "Test a second prediction.",
      sourceAnchors: [ANCHOR],
      conceptTags: ["Outcome"],
      learningUnitId: "U4",
    }],
  });
  return map;
}

const BUDGET = Object.freeze({
  targetMinimum: 1,
  targetMaximum: 1,
  maximumPerSection: 1,
  minimumUnitsBetweenSimilarVisuals: 1,
  requiredVisuals: 1,
  recommendedVisuals: 0,
  optionalVisuals: 0,
  reason: "The model authored one required prediction interaction.",
});

function initialPlan(units) {
  return buildVisualizationPlan({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: units,
    visualBudget: BUDGET,
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    necessityReviewCalls: 1,
    rejectedNecessityReviews: 0,
    visualDecisionOverrides: [],
  });
}

function response(reviews) {
  return { schemaVersion: 1, gardenId: GARDEN_ID, reviews };
}

function responseWithSurplusBraceAfterEachReplacement(batch) {
  const reviews = batch.reviews.map((review) => {
    const exact = JSON.stringify(review);
    return review.verdict === "replace"
      ? `${exact.slice(0, -1)}}}`
      : exact;
  });
  return `{"schemaVersion":${batch.schemaVersion},"gardenId":${JSON.stringify(batch.gardenId)},"reviews":[${reviews.join(",")}]}`;
}

test("Learn's executability provider uses strict exact JSON and preserves malformed raw text", () => {
  const learnSource = fs.readFileSync(
    new URL("../src/lib/learn.ts", import.meta.url),
    "utf8",
  );
  const providerStart = learnSource.indexOf(
    "async function requestVisualizationContractExecutabilityReview",
  );
  const providerEnd = learnSource.indexOf(
    "async function planAndReviewVisualNecessity",
    providerStart,
  );
  const provider = learnSource.slice(providerStart, providerEnd);
  assert.ok(providerStart >= 0 && providerEnd > providerStart);
  assert.match(
    provider,
    /strictVisualContractExecutabilityResponseOrExactRaw\(result\.content\)/,
  );
  assert.match(provider, /callCouncilText\(/);
  assert.match(provider, /preserveExactContent:\s*true/);
  assert.doesNotMatch(
    provider,
    /callCouncilJson\(|return\s+result\.parsed|parseJsonCandidate/,
    "the executability path must not invoke the permissive shared JSON parser",
  );

  const callJsonStart = learnSource.indexOf("async function callCouncilJson");
  const callJsonEnd = learnSource.indexOf(
    "async function requestVisualizationContractRepair",
    callJsonStart,
  );
  const callJson = learnSource.slice(callJsonStart, callJsonEnd);
  assert.match(callJson, /preserveExactContent\s*=\s*false/);
  assert.match(
    callJson,
    /preserveExactContent,\s*\n\s*planningCheckpoint,\s*\n\s*ordinaryCheckpoint,\s*\n\s*\}\)/,
  );

  const valid = JSON.stringify(response([{
    unitId: "U3",
    verdict: "approve",
    reason: "The complete contract is executable.",
  }]));
  assert.deepEqual(strictVisualContractExecutabilityResponseOrExactRaw(valid), {
    kind: "visual_contract_executability_exact_raw_v2",
    content: valid,
  });
  for (const malformed of [
    `\`\`\`json\n${valid}\n\`\`\``,
    `prefix ${valid} suffix`,
    `${valid}}`,
  ]) {
    assert.deepEqual(
      strictVisualContractExecutabilityResponseOrExactRaw(malformed),
      { kind: "visual_contract_executability_exact_raw_v2", content: malformed },
      "fences, prose wrappers, and surplus delimiters remain exact provider text",
    );
  }
  assert.deepEqual(strictVisualContractExecutabilityResponseOrExactRaw(" \r\n\t"), {
    kind: "visual_contract_executability_exact_raw_v2",
    content: " \r\n\t",
  });
  for (const raw of [
    "null",
    '{"schemaVersion":1,"schemaVersion":1,"gardenId":"prediction-garden","reviews":[]}',
    '{"numeric":1e999}',
  ]) {
    assert.deepEqual(
      strictVisualContractExecutabilityResponseOrExactRaw(raw),
      { kind: "visual_contract_executability_exact_raw_v2", content: raw },
      "valid JSON primitives, duplicate keys, and overflow spellings remain byte-exact until strict review",
    );
  }
});

test("surplus-brace output reaches a fresh complete AI rereview byte-for-byte", async () => {
  const u3 = activeUnit(executablePredictionContract("visual-u3-original"));
  const u10 = secondActiveUnit();
  u10.id = "U10";
  u10.title = "Tenth Predictive Comparison";
  u10.interactiveVisualPlan.decision.unitId = "U10";
  u10.interactiveVisualPlan.decision.pageId = "U10";
  u10.teachingMediumPlan.unitId = "U10";
  u10.knowledgeClaims[0].id = "claim-tenth-case-outcome";

  const u3Replacement = executablePredictionContract("visual-u3-fresh-complete");
  u3Replacement.visualIntent.duplicateSignature = "fresh-u3-prediction";
  const u10Replacement = executablePredictionContract("visual-u10-fresh-complete");
  u10Replacement.unitId = "U10";
  u10Replacement.visualIntent.duplicateSignature = "fresh-u10-prediction";
  const freshBatch = response([
    {
      unitId: "U3",
      verdict: "replace",
      reason: "A fresh complete U3 contract is required.",
      replacement: u3Replacement,
    },
    {
      unitId: "U10",
      verdict: "replace",
      reason: "A fresh complete U10 contract is required.",
      replacement: u10Replacement,
    },
  ]);
  const malformedRaw = responseWithSurplusBraceAfterEachReplacement(freshBatch);
  assert.throws(() => JSON.parse(malformedRaw), SyntaxError);
  assert.deepEqual(strictVisualContractExecutabilityResponseOrExactRaw(malformedRaw), {
    kind: "visual_contract_executability_exact_raw_v2",
    content: malformedRaw,
  });

  const requests = [];
  const before = structuredClone([u3, u10]);
  const reviewed = await runVisualContractExecutabilityReview({
    gardenId: GARDEN_ID,
    learningUnits: [u3, u10],
    canonicalEvidenceByUnit: {
      U3: structuredClone(EVIDENCE_BY_UNIT.U3),
      U10: structuredClone(EVIDENCE_BY_UNIT.U3),
    },
    provider: async (request) => {
      requests.push(request);
      if (requests.length === 1) return malformedRaw;
      assert.equal(request.sourceContext.previousProtocolFailure.response, malformedRaw);
      assert.equal(
        JSON.parse(request.user).previousProtocolFailure.response,
        malformedRaw,
      );
      assert.equal(request.sourceContext.previousRejectionReasons.length, 1);
      assert.match(
        request.sourceContext.previousRejectionReasons[0],
        /strict JSON\.parse failed at position \d+/,
      );
      assert.match(
        request.sourceContext.previousRejectionReasons[0],
        /bounded context/,
      );
      assert.match(request.system, /previousProtocolFailure is present/i);
      assert.match(request.system, /validate the entire response with a strict JSON parser/i);
      return structuredClone(freshBatch);
    },
    validateAll: (learningUnits) => learningUnits,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual([u3, u10], before, "the rejected raw response cannot mutate contracts");
  assert.equal(reviewed.attempts[0].accepted, false);
  assert.equal(reviewed.attempts[0].response, malformedRaw);
  assert.equal(reviewed.attempts[0].responseEncoding, "exact_raw");
  assert.equal(reviewed.attempts[1].accepted, true);
  assert.deepEqual(JSON.parse(reviewed.attempts[1].response), freshBatch);
  assert.deepEqual(reviewed.acceptedResponse, freshBatch);
  assert.deepEqual(reviewed.reviewedContracts.U3, u3Replacement);
  assert.deepEqual(reviewed.reviewedContracts.U10, u10Replacement);
});

test("missing, empty, or literal-null executability output is terminal and event sinks cannot reopen it", async () => {
  for (const emptyOutput of [undefined, null, "", "   \n", "null"]) {
    const unit = activeUnit(executablePredictionContract("visual-u3-empty-terminal"));
    let calls = 0;
    await assert.rejects(
      runVisualContractExecutabilityReview({
        gardenId: GARDEN_ID,
        learningUnits: [unit],
        canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
        provider: async () => {
          calls += 1;
          return emptyOutput;
        },
        validateAll: (learningUnits) => learningUnits,
        onEvent: () => {
          throw new Error("event sink fixture must remain observational");
        },
      }),
      (error) =>
        error instanceof VisualContractExecutabilityReviewError &&
        error.calls === 1 &&
        /no exact response text|empty exact response text|literal JSON null/i.test(
          error.problems[0]?.message ?? "",
        ),
    );
    assert.equal(calls, 1);
  }
});

test("a parseable response accepted on a protocol retry persists its exact retry ordinal", async () => {
  const unit = activeUnit(executablePredictionContract("visual-u3-protocol-retry"));
  const replacement = executablePredictionContract("visual-u3-protocol-retry-corrected");
  const malformedRaw = '{"schemaVersion":1,"gardenId":"prediction-garden","reviews":[';
  const acceptedRaw = JSON.stringify(response([{
    unitId: "U3",
    verdict: "replace",
    reason: "The complete model-authored correction is executable.",
    replacement,
  }]));
  const auditContext = {
    phase: "generation",
    jobId: "job-protocol-retry-accept",
    model: "review-model",
    learningMapId: "map-protocol-retry-accept",
    textbookVersionId: "textbook-protocol-retry-accept",
  };
  let calls = 0;
  const review = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: [unit],
    initialPlan: initialPlan([unit]),
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    auditContext,
    maximumRepeatedInteractionSignature: 1,
    provider: async () => {
      calls += 1;
      return strictVisualContractExecutabilityResponseOrExactRaw(
        calls === 1 ? malformedRaw : acceptedRaw,
      );
    },
  });
  assert.equal(review.calls, 2);
  assert.equal(review.attempts[1].requestPurpose, "protocol_retry");
  assert.equal(review.attempts[1].responseClassification, "semantic_candidate");
  assert.equal(review.attempts[1].accepted, true);
  assert.equal(review.attempts[1].transportAccounting.protocolRetry, 1);
  assert.equal(review.attempts[1].transportAccounting.semanticCandidate, 1);

  const routedUnits = applyVisualizationRoutesToLearningUnits(review.learningUnits, review.plan);
  const finalPlan = buildFinalVisualizationPlanFromRoutedContracts({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    finalRoutedLearningUnits: routedUnits,
    reviewedPlan: review.plan,
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
  });
  const ledger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review,
    finalRoutedLearningUnits: routedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: { source: "none", attempts: [] },
  });
  assert.equal(ledger.attempts[1].transportAccounting.protocolRetry, 1);
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: routedUnits,
    visualizationPlan: finalPlan,
    requireGenerationPhase: true,
    authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    expectedContext: auditContext,
  }), []);
});

test("model-authored necessity coverage and teaching-medium rationale survive LUC normalization and strict linkage", async () => {
  const rawUnit = activeUnit(executablePredictionContract("visual-u3-normalized-decision"));
  rawUnit.interactiveVisualPlan.decision.confidence = 0.87;
  rawUnit.interactiveVisualPlan.decision.alternativeCoverage = "uncovered";
  rawUnit.interactiveVisualPlan.decision.teachingMediumReason =
    "A source-grounded interactive comparison is the selected teaching medium.";
  rawUnit.teachingMediumPlan.reason = rawUnit.interactiveVisualPlan.decision.teachingMediumReason;

  const [normalized] = normalizeLearningUnits([rawUnit], { modelAuthoredOnly: true });
  assert.equal(
    normalized.interactiveVisualPlan?.decision.alternativeCoverage,
    rawUnit.interactiveVisualPlan.decision.alternativeCoverage,
  );
  assert.equal(
    normalized.interactiveVisualPlan?.decision.teachingMediumReason,
    rawUnit.interactiveVisualPlan.decision.teachingMediumReason,
  );

  const auditContext = {
    phase: "generation",
    jobId: "job-normalized-decision",
    model: "review-model",
    learningMapId: "map-normalized-decision",
    textbookVersionId: "textbook-normalized-decision",
  };
  const review = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: [normalized],
    initialPlan: initialPlan([normalized]),
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    auditContext,
    maximumRepeatedInteractionSignature: 1,
    provider: async () => response([{
      unitId: "U3",
      verdict: "approve",
      reason: "The complete model-authored contract is executable.",
    }]),
  });
  const routedUnits = applyVisualizationRoutesToLearningUnits(review.learningUnits, review.plan);
  // The strict finalizer reloads the persisted Learning Unit Contract rather
  // than receiving this in-memory routed projection. Re-normalize the JSON
  // form here so a dropped decision field cannot be masked by object identity.
  const persistedRoutedUnits = normalizeLearningUnits(
    JSON.parse(JSON.stringify(routedUnits)),
  );
  assert.equal(
    persistedRoutedUnits[0].interactiveVisualPlan?.decision.alternativeCoverage,
    "uncovered",
  );
  assert.equal(
    persistedRoutedUnits[0].interactiveVisualPlan?.decision.teachingMediumReason,
    rawUnit.interactiveVisualPlan.decision.teachingMediumReason,
  );
  const finalPlan = buildFinalVisualizationPlanFromRoutedContracts({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    finalRoutedLearningUnits: persistedRoutedUnits,
    reviewedPlan: review.plan,
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
  });
  const ledger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review,
    finalRoutedLearningUnits: persistedRoutedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: { source: "none", attempts: [] },
  });
  assert.equal(
    finalPlan.visualNecessityDecisions[0].alternativeCoverage,
    "uncovered",
  );
  assert.equal(
    finalPlan.visualNecessityDecisions[0].teachingMediumReason,
    rawUnit.interactiveVisualPlan.decision.teachingMediumReason,
  );
  assert.equal(
    ledger.immutableGardenAllocation[0].decisionBeforeMechanicalRouting.alternativeCoverage,
    "uncovered",
  );
  assert.equal(
    ledger.immutableGardenAllocation[0].decisionBeforeMechanicalRouting.teachingMediumReason,
    rawUnit.interactiveVisualPlan.decision.teachingMediumReason,
  );
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: persistedRoutedUnits,
    visualizationPlan: finalPlan,
    requireGenerationPhase: true,
    authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    expectedContext: auditContext,
  }), []);

  const invalidCoverage = structuredClone(rawUnit);
  invalidCoverage.interactiveVisualPlan.decision.alternativeCoverage = "covered_by_prose";
  assert.equal(
    normalizeLearningUnits([invalidCoverage], { modelAuthoredOnly: true })[0]
      .interactiveVisualPlan,
    undefined,
    "a model-authored decision cannot smuggle an invalid alternativeCoverage enum through normalization",
  );
  const missingMediumReason = structuredClone(rawUnit);
  missingMediumReason.interactiveVisualPlan.decision.teachingMediumReason = "";
  assert.equal(
    normalizeLearningUnits([missingMediumReason], { modelAuthoredOnly: true })[0]
      .interactiveVisualPlan,
    undefined,
    "a model-authored decision cannot omit the teaching-medium rationale through normalization",
  );
});

test("repeated malformed raw executability responses exhaust the AI budget and fail closed", async () => {
  const unit = activeUnit(executablePredictionContract());
  const completeBatch = response([{
    unitId: "U3",
    verdict: "replace",
    reason: "A complete replacement would be required.",
    replacement: executablePredictionContract("visual-u3-never-accepted"),
  }]);
  const malformedRaw = responseWithSurplusBraceAfterEachReplacement(completeBatch);
  const requests = [];

  await assert.rejects(
    () => runVisualContractExecutabilityReview({
      gardenId: GARDEN_ID,
      learningUnits: [unit],
      canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
      maxCalls: 3,
      provider: async (request) => {
        requests.push(request);
        return malformedRaw;
      },
      validateAll: () => {
        assert.fail("malformed raw output must never reach final validators");
      },
    }),
    (error) => {
      assert.equal(error.name, "VisualContractExecutabilityReviewError");
      assert.equal(error.calls, 3);
      assert.equal(error.lastResponse, malformedRaw);
      assert.match(error.message, /strict JSON\.parse failed at position \d+/);
      return true;
    },
  );
  assert.equal(requests.length, 3);
  for (const request of requests.slice(1)) {
    assert.equal(request.sourceContext.previousProtocolFailure.response, malformedRaw);
    assert.match(
      request.sourceContext.previousRejectionReasons.join(" "),
      /strict JSON\.parse failed at position \d+/,
    );
  }
});

test("protocol and semantic candidate caps share a hard five-invocation bound without mutation", async () => {
  const unit = activeUnit(executablePredictionContract("visual-u3-hard-cap"));
  const before = structuredClone(unit);
  const malformedRaw = '{"schemaVersion":1,"gardenId":"prediction-garden","reviews":[';
  const requests = [];
  await assert.rejects(
    () => runVisualContractExecutabilityReview({
      gardenId: GARDEN_ID,
      learningUnits: [unit],
      canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
      provider: async (request) => {
        requests.push(request);
        return requests.length <= 2
          ? strictVisualContractExecutabilityResponseOrExactRaw(malformedRaw)
          : response([]);
      },
      validateAll: (learningUnits) => learningUnits,
    }),
    (error) => {
      assert.equal(error.name, "VisualContractExecutabilityReviewError");
      assert.equal(error.calls, 5);
      assert.equal(error.semanticCandidates, 3);
      assert.equal(error.protocolRetries, 2);
      assert.match(error.message, /omitted active unit U3/i);
      return true;
    },
  );
  assert.equal(requests.length, 5);
  assert.deepEqual(
    requests.map((request) => request.requestPurpose),
    [
      "initial_semantic_review",
      "protocol_retry",
      "protocol_retry",
      "semantic_rereview",
      "semantic_rereview",
    ],
  );
  assert.deepEqual(unit, before, "no capped rejected candidate changes the caller's contract");
});

test("protocol retries preserve exact overflowing semantic raw text into a bounded corrected ledger", async () => {
  const unit = activeUnit(numericPredictionContract("visual-u3-numeric-original"));
  const before = structuredClone(unit);
  const overflowing = numericPredictionContract("visual-u3-numeric-overflow");
  const corrected = numericPredictionContract("visual-u3-numeric-corrected");
  const overflowingBatch = response([{
    unitId: "U3",
    verdict: "replace",
    reason: "Use a numeric prediction control for the supplied source relationship.",
    replacement: overflowing,
  }]);
  const overflowingRaw = JSON.stringify(overflowingBatch).replace(
    '"step":1',
    '"step":1e999',
  );
  assert.match(overflowingRaw, /"step":1e999/);
  assert.equal(
    JSON.stringify(JSON.parse(overflowingRaw)).includes('"step":null'),
    true,
    "the focused fixture demonstrates why preserving the provider bytes is required",
  );
  const correctedRaw = JSON.stringify(response([{
    unitId: "U3",
    verdict: "replace",
    reason: "Use a finite authored slider step for the numeric prediction.",
    replacement: corrected,
  }]));
  const malformedRaw = '{"schemaVersion":1,"gardenId":"prediction-garden","reviews":[';
  const requests = [];
  const auditContext = {
    phase: "generation",
    jobId: "job-raw-overflow",
    model: "review-model",
    learningMapId: "map-raw-overflow",
    textbookVersionId: "textbook-raw-overflow",
  };
  const review = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: [unit],
    initialPlan: initialPlan([unit]),
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    auditContext,
    maximumRepeatedInteractionSignature: 1,
    provider: async (request) => {
      requests.push(request);
      return [
        strictVisualContractExecutabilityResponseOrExactRaw(malformedRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(malformedRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(overflowingRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(correctedRaw),
      ][requests.length - 1];
    },
  });

  assert.deepEqual(unit, before, "no rejected response mutates the caller's contract");
  assert.equal(review.calls, 4);
  assert.equal(review.protocolRejections, 2);
  assert.equal(review.protocolRetries, 2);
  assert.equal(review.semanticCandidates, 2);
  assert.equal(review.rejectedReviews, 1);
  assert.equal(review.attempts[2].requestPurpose, "protocol_retry");
  assert.equal(review.attempts[2].responseClassification, "semantic_candidate");
  assert.equal(review.attempts[2].transportAccounting.semanticCandidate, 1);
  assert.equal(review.attempts[2].transportAccounting.protocolRetry, 2);
  assert.equal(review.attempts[2].response, overflowingRaw);
  assert.equal(review.attempts[2].exactRawResponseSha256, hashText(overflowingRaw));
  assert.equal(requests[3].requestPurpose, "semantic_rereview");
  assert.equal(requests[3].sourceContext.previousProtocolFailure, undefined);
  assert.equal(
    requests[3].sourceContext.previousSemanticFailure.response,
    overflowingRaw,
  );
  assert.equal(
    requests[3].sourceContext.previousSemanticFailure.exactRawResponseSha256,
    hashText(overflowingRaw),
  );
  assert.match(
    requests[3].sourceContext.previousSemanticFailure.rejectionReasons.join(" "),
    /step must be finite/i,
  );
  assert.match(requests[3].user, /1e999/);
  assert.doesNotMatch(requests[3].user, /"step"\\?":null/);

  // A later mechanical route may project a valid routed type that differs
  // from the pre-review allocation. Semantic rejection replay must restore
  // the signed pre-route decision before it validates model feedback.
  const routeProjection = structuredClone(review.plan);
  routeProjection.decisions[0].selectedRenderer = "post_review_route_type";
  const routedUnits = applyVisualizationRoutesToLearningUnits(review.learningUnits, routeProjection);
  assert.equal(
    routedUnits[0].interactiveVisualPlan.decision.recommendedVisualType,
    "post_review_route_type",
  );
  const finalPlan = buildFinalVisualizationPlanFromRoutedContracts({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    finalRoutedLearningUnits: routedUnits,
    reviewedPlan: review.plan,
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
  });
  finalPlan.decisions[0].selectedRenderer = "post_review_route_type";
  const ledger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review,
    finalRoutedLearningUnits: routedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: { source: "none", attempts: [] },
  });
  assert.equal(ledger.callAccounting.providerInvocations, 4);
  assert.equal(ledger.callAccounting.semanticCandidates, 2);
  assert.equal(ledger.callAccounting.protocolRetries, 2);
  assert.equal(ledger.callAccounting.protocolRejections, 2);
  assert.equal(ledger.attempts[2].response, overflowingRaw);
  assert.match(JSON.stringify(ledger), /1e999/);
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: routedUnits,
    visualizationPlan: finalPlan,
    requireGenerationPhase: true,
    authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    expectedContext: auditContext,
  }), []);

  const persistenceParent = fs.mkdtempSync(path.join(os.tmpdir(), "executability-v2-raw-"));
  const persistenceRoot = path.join(persistenceParent, "incoming-garden");
  fs.mkdirSync(persistenceRoot, { recursive: true });
  try {
    const ledgerPath = saveVisualContractExecutabilityLedger({
      gardenDir: persistenceRoot,
      ledger,
    });
    const loaded = loadVisualContractExecutabilityLedger(persistenceRoot);
    assert.deepEqual(loaded, ledger, "the signed v2 ledger survives byte-exact save/load");
    assert.equal(loaded.attempts[2].response, overflowingRaw);

    const legacy = structuredClone(ledger);
    legacy.schemaVersion = 1;
    refreshLedgerIntegrity(legacy);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    assert.equal(
      loadVisualContractExecutabilityLedger(persistenceRoot),
      null,
      "a pre-v2 ledger cannot silently validate under exact-raw protocol semantics",
    );
  } finally {
    fs.rmSync(persistenceParent, { recursive: true, force: true });
  }

  const rawTamper = structuredClone(ledger);
  rawTamper.attempts[2].response = overflowingRaw.replace("1e999", "1e998");
  refreshLedgerIntegrity(rawTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: rawTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: finalPlan,
    }).join(" "),
    /attempt 3 fields are invalid|response encoding is invalid/i,
    "changing exact provider bytes without the matching raw hash fails closed",
  );

  const paddedRawTamper = structuredClone(ledger);
  const paddedOverflowingRaw = `${overflowingRaw}${" ".repeat(520_000)}`;
  paddedRawTamper.attempts[2].response = paddedOverflowingRaw;
  paddedRawTamper.attempts[2].exactRawResponseSha256 = hashText(paddedOverflowingRaw);
  paddedRawTamper.attempts[3].packet.previousSemanticFailure.response = paddedOverflowingRaw;
  paddedRawTamper.attempts[3].packet.previousSemanticFailure.exactRawResponseSha256 =
    hashText(paddedOverflowingRaw);
  refreshExecutabilityAttemptHashes(paddedRawTamper.attempts[3]);
  refreshLedgerIntegrity(paddedRawTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: paddedRawTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: finalPlan,
    }).join(" "),
    /attempt 3 fields are invalid/i,
    "a coherently rehashed semantic raw response cannot bypass the exact response-byte cap",
  );

  const semanticReasonTamper = structuredClone(ledger);
  const forgedReasons = [{
    code: "forged_semantic_reason",
    path: "review:U3.replacement",
    message: "a forged semantic diagnosis",
    unitId: "U3",
  }];
  semanticReasonTamper.attempts[2].rejectionReasons = forgedReasons;
  semanticReasonTamper.attempts[3].packet.previousSemanticFailure.rejectionReasons = [
    "review:U3.replacement: a forged semantic diagnosis",
  ];
  semanticReasonTamper.attempts[3].packet.previousRejectionReasons = [
    "review:U3.replacement: a forged semantic diagnosis",
  ];
  refreshExecutabilityAttemptHashes(semanticReasonTamper.attempts[3]);
  refreshLedgerIntegrity(semanticReasonTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: semanticReasonTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: finalPlan,
    }).join(" "),
    /semantic candidate 3 rejection diagnostic is not exact/i,
    "a coherently rehashed semantic diagnostic cannot replace validator-derived feedback",
  );
});

test("a live-shaped missing numeric step and exact overflowing retry both reach one final model-authored correction", async () => {
  const unit = activeUnit(numericPredictionContract("visual-u3-live-shaped-original"));
  const before = structuredClone(unit);
  const missingStep = numericPredictionContract("visual-u3-live-shaped-missing-step");
  delete missingStep.controls[0].step;
  const overflowing = numericPredictionContract("visual-u3-live-shaped-overflow");
  const corrected = numericPredictionContract("visual-u3-live-shaped-corrected");
  const missingStepRaw = JSON.stringify(response([{
    unitId: "U3",
    verdict: "replace",
    reason: "Model-authored numeric prediction interaction.",
    replacement: missingStep,
  }]));
  const overflowingRaw = JSON.stringify(response([{
    unitId: "U3",
    verdict: "replace",
    reason: "Model-authored numeric prediction interaction.",
    replacement: overflowing,
  }])).replace('"step":1', '"step":1e999');
  const correctedRaw = JSON.stringify(response([{
    unitId: "U3",
    verdict: "replace",
    reason: "Model-authored finite numeric prediction interaction.",
    replacement: corrected,
  }]));
  const malformedRaw = '{"schemaVersion":1,"gardenId":"prediction-garden","reviews":[';
  const requests = [];
  const review = await runVisualContractExecutabilityReview({
    gardenId: GARDEN_ID,
    learningUnits: [unit],
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    provider: async (request) => {
      requests.push(request);
      return [
        strictVisualContractExecutabilityResponseOrExactRaw(malformedRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(malformedRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(missingStepRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(overflowingRaw),
        strictVisualContractExecutabilityResponseOrExactRaw(correctedRaw),
      ][requests.length - 1];
    },
    validateAll: (learningUnits) => learningUnits,
  });
  assert.equal(review.calls, 5);
  assert.equal(review.protocolRetries, 2);
  assert.equal(review.protocolRejections, 2);
  assert.equal(review.semanticCandidates, 3);
  assert.equal(review.rejectedReviews, 2);
  assert.equal(requests[3].requestPurpose, "semantic_rereview");
  assert.equal(requests[3].sourceContext.previousSemanticFailure.response, missingStepRaw);
  assert.match(
    requests[3].sourceContext.previousSemanticFailure.rejectionReasons.join(" "),
    /step must be finite/i,
  );
  assert.equal(requests[4].requestPurpose, "semantic_rereview");
  assert.equal(requests[4].sourceContext.previousSemanticFailure.response, overflowingRaw);
  assert.equal(
    requests[4].sourceContext.previousSemanticFailure.exactRawResponseSha256,
    hashText(overflowingRaw),
  );
  assert.match(requests[4].user, /1e999/);
  assert.deepEqual(unit, before, "all rejected candidates remain non-mutating before the accepted batch");
  assert.equal(review.reviewedContracts.U3.controls[0].step, 1);
});

test("U3 surface prediction contract receives a bounded AI-only complete replacement", async () => {
  const inactive = inactiveUnit();
  const original = activeUnit();
  const originalSnapshot = structuredClone(original);
  const units = [inactive, original];
  const packets = [];
  const events = [];
  const replacement = executablePredictionContract();

  const reviewed = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: units,
    initialPlan: initialPlan(units),
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    maximumRepeatedInteractionSignature: 1,
    maxCalls: 3,
    onEvent: (type, data) => events.push({ type, data }),
    provider: async (request) => {
      packets.push(request);
      assert.equal(request.sourceContext.units.length, 1);
      assert.equal(request.sourceContext.units[0].unitId, "U3");
      assert.deepEqual(request.sourceContext.units[0].contract, surfacePredictionContract());
      assert.deepEqual(request.sourceContext.units[0].canonicalEvidence, EVIDENCE_BY_UNIT.U3);
      assert.equal(
        request.sourceContext.technicalCapabilities.manifestHash,
        GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
      );
      assert.match(request.system, /commit a prediction before the outcome is revealed or evaluated/i);
      assert.match(request.system, /every condition or case that is decisive/i);
      assert.match(request.system, /control id must match \^\[a-z\]\[a-z0-9_\]\{0,79\}\$/i);
      assert.match(request.system, /x, t are runtime expression variables and are forbidden control ids/i);
      if (packets.length === 1) return response([]);
      if (packets.length === 2) {
        return response([{
          unitId: "U3",
          verdict: "replace",
          reason: "The selector does not commit a prediction.",
          replacement: { ...replacement, requirement: "optional" },
        }]);
      }
      return response([{
        unitId: "U3",
        verdict: "replace",
        reason: "This complete sequence commits before reveal and preserves the comparison.",
        replacement,
      }]);
    },
  });

  assert.equal(reviewed.calls, 3);
  assert.equal(reviewed.rejectedReviews, 2);
  assert.deepEqual(reviewed.replacedUnitIds, ["U3"]);
  assert.equal(reviewed.learningUnits[0], inactive, "inactive record stays exact");
  assert.deepEqual(original, originalSnapshot, "rejected batches never mutate the input");
  assert.equal(reviewed.learningUnits[1].interactiveVisualPlan.learnerAction, replacement.learnerAction);
  assert.deepEqual(reviewed.learningUnits[1].interactiveVisual, replacement.visualIntent);
  assert.deepEqual(reviewed.learningUnits[1].interactiveVisualPlan.decision.interaction, pedagogy(replacement));
  assert.match(packets[1].sourceContext.previousRejectionReasons.join(" "), /omitted active unit U3/i);
  assert.match(packets[2].sourceContext.previousRejectionReasons.join(" "), /requirement.*unexpected/i);
  assert.equal(reviewed.attempts.length, 3);
  assert.equal(reviewed.attempts.every((attempt) => /^[a-f0-9]{64}$/.test(attempt.packetHash)), true);
  assert.equal(reviewed.attempts[2].canonicalEvidenceHashes.U3.length, 64);
  assert.equal(events.at(-1).type, "visual_contract_executability_review_completed");
});

test("durable Electromagnetics U3 is shown exactly and changes only by an AI-authored verdict", async () => {
  const original = durableU3Unit();
  const before = structuredClone(original);
  const evidence = durableU3CanonicalEvidence();
  const replacement = durableU3SurfaceContract();
  replacement.learnerAction =
    "Choose the closed surface relationship, commit a normal-or-tangential electric flux density prediction, then inspect the diagram evaluation while the selected prediction remains visible.";
  replacement.visualIntent = {
    ...replacement.visualIntent,
    id: "visual-u3-model-reviewed",
    whyStaticSourceFigureIsNotEnough:
      "The learner must commit a field-orientation prediction and retain it while inspecting the diagram evaluation.",
    learnerManipulates: ["closed surface", "Commit prediction", "Reveal evaluation"],
    duplicateSignature: "u3_gaussian_surface_prediction_commit",
  };
  replacement.controls = [
    {
      ...replacement.controls[0],
      protocolRole: "prediction_input",
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
      id: "reveal_evaluation",
      kind: "protocol_action",
      label: "Reveal evaluation",
      type: "button",
      protocolRole: "evaluate_prediction",
      defaultValue: 0,
      evidence: [],
    },
  ];
  let calls = 0;
  const reviewed = await runVisualContractExecutabilityReview({
    gardenId: "electromagnetism-1",
    learningUnits: [original],
    canonicalEvidenceByUnit: { U3: evidence },
    provider: async (request) => {
      calls += 1;
      assert.equal(request.sourceContext.units.length, 1);
      assert.deepEqual(request.sourceContext.units[0].contract, durableU3SurfaceContract());
      assert.deepEqual(request.sourceContext.units[0].canonicalEvidence, evidence);
      assert.deepEqual(request.sourceContext.units[0].contract.controls[0], {
        id: "surface_field_relationship",
        kind: "select_case",
        label: "closed surface",
        type: "select",
        options: ["normal", "tangential"],
        defaultValue: "normal",
        evidence: [{ anchor: DURABLE_U3_P68, quote: DURABLE_U3_RELATION_QUOTE }],
      });
      assert.equal(
        request.sourceContext.units[0].contract.visualIntent.duplicateSignature,
        "u3_gaussian_surface_symmetry_test",
      );
      return {
        schemaVersion: 1,
        gardenId: "electromagnetism-1",
        reviews: [{
          unitId: "U3",
          verdict: "replace",
          reason:
            "The original selector chooses a displayed relationship but supplies no distinct prediction commitment before evaluation.",
          replacement,
        }],
      };
    },
    validateAll: (learningUnits) => learningUnits,
  });

  assert.equal(calls, 1);
  assert.deepEqual(original, before, "review does not mutate the durable source contract");
  assert.deepEqual(reviewed.reviewedContracts.U3, replacement);
  assert.deepEqual(reviewed.learningUnits[0].interactiveVisualPlan.decision.interaction, pedagogy(replacement));
  assert.equal(reviewed.learningUnits[0].interactiveVisualPlan.requirement, "required");
  assert.equal(reviewed.learningUnits[0].interactiveVisualPlan.decision.necessity, "required");
});

test("approval preserves the active unit exactly and provider throws escape semantic retries", async () => {
  const unit = activeUnit(executablePredictionContract());
  const approved = await runVisualContractExecutabilityReview({
    gardenId: GARDEN_ID,
    learningUnits: [unit],
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    provider: async () => response([{
      unitId: "U3",
      verdict: "approve",
      reason: "The declared sequence is executable.",
    }]),
    validateAll: (learningUnits) => learningUnits.length,
  });
  assert.equal(approved.learningUnits[0], unit);
  assert.equal(approved.plan, 1);

  let transportCalls = 0;
  const transportEvents = [];
  const transportFailure = new Error("network unavailable");
  await assert.rejects(
    () => runVisualContractExecutabilityReview({
      gardenId: GARDEN_ID,
      learningUnits: [unit],
      canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
      provider: async () => {
        transportCalls += 1;
        throw transportFailure;
      },
      validateAll: () => 1,
      onEvent: (type) => {
        transportEvents.push(type);
        throw new Error("event sink failed");
      },
    }),
    (error) => error === transportFailure,
  );
  assert.equal(transportCalls, 1);
  assert.equal(transportEvents.includes("visual_contract_executability_review_transport_aborted"), true);

  let cancellationChecks = 0;
  const cancellationEvents = [];
  const settledApproval = await runVisualContractExecutabilityReview({
    gardenId: GARDEN_ID,
    learningUnits: [unit],
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    provider: async () => response([{
      unitId: "U3",
      verdict: "approve",
      reason: "The fulfilled candidate remains authoritative.",
    }]),
    validateAll: () => 1,
    checkCancelled: () => {
      cancellationChecks += 1;
      if (cancellationChecks > 1) throw new Error("late cancellation observer");
    },
    onEvent: (type) => cancellationEvents.push(type),
  });
  assert.equal(settledApproval.plan, 1);
  assert.equal(cancellationChecks, 1);
  assert.equal(cancellationEvents.includes("visual_contract_executability_review_cancelled"), false);
  assert.equal(cancellationEvents.includes("visual_contract_executability_review_completed"), true);
});

test("model-authored multiline visual contracts survive routed persistence exactly", async () => {
  const unit = activeUnit(executablePredictionContract("visual-u3-before-multiline"));
  unit.interactiveVisualPlan.decision.alternativeCoverage = "uncovered";
  unit.interactiveVisualPlan.decision.teachingMediumReason =
    "The source-grounded prediction protocol is the selected teaching medium.";
  unit.interactiveVisualPlan.decision.confidence = 0.95;
  const replacement = executablePredictionContract("visual-u3-after-multiline");
  const multilineInsight = [
    "Case comparison",
    "- retain the committed prediction",
    "- reveal the observed outcome",
    "$$y_A > y_B$$",
  ].join("\n");
  replacement.learnerAction = [
    "Choose a case and commit a prediction.",
    "Then reveal the outcome without clearing the prediction.",
  ].join("\n");
  replacement.visualIntent.expectedInsight = multilineInsight;
  replacement.expectedInsight = multilineInsight;
  replacement.expectedInsightEvidence = [{ anchor: ANCHOR, quote: multilineInsight }];
  const evidenceByUnit = {
    U3: [{
      anchor: ANCHOR,
      kind: "source_text",
      text: `${EVIDENCE}\n${multilineInsight}`,
    }],
  };
  const auditContext = {
    phase: "planning",
    jobId: "job-multiline-contract",
    model: "review-model",
    learningMapId: "map-multiline-contract",
  };
  const review = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: [unit],
    initialPlan: buildVisualizationPlan({
      gardenId: GARDEN_ID,
      learningMap: learningMap(),
      learningUnits: [unit],
      visualBudget: BUDGET,
      canonicalEvidenceByUnit: evidenceByUnit,
      necessityReviewCalls: 1,
      rejectedNecessityReviews: 0,
      visualDecisionOverrides: [],
    }),
    canonicalEvidenceByUnit: evidenceByUnit,
    auditContext,
    maximumRepeatedInteractionSignature: 1,
    provider: async () => response([{
      unitId: "U3",
      verdict: "replace",
      reason: "The complete multiline contract is executable.",
      replacement,
    }]),
  });
  const routedUnits = applyVisualizationRoutesToLearningUnits(
    review.learningUnits,
    review.plan,
  );
  const persistedRoutedUnits = normalizeLearningUnits(
    JSON.parse(JSON.stringify(routedUnits)),
    { modelAuthoredOnly: true },
  );
  assert.ok(
    persistedRoutedUnits[0]?.interactiveVisualPlan?.interactionGoal &&
      persistedRoutedUnits[0]?.interactiveVisualPlan?.learnerAction &&
      persistedRoutedUnits[0]?.interactiveVisualPlan?.visualIntent &&
      persistedRoutedUnits[0]?.interactiveVisualPlan?.controlContract &&
      persistedRoutedUnits[0]?.interactiveVisualPlan?.observable &&
      persistedRoutedUnits[0]?.interactiveVisualPlan?.expectedInsightEvidence,
    JSON.stringify(persistedRoutedUnits[0]?.interactiveVisualPlan),
  );
  const persistedContract = completeVisualContractForUnit(persistedRoutedUnits[0]);
  assert.equal(persistedContract.learnerAction, replacement.learnerAction);
  assert.equal(persistedContract.expectedInsight, multilineInsight);
  const { interaction: _beforeInteraction, ...beforeDecision } =
    review.learningUnits[0].interactiveVisualPlan.decision;
  const { interaction: _afterInteraction, ...afterDecision } =
    persistedRoutedUnits[0].interactiveVisualPlan.decision;
  assert.deepEqual(afterDecision, {
    ...beforeDecision,
    recommendedVisualType: afterDecision.recommendedVisualType,
  });

  const finalPlan = buildFinalVisualizationPlanFromRoutedContracts({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    finalRoutedLearningUnits: persistedRoutedUnits,
    reviewedPlan: review.plan,
    canonicalEvidenceByUnit: evidenceByUnit,
  });
  const ledger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review,
    finalRoutedLearningUnits: persistedRoutedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: { source: "none", attempts: [] },
  });
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: persistedRoutedUnits,
    visualizationPlan: finalPlan,
    expectedContext: auditContext,
  }), []);
});

test("a complete reversed multi-unit review remains exact and links verdicts by unit id", async () => {
  const units = [
    activeUnit(executablePredictionContract()),
    secondActiveUnit(),
  ];
  const evidenceByUnit = {
    U3: structuredClone(EVIDENCE_BY_UNIT.U3),
    U4: structuredClone(EVIDENCE_BY_UNIT.U3),
  };
  const map = twoActiveLearningMap();
  const budget = {
    ...BUDGET,
    targetMinimum: 2,
    targetMaximum: 2,
    requiredVisuals: 2,
  };
  const plan = buildVisualizationPlan({
    gardenId: GARDEN_ID,
    learningMap: map,
    learningUnits: units,
    visualBudget: budget,
    canonicalEvidenceByUnit: evidenceByUnit,
    necessityReviewCalls: 1,
    rejectedNecessityReviews: 0,
    visualDecisionOverrides: [],
  });
  const auditContext = {
    phase: "generation",
    jobId: "job-reversed",
    model: "review-model",
    learningMapId: "map-reversed",
    textbookVersionId: "textbook-reversed",
  };
  const reviewed = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: map,
    learningUnits: units,
    initialPlan: plan,
    canonicalEvidenceByUnit: evidenceByUnit,
    auditContext,
    maximumRepeatedInteractionSignature: 1,
    provider: async () => response([
      {
        unitId: "U4",
        verdict: "approve",
        reason: "The second prediction contract is executable.",
      },
      {
        unitId: "U3",
        verdict: "approve",
        reason: "The first prediction contract is executable.",
      },
    ]),
  });
  assert.deepEqual(
    reviewed.acceptedResponse.reviews.map((review) => review.unitId),
    ["U4", "U3"],
    "the exact model-authored response order is retained",
  );

  const routedUnits = applyVisualizationRoutesToLearningUnits(reviewed.learningUnits, reviewed.plan);
  const finalPlan = buildFinalVisualizationPlanFromRoutedContracts({
    gardenId: GARDEN_ID,
    learningMap: map,
    finalRoutedLearningUnits: routedUnits,
    reviewedPlan: reviewed.plan,
    canonicalEvidenceByUnit: evidenceByUnit,
  });
  const ledger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review: reviewed,
    finalRoutedLearningUnits: routedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: { source: "none", attempts: [] },
  });
  assert.deepEqual(ledger.units.map((unit) => unit.unitId), ["U3", "U4"]);
  for (const opportunity of finalPlan.opportunities) {
    const finalUnit = routedUnits.find((unit) => unit.id === opportunity.learningUnitId);
    assert.deepEqual(
      opportunity.requiredInputs.map(({ kind, protocolRole }) => ({
        kind,
        ...(protocolRole !== undefined ? { protocolRole } : {}),
      })),
      finalUnit.interactiveVisualPlan.controlContract.map(({ kind, protocolRole }) => ({
        kind,
        ...(protocolRole !== undefined ? { protocolRole } : {}),
      })),
      `${opportunity.learningUnitId} preserves reviewed control kind/protocolRole through final routing`,
    );
  }
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: routedUnits,
    visualizationPlan: finalPlan,
    requireGenerationPhase: true,
    authoritativeCanonicalEvidenceByUnit: evidenceByUnit,
    expectedContext: auditContext,
  }), []);

  const structuralPacket = {
    problems: ["U3 requires a complete interaction contract"],
    units: [{
      unitId: "U3",
      title: units[0].title,
      role: units[0].role,
      requirement: "required",
      interactionGoal: units[0].interactiveVisualPlan.interactionGoal,
      learnerAction: units[0].interactiveVisualPlan.learnerAction,
      learningObjective: units[0].interactiveVisualPlan.visualIntent.expectedInsight,
      evidence: structuredClone(evidenceByUnit.U3),
    }],
    previousRejectionReasons: [],
  };
  const structuralResponse = { repairs: [executablePredictionContract()] };
  const execStartedAt = Date.parse(reviewed.attempts[0].startedAt);
  const structuralAttempt = {
    attempt: 1,
    startedAt: new Date(execStartedAt - 2_000).toISOString(),
    completedAt: new Date(execStartedAt - 1_000).toISOString(),
    packet: structuralPacket,
    packetHash: "",
    requestHash: "",
    systemPromptHash: "",
    responseSchemaHash: "",
    canonicalEvidenceHashes: {},
    transportAccounting: {
      logicalSemanticCall: 1,
      providerInvocationsAtThisBoundary: 1,
      transportRetries: "owned_below_semantic_boundary_not_counted",
    },
    accepted: true,
    responseEncoding: "json",
    response: structuralResponse,
    rejectionReasons: [],
    appliedUnitIds: ["U3"],
  };
  refreshStructuralAttemptHashes(structuralAttempt);
  const mixedLedger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review: reviewed,
    finalRoutedLearningUnits: routedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: {
      source: "model",
      attempts: [structuralAttempt],
      acceptedResponse: structuralResponse,
    },
    generatedAt: new Date(
      Date.parse(reviewed.attempts.at(-1).completedAt) + 1_000,
    ).toISOString(),
  });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mixed-exec-lineage-"));
  try {
    const breadboardDir = path.join(tempRoot, ".breadboard");
    fs.mkdirSync(path.join(breadboardDir, "planning"), { recursive: true });
    const contractPayload = `${JSON.stringify({ learningUnits: routedUnits }, null, 2)}\n`;
    fs.writeFileSync(
      path.join(breadboardDir, "learning-unit-contract.json"),
      contractPayload,
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "planning", "Learning Unit Contract.md"),
      renderAuthoritativeLearningUnitContractMarkdown({
        units: routedUnits,
        authoritativeSourceSha256: hashText(contractPayload),
      }),
      "utf8",
    );
    const supersededBy = {
      learningUnitContract: ".breadboard/learning-unit-contract.json",
      visualizationPlan: ".breadboard/visualization-plan.json",
      executabilityReviewLedger: ".breadboard/visual-contract-executability-reviews.json",
    };
    const originalByUnit = new Map(units.map((unit) => [unit.id, unit]));
    const decisions = [...mixedLedger.immutableGardenAllocation].reverse().map((item) => ({
      ...structuredClone(item.decisionBeforeMechanicalRouting),
      interaction: structuredClone(
        originalByUnit.get(item.unitId).interactiveVisualPlan.decision.interaction,
      ),
    }));
    const necessityArtifact = {
      schemaVersion: 1,
      gardenId: GARDEN_ID,
      generatedAt: "2026-08-15T00:00:00.000Z",
      artifactRole: "pre_executability_model_necessity_and_teaching_medium_source",
      interactionContractsAreAuthoritative: false,
      supersededBy,
      budget: structuredClone(mixedLedger.authoritativePlanPolicy.visualBudget),
      decisions,
      teachingMedia: [...mixedLedger.immutableGardenAllocation]
        .reverse()
        .map((item) => structuredClone(item.teachingMediumPlan)),
      overrides: structuredClone(mixedLedger.authoritativePlanPolicy.visualDecisionOverrides),
      reviewCalls: mixedLedger.authoritativePlanPolicy.necessityReviewCalls,
      rejectedReviews: mixedLedger.authoritativePlanPolicy.rejectedNecessityReviews,
      decisionRecords: [],
    };
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(necessityArtifact, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-decision-records.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        gardenId: GARDEN_ID,
        generatedAt: necessityArtifact.generatedAt,
        artifactRole: necessityArtifact.artifactRole,
        interactionContractsAreAuthoritative: false,
        supersededBy,
        decisionRecords: [],
      }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.md"),
      "> Pre-executability necessity and teaching-medium source. Any interaction contract here is not authoritative after review. Use `.breadboard/learning-unit-contract.json`, `.breadboard/visualization-plan.json`, and `.breadboard/visual-contract-executability-reviews.json`.\n",
      "utf8",
    );
    assert.deepEqual(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: tempRoot,
        gardenId: GARDEN_ID,
        ledger: mixedLedger,
        finalLearningUnits: routedUnits,
      }),
      [],
      "one structurally repaired unit and one untouched unit have complete ID-keyed lineage",
    );
    necessityArtifact.decisions.find((item) => item.unitId === "U4").interaction.learnerAction =
      "A later unexplained rewrite.";
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(necessityArtifact, null, 2)}\n`,
      "utf8",
    );
    assert.match(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: tempRoot,
        gardenId: GARDEN_ID,
        ledger: mixedLedger,
        finalLearningUnits: routedUnits,
      }).join(" "),
      /U4: executability beforeReviewContract is not the exact unrepaired necessity interaction/i,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("whole-garden gates reject duplicate ids/signatures and incomplete section mapping", () => {
  const first = activeUnit(executablePredictionContract("shared-visual-id"));
  const second = structuredClone(first);
  second.id = "U4";
  second.title = "Second Prediction";
  second.interactiveVisualPlan.decision.unitId = "U4";
  second.interactiveVisualPlan.decision.pageId = "U4";
  second.interactiveVisualPlan.requirement = "recommended";
  second.interactiveVisualPlan.decision.necessity = "recommended";
  second.interactiveVisualPlan.visualIntent.id = "shared-visual-id";
  second.interactiveVisual.id = "shared-visual-id";
  const constraints = {
    unitOrder: ["U3", "U4"],
    sectionByUnit: { U3: "section-prediction" },
    maximumRepeatedInteractionSignature: 1,
    targetMinimum: 2,
    targetMaximum: 2,
    maximumPerSection: 2,
    minimumUnitsBetweenSimilarVisuals: 1,
    requiredVisuals: 1,
    recommendedVisuals: 1,
    optionalVisuals: 0,
  };
  const problems = reviewedWholeGardenConstraintProblems({
    beforeUnits: [first, second],
    reviewedUnits: [first, second],
    constraints,
  });
  assert.match(problems.map((item) => item.code).join(" "), /duplicate_visual_intent_id/);
  assert.match(problems.map((item) => item.code).join(" "), /duplicate_interaction_signature/);
  assert.match(problems.map((item) => item.message).join(" "), /section mapping must cover/i);
});

test("prediction protocol controls fail closed on type, evidence, role, and order drift", () => {
  const valid = executablePredictionContract();
  const validate = (contract) => validateVisualizationContractUnitRepair({
    unit: activeUnit(contract),
    evidence: EVIDENCE_BY_UNIT.U3,
    repair: contract,
    requireCompleteContract: true,
    requireExecutableProtocol: true,
  });
  assert.deepEqual(validate(valid), []);

  const ungroundedAction = structuredClone(valid);
  ungroundedAction.controls[1].evidence = [{ anchor: ANCHOR, quote: EVIDENCE }];
  assert.match(validate(ungroundedAction).join(" "), /pure protocol control.*exactly empty evidence/i);

  const wrongKind = structuredClone(valid);
  wrongKind.controls[1].kind = "variable";
  assert.match(validate(wrongKind).join(" "), /button.*kind protocol_action/i);

  const wrongDefault = structuredClone(valid);
  wrongDefault.controls[1].defaultValue = 1;
  assert.match(validate(wrongDefault).join(" "), /button.*default.*0/i);

  const missingCommit = structuredClone(valid);
  missingCommit.controls = missingCommit.controls.filter((control) =>
    control.protocolRole !== "commit_prediction");
  missingCommit.visualIntent.learnerManipulates = missingCommit.controls.map((control) => control.label);
  assert.match(validate(missingCommit).join(" "), /requires.*commit_prediction/i);

  const duplicateRole = structuredClone(valid);
  duplicateRole.controls[2].protocolRole = "commit_prediction";
  assert.match(validate(duplicateRole).join(" "), /protocolRole "commit_prediction" must be unique/i);

  const misordered = structuredClone(valid);
  misordered.controls = [misordered.controls[1], misordered.controls[0], misordered.controls[2]];
  misordered.visualIntent.learnerManipulates = misordered.controls.map((control) => control.label);
  assert.match(validate(misordered).join(" "), /prediction_input.*precede.*commit_prediction/i);

  const nonPrediction = structuredClone(valid);
  nonPrediction.interactionGoal = "compare_cases";
  assert.match(validate(nonPrediction).join(" "), /prediction protocol roles require.*test_prediction/i);

  const sourceCommit = structuredClone(valid);
  sourceCommit.controls[0].protocolRole = "commit_prediction";
  assert.match(validate(sourceCommit).join(" "), /source-semantic controls may carry only.*prediction_input/i);

  const buttonPredictionInput = structuredClone(valid);
  buttonPredictionInput.controls[1].protocolRole = "prediction_input";
  assert.match(validate(buttonPredictionInput).join(" "), /prediction_input.*not a pure protocol action/i);

  const toggleWrongDefault = structuredClone(valid);
  toggleWrongDefault.controls[1].type = "toggle";
  toggleWrongDefault.controls[1].defaultValue = true;
  assert.match(validate(toggleWrongDefault).join(" "), /protocol toggle.*defaultValue must be false/i);

  const protocolDomain = structuredClone(valid);
  protocolDomain.controls[1].unit = "seconds";
  assert.match(validate(protocolDomain).join(" "), /protocol control.*must not declare unit/i);

  const missingOutcome = structuredClone(valid);
  missingOutcome.controls = missingOutcome.controls.filter((control) =>
    control.protocolRole !== "reveal_outcome");
  missingOutcome.visualIntent.learnerManipulates = missingOutcome.controls.map((control) => control.label);
  assert.match(validate(missingOutcome).join(" "), /requires a distinct reveal_outcome or evaluate_prediction/i);

  const missingRoles = structuredClone(valid);
  for (const control of missingRoles.controls) delete control.protocolRole;
  assert.match(
    validate(missingRoles).join(" "),
    /requires one evidence-grounded.*prediction_input.*requires a distinct.*commit_prediction.*requires a distinct reveal_outcome/is,
  );
});

test("non-prediction protocol actions may omit prediction-only roles", () => {
  const contract = executablePredictionContract();
  contract.interactionGoal = "compare_cases";
  for (const control of contract.controls) delete control.protocolRole;
  const problems = validateVisualizationContractUnitRepair({
    unit: activeUnit(contract),
    evidence: EVIDENCE_BY_UNIT.U3,
    repair: contract,
    requireCompleteContract: true,
    requireExecutableProtocol: true,
  });
  assert.deepEqual(problems, []);

  const structuralPrompt = visualizationContractRepairSystemPrompt();
  assert.equal(structuralPrompt.includes(GENERATED_VISUAL_PREDICTION_PROTOCOL_RULE), true);
  assert.match(structuralPrompt, /ordinary non-prediction actions may omit protocolRole/i);
  assert.doesNotMatch(structuralPrompt, /must.*carry protocolRole/i);
});

test("ledger survives replacement, links review to route only, and fails closed on tampering", async () => {
  const units = [inactiveUnit(), activeUnit()];
  units[0].interactiveVisualPlan.decision.confidence = 0.87;
  units[0].interactiveVisualPlan.decision.alternativeCoverage = "covered";
  units[0].interactiveVisualPlan.decision.teachingMediumReason =
    "The supplied prose is the selected teaching medium for the orientation unit.";
  units[0].interactiveVisualPlan.alternativeCoverage = "covered";
  units[0].teachingMediumPlan.reason =
    units[0].interactiveVisualPlan.decision.teachingMediumReason;
  units[1].interactiveVisualPlan.decision.confidence = 0.87;
  units[1].interactiveVisualPlan.decision.alternativeCoverage = "uncovered";
  units[1].interactiveVisualPlan.decision.teachingMediumReason =
    "A source-grounded interactive comparison is the selected teaching medium.";
  units[1].teachingMediumPlan.reason =
    units[1].interactiveVisualPlan.decision.teachingMediumReason;
  const replacement = executablePredictionContract();
  const auditContext = {
    phase: "generation",
    jobId: "job-1",
    model: "review-model",
    learningMapId: "map-1",
    textbookVersionId: "textbook-1",
  };
  const review = await reviewVisualizationPlanExecutability({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    learningUnits: units,
    initialPlan: initialPlan(units),
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    auditContext,
    maximumRepeatedInteractionSignature: 1,
    provider: async () => response([{
      unitId: "U3",
      verdict: "replace",
      reason: "Commit-before-reveal is now explicit.",
      replacement,
    }]),
  });
  const routedUnits = applyVisualizationRoutesToLearningUnits(review.learningUnits, review.plan);
  const finalPlan = buildFinalVisualizationPlanFromRoutedContracts({
    gardenId: GARDEN_ID,
    learningMap: learningMap(),
    finalRoutedLearningUnits: routedUnits,
    reviewedPlan: review.plan,
    canonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
  });
  const structuralPacket = {
    problems: ["U3 requires a complete interaction contract"],
    units: [{
      unitId: "U3",
      title: "Predicting a Case Outcome",
      role: "mechanism",
      requirement: "required",
      interactionGoal: "test_prediction",
      learnerAction: surfacePredictionContract().learnerAction,
      learningObjective: EXPECTED_INSIGHT,
      evidence: structuredClone(EVIDENCE_BY_UNIT.U3),
    }],
    previousRejectionReasons: [],
  };
  const structuralPrompt = buildVisualizationContractRepairPrompt(structuralPacket);
  const structuralResponse = { repairs: [surfacePredictionContract()] };
  const executabilityStartedAt = Date.parse(review.attempts[0].startedAt);
  const structuralAttempt = {
    attempt: 1,
    startedAt: new Date(executabilityStartedAt - 2_000).toISOString(),
    completedAt: new Date(executabilityStartedAt - 1_000).toISOString(),
    packet: structuralPacket,
    packetHash: hashJson(structuralPacket),
    requestHash: hashJson(structuralPrompt),
    systemPromptHash: hashText(visualizationContractRepairSystemPrompt()),
    responseSchemaHash: VISUALIZATION_CONTRACT_REPAIR_RESPONSE_SCHEMA_HASH,
    canonicalEvidenceHashes: { U3: hashJson(structuralPacket.units[0].evidence) },
    transportAccounting: {
      logicalSemanticCall: 1,
      providerInvocationsAtThisBoundary: 1,
      transportRetries: "owned_below_semantic_boundary_not_counted",
    },
    accepted: true,
    responseEncoding: "json",
    response: structuralResponse,
    rejectionReasons: [],
    appliedUnitIds: ["U3"],
  };
  const ledger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review,
    finalRoutedLearningUnits: routedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: {
      source: "model",
      attempts: [structuralAttempt],
      acceptedResponse: structuralResponse,
    },
    generatedAt: new Date(Date.parse(review.attempts.at(-1).completedAt) + 1_000).toISOString(),
  });
  const unrepairedLedger = buildVisualContractExecutabilityLedger({
    gardenId: GARDEN_ID,
    context: auditContext,
    review,
    finalRoutedLearningUnits: routedUnits,
    finalVisualizationPlan: finalPlan,
    structuralContractRepair: { source: "none", attempts: [] },
    generatedAt: new Date(Date.parse(review.attempts.at(-1).completedAt) + 1_000).toISOString(),
  });
  const oversizedReview = structuredClone(review);
  oversizedReview.attempts[0].packet.units[0].canonicalEvidence[0].text =
    `${EVIDENCE}${"x".repeat(12_050_000)}`;
  refreshExecutabilityAttemptHashes(oversizedReview.attempts[0]);
  assert.throws(
    () => buildVisualContractExecutabilityLedger({
      gardenId: GARDEN_ID,
      context: auditContext,
      review: oversizedReview,
      finalRoutedLearningUnits: routedUnits,
      finalVisualizationPlan: finalPlan,
      structuralContractRepair: { source: "none", attempts: [] },
    }),
    /ledger exceeds 12000000 UTF-8 bytes/i,
    "the ledger byte ceiling is enforced before any persistence callback",
  );
  assert.equal(
    ledger.units[0].finalRoutedContract.visualIntent.visualType,
    ledger.units[0].mechanicalRouting.projectedVisualType,
  );
  assert.notEqual(
    ledger.units[0].reviewedContractBeforeMechanicalRouting.visualIntent.visualType,
    undefined,
  );
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: routedUnits,
    visualizationPlan: finalPlan,
    requireGenerationPhase: true,
    authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
    expectedContext: auditContext,
  }), []);

  const placedPlan = structuredClone(finalPlan);
  placedPlan.opportunities[0].targetPage = "learning/2. Prediction/2.1 Predicting.md";
  placedPlan.opportunities[0].targetHeading = "Predicting a Case Outcome";
  placedPlan.opportunities[0].insertionAnchor = "learning-unit:U3:after-introduction";
  assert.deepEqual(visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger,
    finalLearningUnits: routedUnits,
    visualizationPlan: placedPlan,
  }), [], "only the three page-placement fields may change after the ledger is written");

  const aliasOrderOnly = structuredClone(ledger);
  aliasOrderOnly.attempts[0].packet.units[0].concepts.reverse();
  refreshExecutabilityAttemptHashes(aliasOrderOnly.attempts[0]);
  refreshLedgerIntegrity(aliasOrderOnly);
  assert.deepEqual(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: aliasOrderOnly,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }),
    [],
    "canonical alias ordering must not invalidate an otherwise signed immutable packet",
  );

  const aliasSetTamper = structuredClone(aliasOrderOnly);
  aliasSetTamper.attempts[0].packet.units[0].concepts.splice(0, 1, "invented-alias");
  refreshExecutabilityAttemptHashes(aliasSetTamper.attempts[0]);
  refreshLedgerIntegrity(aliasSetTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: aliasSetTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /packet metadata.*differs from the final immutable unit/i,
  );

  const provenanceDriftPlan = structuredClone(placedPlan);
  provenanceDriftPlan.opportunities[0].sourceAnchorIds.push("invented.anchor");
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger,
      finalLearningUnits: routedUnits,
      visualizationPlan: provenanceDriftPlan,
    }).join(" "),
    /opportunities.*differ from the ledger/i,
  );

  const packetTamperLedger = structuredClone(ledger);
  packetTamperLedger.attempts[0].packet.units[0].canonicalEvidence[0].text =
    "tampered canonical evidence";
  refreshLedgerIntegrity(packetTamperLedger);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: packetTamperLedger,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /packetHash does not match|evidence hashes do not match/i,
  );

  const structuralPacketTamperLedger = structuredClone(ledger);
  structuralPacketTamperLedger.structuralContractRepair.attempts[0].packet.units[0].evidence[0].text =
    "tampered structural evidence";
  refreshLedgerIntegrity(structuralPacketTamperLedger);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: structuralPacketTamperLedger,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /structural repair attempt 1.*stale/i,
  );

  const fullyRehashedEvidenceTamper = structuredClone(ledger);
  fullyRehashedEvidenceTamper.attempts[0].packet.units[0].canonicalEvidence[0].text =
    "A forged but internally rehashed evidence packet.";
  refreshExecutabilityAttemptHashes(fullyRehashedEvidenceTamper.attempts[0]);
  refreshLedgerIntegrity(fullyRehashedEvidenceTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: fullyRehashedEvidenceTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /evidence.*differs from executability review evidence/i,
    "packet-local rehashing cannot sever structural-to-executability evidence provenance",
  );

  const coherentlyRehashedEvidenceTamper = structuredClone(ledger);
  const forgedEvidence = [{
    anchor: ANCHOR,
    kind: "source_text",
    text: "A forged source packet changed coherently in every persisted attempt.",
  }];
  coherentlyRehashedEvidenceTamper.attempts[0].packet.units[0].canonicalEvidence =
    structuredClone(forgedEvidence);
  coherentlyRehashedEvidenceTamper.structuralContractRepair.attempts[0].packet.units[0].evidence =
    structuredClone(forgedEvidence);
  refreshExecutabilityAttemptHashes(coherentlyRehashedEvidenceTamper.attempts[0]);
  refreshStructuralAttemptHashes(
    coherentlyRehashedEvidenceTamper.structuralContractRepair.attempts[0],
  );
  refreshLedgerIntegrity(coherentlyRehashedEvidenceTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: coherentlyRehashedEvidenceTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
      authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
      expectedContext: auditContext,
    }).join(" "),
    /canonical evidence.*differs from durable garden sources/i,
    "coherent packet rehashing cannot replace evidence independently rebuilt from durable sources",
  );

  const fullyRehashedMetadataTamper = structuredClone(ledger);
  fullyRehashedMetadataTamper.attempts[0].packet.units[0].title = "Forged title";
  refreshExecutabilityAttemptHashes(fullyRehashedMetadataTamper.attempts[0]);
  refreshLedgerIntegrity(fullyRehashedMetadataTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: fullyRehashedMetadataTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /packet metadata.*differs from the final immutable unit/i,
  );

  const contextTamper = structuredClone(ledger);
  contextTamper.context.jobId = "different-job";
  contextTamper.context.model = "different-model";
  refreshLedgerIntegrity(contextTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: contextTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /packet metadata is stale/i,
  );

  const coherentContextTamper = structuredClone(ledger);
  coherentContextTamper.context.jobId = "forged-job";
  coherentContextTamper.context.model = "forged-model";
  coherentContextTamper.attempts[0].packet.auditContext =
    structuredClone(coherentContextTamper.context);
  refreshExecutabilityAttemptHashes(coherentContextTamper.attempts[0]);
  refreshLedgerIntegrity(coherentContextTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: coherentContextTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
      authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
      expectedContext: auditContext,
    }).join(" "),
    /context differs from the authoritative Learn run context/i,
  );

  const corruptStructuralAttempt = structuredClone(ledger);
  corruptStructuralAttempt.structuralContractRepair.attempts = [null];
  refreshLedgerIntegrity(corruptStructuralAttempt);
  assert.doesNotThrow(() => visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger: corruptStructuralAttempt,
    finalLearningUnits: routedUnits,
    visualizationPlan: placedPlan,
  }));
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: corruptStructuralAttempt,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /structural repair attempt 1 fields are invalid/i,
  );

  const corruptRejectionReason = structuredClone(ledger);
  corruptRejectionReason.attempts[0].rejectionReasons = [null];
  refreshLedgerIntegrity(corruptRejectionReason);
  assert.doesNotThrow(() => visualContractExecutabilityLinkageProblems({
    gardenId: GARDEN_ID,
    ledger: corruptRejectionReason,
    finalLearningUnits: routedUnits,
    visualizationPlan: placedPlan,
  }));
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: corruptRejectionReason,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /attempt 1 fields are invalid/i,
  );

  const chronologyTamper = structuredClone(ledger);
  chronologyTamper.attempts[0].completedAt =
    new Date(Date.parse(chronologyTamper.generatedAt) + 60_000).toISOString();
  refreshLedgerIntegrity(chronologyTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: chronologyTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /completes after ledger generation/i,
  );

  const acceptedStructuralReasonTamper = structuredClone(ledger);
  acceptedStructuralReasonTamper.structuralContractRepair.attempts[0].rejectionReasons = [
    "an accepted structural attempt cannot retain a rejection",
  ];
  refreshLedgerIntegrity(acceptedStructuralReasonTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: acceptedStructuralReasonTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /accepted structural repair attempt 1 contains rejection reasons/i,
  );

  const structuralBudgetTamper = structuredClone(ledger);
  structuralBudgetTamper.structuralContractRepair.attempts = [0, 1, 2, 3].map(
    (offset) => ({
      ...structuredClone(ledger.structuralContractRepair.attempts[0]),
      attempt: offset + 1,
      transportAccounting: {
        ...ledger.structuralContractRepair.attempts[0].transportAccounting,
        logicalSemanticCall: offset + 1,
      },
    }),
  );
  refreshLedgerIntegrity(structuralBudgetTamper);
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger: structuralBudgetTamper,
      finalLearningUnits: routedUnits,
      visualizationPlan: placedPlan,
    }).join(" "),
    /exceeds its three-call hard bound/i,
  );

  const malformedPlan = structuredClone(finalPlan);
  malformedPlan.opportunities = [null];
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger,
      finalLearningUnits: routedUnits,
      visualizationPlan: malformedPlan,
    }).join(" "),
    /opportunity 1 is malformed/i,
  );

  const driftedUnits = structuredClone(routedUnits);
  driftedUnits[1].interactiveVisualPlan.learnerAction = "A later unauthorized semantic rewrite.";
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger,
      finalLearningUnits: driftedUnits,
      visualizationPlan: finalPlan,
    }).join(" "),
    /finalRoutedContract differs|decision\.interaction differs/i,
  );

  const allocationDriftUnits = structuredClone(routedUnits);
  const allocationDriftPlan = structuredClone(finalPlan);
  allocationDriftUnits[1].interactiveVisualPlan.decision.reason = "A coherent later rewrite.";
  allocationDriftPlan.visualNecessityDecisions[1].reason = "A coherent later rewrite.";
  allocationDriftPlan.opportunities[0].necessityDecision.reason = "A coherent later rewrite.";
  assert.match(
    visualContractExecutabilityLinkageProblems({
      gardenId: GARDEN_ID,
      ledger,
      finalLearningUnits: allocationDriftUnits,
      visualizationPlan: allocationDriftPlan,
    }).join(" "),
    /allocation changed beyond|necessity-review counters differ from the ledger/i,
  );

  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), "executability-ledger-"));
  const root = path.join(tempParent, ".prediction-garden.incoming-1720000000000");
  fs.mkdirSync(root, { recursive: true });
  try {
    const breadboardDir = path.join(root, ".breadboard");
    fs.mkdirSync(path.join(breadboardDir, "planning"), { recursive: true });
    const contractPayload = `${JSON.stringify({ learningUnits: routedUnits }, null, 2)}\n`;
    fs.writeFileSync(
      path.join(breadboardDir, "learning-unit-contract.json"),
      contractPayload,
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "planning", "Learning Unit Contract.md"),
      renderAuthoritativeLearningUnitContractMarkdown({
        units: routedUnits,
        authoritativeSourceSha256: hashText(contractPayload),
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visualization-plan.json"),
      `${JSON.stringify(finalPlan, null, 2)}\n`,
      "utf8",
    );
    const supersededBy = {
      learningUnitContract: ".breadboard/learning-unit-contract.json",
      visualizationPlan: ".breadboard/visualization-plan.json",
      executabilityReviewLedger: ".breadboard/visual-contract-executability-reviews.json",
    };
    const generatedAt = "2026-08-15T00:00:00.000Z";
    const necessityArtifact = {
      schemaVersion: 1,
      gardenId: GARDEN_ID,
      generatedAt,
      artifactRole: "pre_executability_model_necessity_and_teaching_medium_source",
      interactionContractsAreAuthoritative: false,
      supersededBy,
      budget: structuredClone(ledger.authoritativePlanPolicy.visualBudget),
      decisions: ledger.immutableGardenAllocation.map((item) => ({
        ...structuredClone(item.decisionBeforeMechanicalRouting),
        ...(item.unitId === "U3"
          ? { interaction: structuredClone(units[1].interactiveVisualPlan.decision.interaction) }
          : {}),
      })),
      teachingMedia: ledger.immutableGardenAllocation.map((item) =>
        structuredClone(item.teachingMediumPlan)),
      overrides: structuredClone(ledger.authoritativePlanPolicy.visualDecisionOverrides),
      reviewCalls: ledger.authoritativePlanPolicy.necessityReviewCalls,
      rejectedReviews: ledger.authoritativePlanPolicy.rejectedNecessityReviews,
      decisionRecords: [],
    };
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(necessityArtifact, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-decision-records.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        gardenId: GARDEN_ID,
        generatedAt,
        artifactRole: necessityArtifact.artifactRole,
        interactionContractsAreAuthoritative: false,
        supersededBy,
        decisionRecords: [],
      }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.md"),
      "> Pre-executability necessity and teaching-medium source. Any interaction contract here is not authoritative after review. Use `.breadboard/learning-unit-contract.json`, `.breadboard/visualization-plan.json`, and `.breadboard/visual-contract-executability-reviews.json`.\n",
      "utf8",
    );
    const filePath = saveVisualContractExecutabilityLedger({ gardenDir: root, ledger });
    assert.deepEqual(
      visualContractExecutabilityLinkageProblems({
        gardenId: GARDEN_ID,
        ledger: loadVisualContractExecutabilityLedger(root),
        finalLearningUnits: routedUnits,
        visualizationPlan: finalPlan,
        requireGenerationPhase: true,
        authoritativeCanonicalEvidenceByUnit: EVIDENCE_BY_UNIT,
        expectedContext: auditContext,
      }),
      [],
      "a valid ledger links under an incoming directory whose basename is not the garden id",
    );
    assert.deepEqual(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger,
        finalLearningUnits: routedUnits,
      }),
      [],
    );
    const wholeVerification = verifyFinalArtifactNoMutation({
      gardenDir: root,
      gardenSlug: GARDEN_ID,
      updateRepairReport: false,
      strictModelApprovedVisuals: true,
      expectedVisualContractExecutabilityContext: auditContext,
    });
    assert.equal(
      wholeVerification.validationFailures.some((failure) =>
        /(?:ledger|visualization-plan) gardenId .*differs/i.test(failure)),
      false,
      "the whole strict verifier uses the explicit garden id inside an incoming directory",
    );
    assert.deepEqual(
      wholeVerification.validationFailures.filter((failure) =>
        /visualization-plan necessity decisions|opportunity necessityDecision|final visual-necessity allocation changed/i.test(failure)),
      [],
      "the strict finalizer preserves model-authored decision coverage and teaching-medium rationale through the persisted LUC",
    );
    const legacyLedger = structuredClone(ledger);
    legacyLedger.schemaVersion = 1;
    refreshLedgerIntegrity(legacyLedger);
    fs.writeFileSync(filePath, `${JSON.stringify(legacyLedger, null, 2)}\n`, "utf8");
    const legacyVerification = verifyFinalArtifactNoMutation({
      gardenDir: root,
      gardenSlug: GARDEN_ID,
      updateRepairReport: false,
      strictModelApprovedVisuals: true,
      expectedVisualContractExecutabilityContext: auditContext,
    });
    assert.match(
      legacyVerification.validationFailures.join(" "),
      /visual-contract executability review ledger is missing or invalid/i,
      "central finalization cannot bypass a coherently rehashed pre-v2 ledger",
    );
    saveVisualContractExecutabilityLedger({ gardenDir: root, ledger });
    const reversedNecessityArtifact = structuredClone(necessityArtifact);
    reversedNecessityArtifact.decisions.reverse();
    reversedNecessityArtifact.teachingMedia.reverse();
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(reversedNecessityArtifact, null, 2)}\n`,
      "utf8",
    );
    assert.deepEqual(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger,
        finalLearningUnits: routedUnits,
      }),
      [],
      "valid model-authored necessity and medium arrays remain order-independent",
    );
    const repairedNecessityDrift = structuredClone(necessityArtifact);
    repairedNecessityDrift.decisions[1].interaction.learnerAction =
      "An unexplained action that the structural repair request never saw.";
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(repairedNecessityDrift, null, 2)}\n`,
      "utf8",
    );
    assert.match(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger,
        finalLearningUnits: routedUnits,
      }).join(" "),
      /structural repair request does not exactly describe the original necessity interaction/i,
      "a structural replacement cannot hide drift in the original model-authored interaction",
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(necessityArtifact, null, 2)}\n`,
      "utf8",
    );
    const unrepairedNecessityArtifact = {
      ...structuredClone(necessityArtifact),
      decisions: unrepairedLedger.immutableGardenAllocation.map((item) => ({
        ...structuredClone(item.decisionBeforeMechanicalRouting),
        ...(item.unitId === "U3"
          ? { interaction: structuredClone(units[1].interactiveVisualPlan.decision.interaction) }
          : {}),
      })),
    };
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(unrepairedNecessityArtifact, null, 2)}\n`,
      "utf8",
    );
    assert.deepEqual(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger: unrepairedLedger,
        finalLearningUnits: routedUnits,
      }),
      [],
      "an unrepaired unit links its exact necessity interaction to beforeReviewContract",
    );
    unrepairedNecessityArtifact.decisions[1].interaction.learnerAction =
      "An unexplained pre-review rewrite.";
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(unrepairedNecessityArtifact, null, 2)}\n`,
      "utf8",
    );
    assert.match(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger: unrepairedLedger,
        finalLearningUnits: routedUnits,
      }).join(" "),
      /beforeReviewContract is not the exact unrepaired necessity interaction/i,
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(necessityArtifact, null, 2)}\n`,
      "utf8",
    );
    const staleNecessityArtifact = structuredClone(necessityArtifact);
    staleNecessityArtifact.artifactRole = "authoritative_final_interaction_contract";
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(staleNecessityArtifact, null, 2)}\n`,
      "utf8",
    );
    assert.match(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger,
        finalLearningUnits: routedUnits,
      }).join(" "),
      /role\/supersededBy marker is invalid/i,
    );
    fs.writeFileSync(
      path.join(breadboardDir, "visual-necessity-decisions.json"),
      `${JSON.stringify(necessityArtifact, null, 2)}\n`,
      "utf8",
    );
    fs.appendFileSync(
      path.join(breadboardDir, "planning", "Learning Unit Contract.md"),
      "stale content\n",
    );
    assert.match(
      visualContractExecutabilityArtifactProvenanceProblems({
        gardenDir: root,
        gardenId: GARDEN_ID,
        ledger,
        finalLearningUnits: routedUnits,
      }).join(" "),
      /not the exact final contract projection/i,
    );
    fs.writeFileSync(
      path.join(breadboardDir, "planning", "Learning Unit Contract.md"),
      renderAuthoritativeLearningUnitContractMarkdown({
        units: routedUnits,
        authoritativeSourceSha256: hashText(contractPayload),
      }),
      "utf8",
    );
    saveVisualContractExecutabilityLedger({ gardenDir: root, ledger });
    assert.equal(
      JSON.stringify(loadVisualContractExecutabilityLedger(root)),
      JSON.stringify(ledger),
    );
    const extraProvenanceField = structuredClone(ledger);
    extraProvenanceField.artifactProvenance.unexpected = true;
    refreshLedgerIntegrity(extraProvenanceField);
    fs.writeFileSync(filePath, `${JSON.stringify(extraProvenanceField, null, 2)}\n`, "utf8");
    assert.equal(
      loadVisualContractExecutabilityLedger(root),
      null,
      "strict loading rejects rehashed unexpected nested provenance fields",
    );
    const malformedPlanPolicy = structuredClone(ledger);
    malformedPlanPolicy.authoritativePlanPolicy.routeDecisions = [null];
    refreshLedgerIntegrity(malformedPlanPolicy);
    fs.writeFileSync(filePath, `${JSON.stringify(malformedPlanPolicy, null, 2)}\n`, "utf8");
    assert.equal(
      loadVisualContractExecutabilityLedger(root),
      null,
      "strict loading rejects malformed nested authoritative-plan records",
    );
    saveVisualContractExecutabilityLedger({ gardenDir: root, ledger });
    const payload = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(
      filePath,
      payload.replace("Commit-before-reveal is now explicit.", "Tampered reason."),
      "utf8",
    );
    assert.equal(loadVisualContractExecutabilityLedger(root), null);
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
});

test("zero active units make no reviewer call and the capability manifest is immutable/hash exact", async () => {
  const unit = inactiveUnit();
  let calls = 0;
  const result = await runVisualContractExecutabilityReview({
    gardenId: GARDEN_ID,
    learningUnits: [unit],
    canonicalEvidenceByUnit: {},
    provider: async () => {
      calls += 1;
      return {};
    },
    validateAll: (learningUnits) => learningUnits,
  });
  assert.equal(calls, 0);
  assert.equal(result.learningUnits[0], unit);
  assert.equal(Object.isFrozen(GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.palette), true);
  assert.throws(
    () => GENERATED_VISUAL_CAPABILITY_MANIFEST.scenes.spatial.palette.push("orange"),
    TypeError,
  );
  assert.equal(
    crypto.createHash("sha256")
      .update(JSON.stringify(GENERATED_VISUAL_CAPABILITY_MANIFEST))
      .digest("hex"),
    GENERATED_VISUAL_CAPABILITY_MANIFEST_HASH,
  );
});
