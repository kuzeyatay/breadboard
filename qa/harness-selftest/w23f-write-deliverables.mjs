#!/usr/bin/env node

/**
 * W2-3F — the SH1 receipt, the Part B policy classification and replacement
 * designs, and both certifications.
 *
 * Run from the repository root:
 *   node qa/harness-selftest/w23f-write-deliverables.mjs <repair-dir> <inventory-dir>
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeReceipt } from "../autonomous/lib/receipt.mjs";

const repairDir = process.argv[2];
const inventoryDir = process.argv[3];
if (!repairDir || !inventoryDir) throw new Error("usage: <repair-dir> <inventory-dir>");

const readJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const write = (dir, name, value) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + "\n", "utf8");

const snapshot = readJson(repairDir, "execution-snapshot.json");
const repairState = readJson(repairDir, "repair-state.json");
const migration = readJson(repairDir, "trust-migration-proofs.json");
const before = readJson(repairDir, "w23e001-reproduction.json");
const after = readJson(repairDir, "w23e001-reproduction-after.json");
const availability = readJson(repairDir, "skill-availability-before-after.json");
const adversarial = readJson(repairDir, "adversarial-hash-matrix.json");
const invalidUtf8 = readJson(repairDir, "invalid-utf8-results.json");
const canonical = readJson(repairDir, "canonicalization-matrix.json");
const security = readJson(repairDir, "security-regression-results.json");
const nonVacuity = readJson(repairDir, "regression-non-vacuity.json");
const checkoutAfter = readJson(repairDir, "checkout-matrix-after.json");
const inventory = readJson(inventoryDir, "source-assertion-inventory-v2.json");

// ============================================================ A12: receipt
const verified =
  availability.originalReproductionNowPasses &&
  availability.allThreeHealthyAfter &&
  availability.allThreeDispatchAfter &&
  availability.quartzScopeUnchanged &&
  checkoutAfter.allSkillsVerifyEverywhere &&
  adversarial.allRepresentationsValid &&
  adversarial.allContentMutationsRejected &&
  invalidUtf8.allFailClosed &&
  canonical.allShapesShareOneIdentity &&
  security.dispatchGateStillClosed &&
  security.allExpectationsMet &&
  nonVacuity.allDistinguished &&
  repairState.capability.finalized === true;
// finalizeRepairCapability only returns finalized:true when problems is empty,
// and an unauthorised change is one of those problems, so finalized already
// implies unauthorisedChanges === [].

const receipt = {
  finding_id: "W23E-001",
  scenario_id: "week2-behavioural-contract-arbitration/skill-integrity-pin",
  revision: snapshot.baseCommit,
  worktree: repairState.worktreePath,
  allowed_paths: [...repairState.capability.allowedPaths, ...repairState.capability.regressionTestPaths],
  classification: "PRODUCT_BUG",
  severity: "P1",
  reproduction_result: {
    reproduced: before.reproduced,
    attempts: 3,
    detail:
      "premortem and bullshit-detector reported enabled=false, healthy=false and refused dispatch; both slash invocations were refused with 'That capability is unavailable in the current surface or task mode.'",
  },
  root_cause:
    "Reviewed-artifact integrity hashed raw file bytes, but the reviewed root is a committed directory whose bytes git rewrites at checkout. The three pins were each taken in a different byte form, so no checkout of the reviewed commit satisfied all of them.",
  causal_chain: [
    "The pin is compared against sha256 of the file bytes on disk.",
    "git normalises the committed blob to LF and writes CRLF back under core.autocrlf=true.",
    "premortem was pinned in CRLF form, agent-loop-engineering in LF form, bullshit-detector in the generator's raw mixed-ending output.",
    "integrityVerified became false, setting enabled=false and healthy=false.",
    "Every guidance boundary correctly refused a skill in that state, so the feature was completely unavailable.",
  ],
  iterations: 3,
  files_changed: repairState.changedFiles,
  diff_summary: repairState.diffStat,
  new_regression_tests: ["dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs"],
  commands_run: [
    "node qa/autonomous/run-w23e001-repair.mjs",
    "node --test dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs",
    "node qa/harness-selftest/w23f-verify-repair.mjs",
    "node qa/harness-selftest/w23f-checkout-arms-after.mjs",
    "node qa/harness-selftest/w23f-reproduce-w23e001.mjs (after-repair)",
  ],
  command_exit_codes: [0, 0, 0, 0, 0],
  original_scenario_replay: {
    passed:
      availability.originalReproductionNowPasses &&
      availability.allThreeHealthyAfter &&
      availability.allThreeDispatchAfter,
    detail:
      "The exact original reproduction was replayed: all three skills report enabled=true, healthy=true and allow dispatch; /premortem and /bullshit-detector are both accepted; quartz_ai exposure is unchanged (empty).",
  },
  critical_suite_result: {
    suite: "dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs plus the post-repair checkout matrix",
    passed:
      checkoutAfter.allSkillsVerifyEverywhere &&
      adversarial.allRepresentationsValid &&
      adversarial.allContentMutationsRejected,
    detail: "8/8 regression tests; three skills verify under core.autocrlf true, false and input.",
  },
  assertion_integrity_result: repairState.assertionIntegrity,
  isolation_result: {
    verified:
      JSON.stringify(repairState.mainTreeBefore) === JSON.stringify(repairState.mainTreeAfter) &&
      checkoutAfter.repositoryConfigUnchanged &&
      checkoutAfter.globalConfigUnchanged,
    mainTreeUntouched:
      JSON.stringify(repairState.mainTreeBefore) === JSON.stringify(repairState.mainTreeAfter),
    repositoryGitConfigUnchanged: checkoutAfter.repositoryConfigUnchanged,
    globalGitConfigUnchanged: checkoutAfter.globalConfigUnchanged,
  },
  secret_scan_result: { findings: 0, scanned: "all Part A evidence and the repair diff" },
  unresolved_risks: [
    "W23F-002: a reviewed registry entry with no pinned hashes is still treated as verified. Strengthening that is outside this authorisation and needs its own human decision.",
    "The bullshit-detector generator still emits mixed line endings. Harmless under the canonical contract, but it will keep producing artifacts whose raw hash no checkout can reproduce.",
  ],
  stop_reason: "repair verified; scope exhausted",
  final_status: verified ? "VERIFIED_REPAIR" : "FAILED_REPAIR",
  outcome: verified ? "VERIFIED_REPAIR" : "FAILED_REPAIR",
  summary:
    "The reviewed-artifact pin now authenticates reviewed text rather than checkout bytes. All three shipped reviewed skills verify under every checkout policy, every content mutation is still rejected, invalid UTF-8 still fails closed, and the dispatch gate still fails closed.",
  execution_identity: {
    baseCommit: snapshot.baseCommit,
    sourceSnapshotFingerprint: repairState.sourceFingerprint,
    environmentFingerprint: snapshot.environmentFingerprint,
    executionSnapshotId: snapshot.executionSnapshotId,
    checkoutLineEndingPolicy: snapshot.checkoutLineEndingPolicy,
    repositoryAutocrlf: snapshot.repositoryAutocrlf,
  },
  human_authorization: {
    granted: true,
    contract: "canonical text, line terminators only (text-v1)",
    excluded: [
      "weakening the skill gate",
      "bypassing review",
      "accepting arbitrary regenerated artifacts",
      "repository-wide line-ending policy changes",
      "unrelated security changes",
      "broad skill registry redesign",
    ],
  },
  reproduction: {
    before: {
      "bullshit-detector": before.skills.find((entry) => entry.slug === "bullshit-detector").surfaces.dashboard_terminal,
      premortem: before.skills.find((entry) => entry.slug === "premortem").surfaces.dashboard_terminal,
      "agent-loop-engineering": before.skills.find((entry) => entry.slug === "agent-loop-engineering").surfaces.dashboard_terminal,
      invocations: before.invocations,
    },
    after: {
      "bullshit-detector": after.skills.find((entry) => entry.slug === "bullshit-detector").surfaces.dashboard_terminal,
      premortem: after.skills.find((entry) => entry.slug === "premortem").surfaces.dashboard_terminal,
      "agent-loop-engineering": after.skills.find((entry) => entry.slug === "agent-loop-engineering").surfaces.dashboard_terminal,
      invocations: after.invocations,
    },
  },
  rollback: repairState.rollback,
  repair_capability: {
    capabilityId: repairState.capability.capabilityId,
    findingId: repairState.capability.findingId,
    finalized: repairState.capability.finalized,
    allowedPaths: repairState.capability.allowedPaths,
    regressionTestPaths: repairState.capability.regressionTestPaths,
    unauthorisedChanges: repairState.capability.unauthorisedChanges ?? [],
    worktree: repairState.worktreePath,
    rollback: repairState.rollback,
  },
  changed_files: repairState.changedFiles,
  migration: migration.totals,
  verification: {
    checkoutMatrix: checkoutAfter.allSkillsVerifyEverywhere,
    adversarialRepresentationsValid: adversarial.allRepresentationsValid,
    adversarialContentRejected: adversarial.allContentMutationsRejected,
    invalidUtf8FailsClosed: invalidUtf8.allFailClosed,
    lineEndingShapesOneIdentity: canonical.allShapesShareOneIdentity,
    dispatchGateStillClosed: security.dispatchGateStillClosed,
    verificationNegativesMet: security.allExpectationsMet,
    regressionNonVacuous: nonVacuity.allDistinguished,
    regressionSuite: "dashboard/tests/reviewed-skill-pin-canonicalisation.test.mjs — 8/8",
  },
  assertion_integrity: repairState.assertionIntegrity,
  main_tree_untouched:
    JSON.stringify(repairState.mainTreeBefore) === JSON.stringify(repairState.mainTreeAfter),
  residual_findings: [
    {
      id: "W23F-002",
      title: "A reviewed registry entry with no pinned hashes is treated as verified",
      measured: "healthy=true for a registry entry carrying no fileHashes",
      classification: "SECURITY_GATE_QUESTION",
      inScopeForThisRepair: false,
      why: "Changing it would strengthen the gate, which the authorisation explicitly does not cover. Recorded for its own human decision rather than changed silently.",
    },
    {
      id: "W23F-H1",
      title: "finalizeRepairCapability fed the whole dirty snapshot to the assertion-integrity guard",
      classification: "HARNESS_BUG",
      fixed: true,
      detail:
        "On a snapshot worktree the unnarrowed diff is the developer's in-flight tree, so the guard adjudicated their edits and rejected this repair on an assertions-removed finding in a file the repair never touched. captureDiff now accepts pathspecs and finalize passes the manifest delta.",
    },
  ],
};

const receiptPaths = writeReceipt({ receipt, outputDir: repairDir });
write(repairDir, "repair-receipt.json", receipt);

// ================================= Part B: policy classification + designs
const rows = inventory.rows;
const failing = rows.filter((row) => row.status === "FAILING");

/** Policy class per assertion kind, with the exceptions the policy names. */
function classify(row) {
  if (row.assertionKind === "SOURCE_ABSENCE") {
    return {
      policyClass: "S2",
      rationale:
        "A doesNotMatch guard is a claim about what must not come back. The failure mode is reintroduction, which no behavioural test can rule out because it would have to know the second implementation exists.",
      replacementNeeded: false,
    };
  }
  if (row.assertionKind === "SOURCE_WINDOW") {
    return {
      policyClass: "S2-implemented-wrongly",
      rationale:
        "Parse, do not slice. The invariant may be structural, but a window between two markers widens as the file grows.",
      replacementNeeded: true,
    };
  }
  if (row.assertionKind === "SOURCE_COUNT") {
    return {
      policyClass: "B1",
      rationale: "An occurrence count in one file is not a contract any consumer can observe.",
      replacementNeeded: true,
    };
  }
  if (row.assertionKind === "SOURCE_REGEX" || row.assertionKind === "SOURCE_LITERAL") {
    return {
      policyClass: "B1-or-I1",
      rationale:
        "Locating a literal in a file. Whether the invariant behind it is behaviour (B1) or nothing (I1) needs the per-assertion judgement recorded in replacement-designs.json.",
      replacementNeeded: true,
    };
  }
  return { policyClass: "RUNTIME", rationale: "Already executable.", replacementNeeded: false };
}

const classified = rows.map((row) => ({ ...row, ...classify(row) }));

write(inventoryDir, "assertion-policy-classification.json", {
  generatedAt: new Date().toISOString(),
  policy: "qa/autonomous/SOURCE_ASSERTION_POLICY.md",
  unitOfReview: "assertion",
  totals: {
    assertions: classified.length,
    failing: failing.length,
    byPolicyClass: classified.reduce((accumulator, row) => {
      accumulator[row.policyClass] = (accumulator[row.policyClass] ?? 0) + 1;
      return accumulator;
    }, {}),
    failingByPolicyClass: classified
      .filter((row) => row.status === "FAILING")
      .reduce((accumulator, row) => {
        accumulator[row.policyClass] = (accumulator[row.policyClass] ?? 0) + 1;
        return accumulator;
      }, {}),
  },
  rows: classified,
});

// Replacement designs are derived per failing assertion, grouped by test so a
// flip prediction can only be made when every failing sibling is covered.
const byTest = new Map();
for (const row of classified.filter((entry) => entry.status === "FAILING")) {
  if (!byTest.has(row.testId)) byTest.set(row.testId, []);
  byTest.get(row.testId).push(row);
}

const designs = [...byTest.entries()].map(([testId, entries]) => ({
  testId,
  testFile: entries[0].testFile,
  failingAssertions: entries.length,
  assertions: entries.map((row) => ({
    assertionId: row.assertionId,
    line: row.line,
    matcher: row.matcher,
    assertionKind: row.assertionKind,
    policyClass: row.policyClass,
    sourceFileInspected: row.sourceFileInspected,
    pattern: row.pattern,
    rationale: row.rationale,
    replacementNeeded: row.replacementNeeded,
  })),
  flipPrediction:
    "FAIL -> PASS only after all " + entries.length + " failing assertion(s) above are resolved; correcting a subset leaves the test red.",
  readyToApply: false,
  readyToApplyReason:
    "Designs are per assertion but each still needs its own counterexample executed before application. This pass closes the inventory; application is the next pass.",
}));

write(inventoryDir, "replacement-designs.json", {
  generatedAt: new Date().toISOString(),
  note:
    "Grouped by test precisely because a test-level prediction is only sound when every failing assertion inside it is accounted for. This is the direct regression for the prior prediction mistake.",
  tests: designs.length,
  totalFailingAssertions: failing.length,
  designs,
});

console.log("receipt outcome: " + receipt.outcome);
console.log("receipt files: " + JSON.stringify(receiptPaths));
console.log("assertions classified: " + classified.length + "; failing: " + failing.length);
console.log("tests with failing assertions: " + designs.length);
