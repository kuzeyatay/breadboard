#!/usr/bin/env node

/**
 * W2-3 contract classification.
 *
 * Two evidence tiers, kept explicitly apart so the report cannot imply more
 * review than actually happened:
 *
 *   HIGH   the implementation was read and the intended contract established
 *   LOW    only mechanical evidence exists; recorded as UNRESOLVED_CONTRACT
 *
 * A LOW row is not a verdict. It is a statement that the failure is understood
 * well enough to be located but not well enough to say who is wrong, which is
 * the honest position for a test whose contract nobody has adjudicated yet.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const dir = path.resolve(arg("--dir", ""));

const inventory = JSON.parse(fs.readFileSync(path.join(dir, "dashboard-failure-inventory.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(dir, "contract-evidence.json"), "utf8"));
const evidenceByTest = new Map(evidence.rows.map((row) => [row.testId, row]));

const eligible = inventory.failures.filter(
  (failure) =>
    failure.verificationEligibility === "ELIGIBLE" &&
    failure.cascadeStatus === "INDEPENDENT_FAILURE",
);

const GENERATED_SKILL = /factcheck-integration|agent-loop-kit|aris-agent-integration|premortem-integration|diagram-design-skill/;
const VISUAL = /visual-decision-policy/;
const CAD = /parametric-cad/;

function classify(failure) {
  const found = evidenceByTest.get(failure.testId) ?? {};
  const base = {
    testId: failure.testId,
    testFile: failure.testFile,
    executionSnapshotId: failure.executionSnapshotId,
    verificationEligibility: "ELIGIBLE",
    failureSignature: failure.failureSignature.slice(0, 200),
    failureType: failure.failureType,
    assertion: found.assertedPattern ?? failure.assertionText.slice(0, 200),
    sourceFiles: found.assertedFiles ?? failure.sourceFilesReferenced ?? [],
    observedBehavior: null,
    expectedContract: null,
    contractEvidence: [],
    sourceContractKind: null,
    classification: null,
    rootCauseId: null,
    repairEligibility: false,
    recommendedAction: null,
    confidence: "LOW",
    notes: null,
  };

  if (GENERATED_SKILL.test(failure.testFile)) {
    return {
      ...base,
      observedBehavior:
        "The skill is not listed as ready/enabled, or its pinned hash does not match the shipped file.",
      expectedContract:
        "A reviewed skill ships as a generated SKILL.md under hermes-skills/prebuilt and is pinned by hash. An unbuilt or drifted artifact is disabled rather than shipped quietly.",
      contractEvidence: [
        "hermes-skills/prebuilt contains 21 skills; bullshit-detector, agent-loop-engineering and aris are absent entirely",
        "scripts/build-bullshit-detector-skill.mjs and scripts/build-diagram-design-skill.mjs exist as generators",
        "the source clones (bullshit-detector, agent-loop-engineering-kit, scientific-agent-skills, premortem, diagram-design) are present but gitignored",
        "the test's own comment states the registry pins the SKILL.md hash so that editing shipped guidance without re-review disables the skill",
      ],
      sourceContractKind: "REAL_CONTRACT",
      classification: "FIXTURE_BUG",
      rootCauseId: "ROOT-1-GENERATED-SKILL-ARTIFACT-MISSING",
      repairEligibility: false,
      recommendedAction:
        "Run the skill generators to produce the missing SKILL.md artifacts and re-pin their hashes. This is a build/product-data step, not an SH1 source repair, and it was deliberately NOT performed in this pass.",
      confidence: "HIGH",
      notes:
        "The hash-pin mechanism is working correctly: it disables an unbuilt or drifted skill. The failure is a missing generated input, not a defect in the mechanism.",
    };
  }

  if (VISUAL.test(failure.testFile)) {
    return {
      ...base,
      observedBehavior:
        "buildVisualizationPlan throws: contract validation failed, U1 missing model-authored learnerAction.",
      expectedContract:
        "UNRESOLVED. Either the visual contract legitimately tightened to require a model-authored learnerAction and the fixture is stale, or the validator over-rejects.",
      contractEvidence: [
        "the validator names the missing field explicitly rather than failing vaguely",
        "no schema note or migration establishing when learnerAction became mandatory was found in this pass",
      ],
      sourceContractKind: "REAL_CONTRACT",
      classification: "UNRESOLVED_CONTRACT",
      rootCauseId: "ROOT-2-VISUAL-CONTRACT-LEARNERACTION",
      recommendedAction:
        "Establish when learnerAction became required. If tightened deliberately the fixture is stale; if not the validator is over-strict. This governs what reaches implementation dispatch, so it should not be guessed.",
      confidence: "MEDIUM",
      notes: "Left unresolved deliberately rather than picked.",
    };
  }

  if (CAD.test(failure.testFile)) {
    return {
      ...base,
      observedBehavior: "A model exceeding the printer bed was not reported as an error.",
      expectedContract:
        "UNRESOLVED. This is one of the three cases that behave differently with and without the linked CAD clone.",
      contractEvidence: [
        "listed as LINKING_DAMAGE in the W2-2B two-arm experiment",
        "appears to become executable only once the CAD clone is linked",
      ],
      sourceContractKind: "UNCLEAR",
      classification: "UNRESOLVED_CONTRACT",
      rootCauseId: "ROOT-3-CAD-CLONE-EXECUTION",
      recommendedAction:
        "Carry as W2-2B blocker E-2. Determine whether this test previously 'passed' only because it never executed.",
      confidence: "LOW",
      notes: "Environment-sensitive rather than a clean eligible failure.",
    };
  }

  if (/vlm-ocr-figures/.test(failure.testFile)) {
    return {
      ...base,
      observedBehavior:
        "The ingest route no longer contains the literal `figureCount: vlmFigureCount`. It accumulates a mutable figureCount from vlm.figureCount and the anydoc conversion path, then persists it by shorthand.",
      expectedContract:
        "The ingest route saves figures as page assets and persists a count of them.",
      contractEvidence: [
        "dashboard/src/app/api/ingest/route.ts:783 defines vlmFigureSaver",
        "lines 1467 and 1565 pass saveFigure: vlmFigureSaver on both the PDF and single-image paths — the test's own assertion of exactly 2 occurrences still passes",
        "lines 1447, 1475 and 1578 assign figureCount from conversion.imagePaths.length and vlm.figureCount",
        "line 1959 persists figureCount",
      ],
      sourceContractKind: "IMPLEMENTATION_COUPLING",
      classification: "STALE_TEST",
      rootCauseId: "ROOT-5-FIGURECOUNT-VARIABLE-RENAME",
      recommendedAction:
        "Replace the literal `figureCount: vlmFigureCount` assertion with one pinning the surviving invariant: figureCount derived from vlm.figureCount and persisted. Not applied in this pass.",
      confidence: "HIGH",
      notes:
        "The behaviour is intact and now covers more paths than when the assertion was written; the assertion pinned a variable name.",
    };
  }

  const hint = found.evidenceHint;
  if (hint === "ALL_IDENTIFIERS_PRESENT_SHAPE_CHANGED" || hint === "PARTIAL_IDENTIFIERS_PRESENT") {
    return {
      ...base,
      observedBehavior:
        "The asserted identifiers still exist in the source; the surrounding syntax the regex pinned has changed.",
      expectedContract:
        "UNCLEAR without per-case review. The named behaviour appears intact, but whether the pinned shape encodes a real invariant was not established for this test.",
      contractEvidence: [
        `evidence hint: ${hint}`,
        `identifiers present: ${found.identifiersPresent ?? 0}`,
        `identifiers absent: ${JSON.stringify(found.identifiersAbsent ?? [])}`,
      ],
      sourceContractKind: "UNCLEAR",
      classification: "UNRESOLVED_CONTRACT",
      rootCauseId: "ROOT-4-SOURCE-SHAPE-DRIFT",
      recommendedAction:
        "Per-case review: decide whether the regex protects an externally meaningful invariant or freezes a technique. Do not relax the assertion before that decision.",
      confidence: "LOW",
      notes: "Classified at evidence tier only; individual contract review not completed in this pass.",
    };
  }

  if (hint === "IDENTIFIERS_ABSENT") {
    return {
      ...base,
      observedBehavior:
        "The asserted literal is absent from the files this test reads, though the same identifier exists elsewhere in dashboard/src.",
      expectedContract:
        "UNCLEAR. The wiring appears to have moved between modules; whether that relocation was intentional was not established.",
      contractEvidence: [
        `identifiers absent from the asserted files: ${JSON.stringify(found.identifiersAbsent ?? [])}`,
        "the same identifiers exist elsewhere in dashboard/src, so this is relocation rather than removal",
      ],
      sourceContractKind: "UNCLEAR",
      classification: "UNRESOLVED_CONTRACT",
      rootCauseId: "ROOT-6-WIRING-RELOCATED",
      recommendedAction:
        "Trace where the wiring moved and decide whether the test should follow it or whether the relocation broke an invariant.",
      confidence: "LOW",
      notes: "Classified at evidence tier only.",
    };
  }

  return {
    ...base,
    observedBehavior:
      "Failure recorded; the asserted file could not be resolved automatically, or the failure is not a source-text assertion.",
    expectedContract: "Not established in this pass.",
    contractEvidence: [`evidence hint: ${hint ?? failure.failureType}`],
    sourceContractKind: failure.failureType === "SOURCE_TEXT_REGEX" ? "UNCLEAR" : null,
    classification: "UNRESOLVED_CONTRACT",
    rootCauseId: "ROOT-7-UNREVIEWED",
    recommendedAction: "Individual contract review required.",
    confidence: "LOW",
    notes: "No contract determination attempted; recorded rather than guessed.",
  };
}

const rows = eligible.map(classify);

const classificationTotals = {};
const sourceContractKindTotals = {};
const rootCauseTotals = {};
const confidenceTotals = {};
for (const row of rows) {
  classificationTotals[row.classification] = (classificationTotals[row.classification] ?? 0) + 1;
  const kind = row.sourceContractKind ?? "n/a";
  sourceContractKindTotals[kind] = (sourceContractKindTotals[kind] ?? 0) + 1;
  rootCauseTotals[row.rootCauseId] = (rootCauseTotals[row.rootCauseId] ?? 0) + 1;
  confidenceTotals[row.confidence] = (confidenceTotals[row.confidence] ?? 0) + 1;
}

fs.writeFileSync(
  path.join(dir, "dashboard-contract-review.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      executionSnapshotId: inventory.executionSnapshot.executionSnapshotId,
      reviewed: rows.length,
      classificationTotals,
      sourceContractKindTotals,
      rootCauseTotals,
      confidenceTotals,
      evidenceStandardNote:
        "HIGH-confidence rows had their implementation read directly and their intended contract established. LOW-confidence rows carry mechanical evidence only and are recorded as UNRESOLVED_CONTRACT rather than guessed.",
      rows,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const clusters = Object.entries(rootCauseTotals)
  .map(([id, count]) => {
    const members = rows.filter((row) => row.rootCauseId === id);
    return {
      rootCauseId: id,
      affectedTests: count,
      classification: members[0].classification,
      sourceArea: [...new Set(members.map((member) => member.testFile))].slice(0, 10),
      primaryFailure: members[0].testId,
      secondaryFailures: members.slice(1).map((member) => member.testId),
      recommendedAction: members[0].recommendedAction,
      confidence: members[0].confidence,
    };
  })
  .sort((left, right) => right.affectedTests - left.affectedTests);

fs.writeFileSync(
  path.join(dir, "dashboard-root-causes.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), clusters }, null, 2)}\n`,
  "utf8",
);

console.log("classification totals:", JSON.stringify(classificationTotals));
console.log("sourceContractKind  :", JSON.stringify(sourceContractKindTotals));
console.log("confidence          :", JSON.stringify(confidenceTotals));
console.log("root clusters:");
for (const cluster of clusters) {
  console.log(`  ${String(cluster.affectedTests).padStart(3)}  ${cluster.rootCauseId}  [${cluster.confidence}]`);
}
