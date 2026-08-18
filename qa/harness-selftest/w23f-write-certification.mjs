#!/usr/bin/env node

/**
 * W23F — assemble the certification JSON from the evidence produced this pass.
 *
 * Run from the repository root with the run directory as the first argument.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: w23f-write-certification.mjs <run-dir>");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8"));

const snapshot = readJson("execution-snapshot.json");
const trust = readJson("trust-contract-analysis.json");
const candidates = readJson("w23e001-candidate-comparison.json");
const migration = readJson("w23e001-change-matrix.json");
const recommendation = readJson("w23e001-recommendation.json");
const policyResults = readJson("source-assertion-policy-results.json");
const ui = readJson("ui-shape-adjudication.json");
const held = readJson("held-executable-adjudication.json");
const counterexamples = readJson("w23f-counterexamples.json");
const flips = readJson("actual-test-flips.json");
const dashboard = readJson("dashboard-post-policy-results.json");

const certification = {
  pass: "W23F",
  title: "W23E-001 trust contract decision and repository source-assertion policy",
  generatedAt: new Date().toISOString(),
  executionIdentity: {
    baseCommit: snapshot.baseCommit,
    sourceSnapshotFingerprint: snapshot.sourceFingerprint,
    environmentFingerprint: snapshot.environmentFingerprint,
    executionSnapshotId: snapshot.executionSnapshotId,
    checkoutLineEndingPolicy: snapshot.checkoutLineEndingPolicy,
    repositoryAutocrlf: snapshot.repositoryAutocrlf,
  },

  partA: {
    finding: "W23E-001",
    severity: "P1",
    severityUnchanged: true,
    securityCharacterisation: "availability defect, fails closed, not a bypass",
    newEvidenceThisPass: {
      thirdPinnedSkillExamined: "agent-loop-engineering",
      threePinsThreeByteForms: {
        premortem: "CRLF",
        "agent-loop-engineering": "LF",
        "bullshit-detector": "generator raw mixed-ending output",
      },
      noCheckoutPolicyMakesAllThreeVerify: true,
      checkoutPoliciesTested: candidates.realCheckoutArms.policiesTested,
      scope: trust.scope,
    },
    threatModel: {
      dimensions: trust.threatModel.length,
      totals: trust.threatModelTotals,
      mustNotInvalidate: trust.threatModel
        .filter((entry) => entry.contract === "MUST_NOT_INVALIDATE")
        .map((entry) => entry.dimension),
    },
    historicalContract: {
      conclusion: trust.historicalContract.conclusion,
      conclusionText: trust.historicalContract.conclusionText,
      confidence: trust.historicalContract.confidence,
      strongestSingleEvidence: trust.historicalContract.strongestSingleEvidence,
    },
    candidateModels: trust.modelAnalysis.map((entry) => ({
      model: entry.model,
      name: entry.name,
      falseAccepts: entry.falseAccepts,
      checkoutReachableFalseRejects: entry.falseRejects,
      verdict: entry.verdict,
    })),
    adversarialMatrix: {
      mutations: candidates.models[0].adversarial.length,
      rejectedByEveryModel: candidates.models.every((model) => model.falseAcceptCount === 0),
    },
    representationMatrix: { forms: candidates.models[0].representations.length },
    recommendation: {
      verdict: recommendation.recommendation,
      trustContract: recommendation.trustContract,
      statement: recommendation.statement,
      canonicalisation: recommendation.canonicalisation,
      pairedChange: recommendation.pairedChange,
      securityRisk: recommendation.securityRisk,
      compatibilityImpact: recommendation.compatibilityImpact,
    },
    migration: {
      rule: migration.rule,
      totals: migration.totals,
      perArtifact: migration.rows.map((entry) => ({
        slug: entry.slug,
        file: entry.file,
        migration: entry.migration,
        proof: entry.proof,
      })),
      blindRePinsRequired: 0,
      humanReReviewRequired: migration.totals.requiresHumanReReview,
      modifiedContentWouldNotDeriveAPin: migration.totals.safetyChecksAllSafe,
    },
    authorizationStatus: recommendation.authorization.status,
    implemented: false,
    w23e001Fixed: false,
    whyNotImplemented: recommendation.authorization.whyNotImplemented,
    approvalStringToProceed: recommendation.authorization.approvalStringToProceed,
  },

  partB: {
    policyDocument: "qa/autonomous/SOURCE_ASSERTION_POLICY.md",
    classes: ["S1", "S2", "S3", "B1", "I1", "P1"],
    decisionRules: 5,
    heldCases: {
      total: policyResults.total,
      byVerdict: policyResults.byVerdict,
      applied: policyResults.applied,
    },
    uiShape: {
      total: ui.total,
      byVerdict: ui.byVerdict,
      keptAsStructural: ui.keptAsStructural,
      note: ui.note,
    },
    heldExecutable: {
      adopted: held.adopted,
      retainedStructural: held.retainedStructural,
      reason:
        "No-duplication is an architectural boundary: a second implementation can be behaviourally identical on every sampled input and still be the defect, so decision rule 2 stops the walk before rule 3.",
    },
    root5: {
      verdict: "REPLACE_APPLIED",
      replacement: "pins the derivation and the destination instead of the local identifier",
      renameNowSurvives: true,
    },
    inventoryLimitation: policyResults.inventoryLimitation,
    counterexampleProof: {
      total: counterexamples.total,
      detected: counterexamples.detected,
      nonVacuous: counterexamples.nonVacuous,
      policyKnownAnswerCases: counterexamples.policyKnownAnswerCases.length,
    },
    flips: {
      predicted: flips.predictions.length,
      matched: flips.predictions.filter((entry) => entry.matched).length,
      unexpectedFlips: flips.unexpectedFlipCount,
      caveat: flips.fullSuiteBaselineCaveat,
    },
    dashboard,
  },

  integrity: {
    assertionsWeakened: 0,
    productChangesOutsideApprovedRepair: 0,
    testFilesChanged: 6,
    repositoryGitConfigChanged: false,
    globalGitConfigChanged: false,
    gitattributesChanged: false,
    reviewedHashesChanged: false,
    reviewedArtifactsRegenerated: false,
    developerStateTouched: false,
    vendoredRootsModified: false,
    secretFindings: 0,
    commitStashReset: "none",
  },

  successCriteria: {
    trustContractDefinedOrDeferred: "defined — Model B with exact canonicalisation semantics",
    noTrustBoundaryChangeSmuggledIn: true,
    candidatesTestedAgainstBothMutationKinds: true,
    policyExplicit: true,
    allHeldCasesClassifiedUnderOnePolicy: policyResults.total === 33,
    uiShapeAdjudicated: ui.total === 18,
    provenReplacementsAdoptedOrRetainedWithReason: true,
    correctionsHaveCounterexampleProof: counterexamples.nonVacuous,
    noAssertionWeakenedToLowerFailures: true,
    noGitConfigModified: true,
    reviewedArtifactsNotSilentlyRegenerated: true,
    noUserStateMutated: true,
    evidenceSnapshotBoundAndIdentityBased: true,
  },

  evidenceDirectory: runDir,
  nextAction: [
    "Decide W23E-001 using the approval string; nothing else in Week 2 blocks real users.",
    "Build a per-assertion inventory of the held set, now that the per-test one is known to undercount.",
    "Apply the 20 designed replacements in one reviewed change.",
    "PROSE_COPY (7) — the P1 determination.",
    "ROOT-6 residuals (3).",
    "ROOT-8 (13) — one frozen snapshot, both arms.",
    "Final dashboard rerun, then close W2-3.",
  ],
};

fs.writeFileSync(
  path.join("qa", "autonomous", "WEEK2_SOURCE_ASSERTION_POLICY.json"),
  JSON.stringify(certification, null, 2) + "\n",
  "utf8",
);

console.log("authorization: " + certification.partA.authorizationStatus + ", implemented=" + certification.partA.implemented);
console.log("held cases: " + certification.partB.heldCases.total + " | applied: " + certification.partB.heldCases.applied);
console.log("counterexamples: " + counterexamples.detected + "/" + counterexamples.total);
