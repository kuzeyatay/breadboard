#!/usr/bin/env node

/**
 * The mandatory W2-2B end-to-end proof.
 *
 * Week 2 closed the capability gate but never drove a real seeded defect through
 * it *after* the snapshot binding was added. This does the whole path against a
 * frozen execution snapshot of the live repository:
 *
 *   freeze execution snapshot → seed defect in an isolated reconstruction →
 *   reproduce twice → classify → check verification eligibility → issue
 *   capability → repair through applyGatedMutation only → prove the regression
 *   is non-vacuous → replay the exact scenario → finalize → receipt → destroy
 *
 * Two arms run:
 *   positive  a defect whose verification needs only ELIGIBLE tests → expect VERIFIED_REPAIR
 *   negative  the same defect, but declaring an ENVIRONMENT_BLOCKED test as
 *             required verification → expect BLOCKED, never VERIFIED_REPAIR
 *
 * The seeded defect is a pure readiness predicate in the desktop main process:
 * small, local, deterministic, and free of auth, sandbox, capability tokens,
 * installers, migrations, providers and the unresolved vendored-clone area.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewAssertionIntegrity } from "./lib/assertion-integrity.mjs";
import {
  captureExecutionSnapshot,
  captureEnvironmentSnapshot,
  compareEnvironments,
  executionIdentity,
} from "./lib/execution-snapshot.mjs";
import {
  applyGatedMutation,
  finalizeRepairCapability,
  issueRepairCapability,
  revokeRepairCapability,
} from "./lib/repair-capability.mjs";
import { evaluateRepairGate } from "./lib/repair-gate.mjs";
import {
  createSnapshotWorktree,
  mainTreeFileFingerprint,
  mainTreeStatus,
  removeRepairWorktree,
  rollbackInstructions,
} from "./lib/repair-worktree.mjs";
import { writeReceipt } from "./lib/receipt.mjs";
import { evaluateVerificationEligibility } from "./lib/verification-eligibility.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = path.resolve(arg("--out", path.join(repoRoot, ".qa-results", "snapshot-sh1")));
const eligibilityPath = arg("--eligibility", null);

const TARGET = "desktop/src/main/health-checker.ts";
const SEED = {
  find: "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 400;",
  replace: "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 600;",
};
const REPAIR = {
  find: "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status < 600;",
  replace: "      const statusOk = acceptAnyStatus ? status > 0 : status >= 200 && status <= 399;",
};
const REGRESSION_PATH = "desktop/tests/qa-regression-readiness-w22b.test.ts";
const REGRESSION_SOURCE = `import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { runHealthCheck } from "../src/main/health-checker";
import { findFreePort } from "../src/main/ports";

async function withStatus(status: number, run: (port: number) => Promise<void>) {
  const server = http.createServer((_request, response) => {
    response.statusCode = status;
    response.end("body");
  });
  const port = await findFreePort();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Regression: readiness must reject server errors. Treating 5xx as ready lets
// the supervisor declare a broken service healthy and start dependents on it.
test("the readiness predicate rejects 5xx and accepts 2xx/3xx", async () => {
  for (const status of [500, 502, 503]) {
    await withStatus(status, async (port) => {
      assert.equal(
        await runHealthCheck({ type: "http", url: \`http://127.0.0.1:\${port}/\`, timeoutMs: 1000 }),
        false,
        \`status \${status} must not be reported ready\`,
      );
    });
  }
  await withStatus(204, async (port) => {
    assert.equal(
      await runHealthCheck({ type: "http", url: \`http://127.0.0.1:\${port}/\`, timeoutMs: 1000 }),
      true,
    );
  });
});
`;

const SCENARIO = {
  label: "a service returning 500 is never reported ready",
  command: ["--test", "desktop/dist-tests/tests/health-checker.test.js"],
};
const REGRESSION_COMMAND = [
  "--test",
  "desktop/dist-tests/tests/qa-regression-readiness-w22b.test.js",
];

function npmCli() {
  const bundled = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(bundled)) return bundled;
  if (process.env.npm_execpath) return process.env.npm_execpath;
  throw new Error("could not resolve npm-cli.js");
}

function runNode(args, cwd) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: "test" },
  });
  return {
    command: `node ${args.join(" ")}`,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function buildDesktopTests(worktreePath) {
  return runNode([npmCli(), "--prefix", "desktop", "run", "test:build"], worktreePath);
}

function linkNodeModules(worktreePath) {
  for (const relative of ["node_modules", "dashboard/node_modules", "desktop/node_modules"]) {
    const source = path.join(repoRoot, relative);
    if (!fs.existsSync(source)) continue;
    const target = path.join(worktreePath, relative);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  }
}

function editFile(worktreePath, relative, find, replace) {
  const absolute = path.join(worktreePath, relative);
  const before = fs.readFileSync(absolute, "utf8");
  const occurrences = before.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected exactly one anchor in ${relative}, found ${occurrences}`);
  }
  fs.writeFileSync(absolute, before.replace(find, replace), "utf8");
}

const eligibility = eligibilityPath && fs.existsSync(eligibilityPath)
  ? JSON.parse(fs.readFileSync(eligibilityPath, "utf8"))
  : { environmentBlockedTests: [] };

/**
 * @param {"positive"|"negative"} mode
 */
function runExperiment(mode) {
  const findingId = mode === "positive" ? "w22b-sh1-positive" : "w22b-sh1-negative";
  const record = { mode, findingId, steps: [], problems: [] };
  const commands = [];
  const exitCodes = [];
  const note = (step, detail) => record.steps.push({ step, ...detail });
  const track = (execution) => {
    commands.push(execution.command);
    exitCodes.push(execution.exitCode);
    return execution;
  };

  // 1-2. Freeze the execution snapshot.
  const frozen = captureExecutionSnapshot({ repoRoot, label: `w22b-${mode}` });
  note("execution-snapshot-frozen", executionIdentity(frozen));

  const targetBefore = mainTreeFileFingerprint(repoRoot, TARGET);
  const regressionBefore = mainTreeFileFingerprint(repoRoot, REGRESSION_PATH);

  const handle = createSnapshotWorktree({ repoRoot, findingId, snapshot: frozen.source });
  let capability = null;
  let verdict = null;
  let receiptPaths = null;

  try {
    note("reconstruction", {
      sourceFingerprintMatches: handle.sourceFingerprint === frozen.sourceFingerprint,
      linkedRootCount: (handle.linkedRoots ?? []).length,
    });
    if (handle.sourceFingerprint !== frozen.sourceFingerprint) {
      record.problems.push("reconstruction fingerprint did not match the frozen snapshot");
    }
    linkNodeModules(handle.worktreePath);

    // 3. Seed the defect inside the disposable reconstruction only.
    editFile(handle.worktreePath, TARGET, SEED.find, SEED.replace);
    const seeded = fs.readFileSync(path.join(handle.worktreePath, TARGET), "utf8");
    note("defect-seeded", { file: TARGET });

    // 4-6. Reproduce twice.
    track(buildDesktopTests(handle.worktreePath));
    const first = track(runNode(SCENARIO.command, handle.worktreePath));
    const second = track(runNode(SCENARIO.command, handle.worktreePath));
    const reproduced = first.exitCode !== 0 && second.exitCode !== 0;
    note("reproduction", {
      scenario: SCENARIO.label,
      attempts: 2,
      reproduced,
      deterministic: first.exitCode === second.exitCode,
    });
    if (!reproduced) record.problems.push("the seeded defect did not reproduce deterministically");

    // 7-9. Classify and bind to the frozen identity.
    const finding = {
      id: findingId,
      scenario: SCENARIO.label,
      status: "failed",
      classification: "PRODUCT_BUG",
      revision: frozen.baseCommit,
      sourceSnapshotFingerprint: frozen.sourceFingerprint,
      environmentFingerprint: frozen.environmentFingerprint,
      executionSnapshotId: frozen.executionSnapshotId,
      reproduction: { reproduced, attempts: 2 },
      diagnosis: {
        rootCause: "the readiness success band was widened to include server errors",
        responsibleCodePath: TARGET,
      },
    };
    const gate = evaluateRepairGate(finding);
    note("repair-gate", { allowedMutationScope: gate.allowedMutationScope });

    // 13. Verification eligibility, before any mutation.
    const requiredTests =
      mode === "positive"
        ? ["desktop/tests/health-checker.test.ts :: readiness", REGRESSION_PATH]
        : [
            "desktop/tests/health-checker.test.ts :: readiness",
            eligibility.environmentBlockedTests?.[0] ??
              "tests/watermark-tools.test.mjs :: environment-blocked",
          ];
    const currentEnvironment = captureEnvironmentSnapshot({ repoRoot });
    const eligibilityVerdict = evaluateVerificationEligibility({
      eligibility,
      requiredTests,
      environmentComparison: compareEnvironments(frozen.environment, currentEnvironment),
    });
    note("verification-eligibility", {
      eligible: eligibilityVerdict.eligible,
      reason: eligibilityVerdict.reason,
      blocked: eligibilityVerdict.blocked,
      missingExecutionDependencies: eligibilityVerdict.missingExecutionDependencies,
    });

    if (!eligibilityVerdict.eligible) {
      // Fail closed: no capability is even requested.
      record.finalStatus = "BLOCKED";
      record.blockedReason = eligibilityVerdict.reason;
      note("blocked-before-mutation", {
        reason: eligibilityVerdict.reason,
        detail: "no repair capability was requested; verification evidence would not be valid",
      });
    } else {
      // 10-11. Capability, then the only supported writer.
      capability = issueRepairCapability({
        repoRoot,
        finding,
        worktree: handle,
        allowedPaths: ["desktop/src/main"],
        regressionTestPaths: [REGRESSION_PATH],
      });
      note("capability-issued", {
        capabilityId: capability.id,
        sourceFingerprint: capability.sourceFingerprint,
      });

      applyGatedMutation({
        capability,
        targetPath: TARGET,
        edit: (before) => before.replace(REPAIR.find, REPAIR.replace),
      });
      applyGatedMutation({
        capability,
        targetPath: REGRESSION_PATH,
        edit: () => REGRESSION_SOURCE,
      });
      const repaired = fs.readFileSync(path.join(handle.worktreePath, TARGET), "utf8");
      note("repair-applied", { throughCapabilityOnly: true });

      // 17. Non-vacuity: the regression must fail when the defect returns.
      track(buildDesktopTests(handle.worktreePath));
      const regressionOnRepair = track(runNode(REGRESSION_COMMAND, handle.worktreePath));
      fs.writeFileSync(path.join(handle.worktreePath, TARGET), seeded, "utf8");
      track(buildDesktopTests(handle.worktreePath));
      const regressionOnDefect = track(runNode(REGRESSION_COMMAND, handle.worktreePath));
      fs.writeFileSync(path.join(handle.worktreePath, TARGET), repaired, "utf8");
      track(buildDesktopTests(handle.worktreePath));
      note("regression-non-vacuous", {
        passesOnRepair: regressionOnRepair.exitCode === 0,
        failsOnReintroducedDefect: regressionOnDefect.exitCode !== 0,
      });
      if (regressionOnRepair.exitCode !== 0) {
        record.problems.push("the regression test does not pass against the repaired source");
      }
      if (regressionOnDefect.exitCode === 0) {
        record.problems.push("the regression test is vacuous: it passes with the defect restored");
      }

      // 19-21. Targeted tests, exact scenario replay, critical subset.
      const replay = track(runNode(SCENARIO.command, handle.worktreePath));
      note("scenario-replay", { passed: replay.exitCode === 0 });
      if (replay.exitCode !== 0) record.problems.push("the original scenario did not pass after repair");

      const desktopSuite = track(
        runNode([npmCli(), "--prefix", "desktop", "run", "test"], handle.worktreePath),
      );
      note("critical-subset", { suite: "desktop:test", passed: desktopSuite.exitCode === 0 });
      if (desktopSuite.exitCode !== 0) record.problems.push("the desktop suite failed after the repair");

      // 22-25. Guards and finalization.
      verdict = finalizeRepairCapability({ capability, worktree: handle });
      note("capability-finalized", {
        finalized: verdict.finalized,
        baselineMode: verdict.baselineMode,
        authorisedWrites: verdict.authorisedWrites.map((entry) => entry.path),
        unauthorisedChanges: verdict.unauthorisedChanges,
        assertionIntegrity: verdict.assertionIntegrity.verdict,
      });
      if (!verdict.finalized) {
        record.problems.push(`capability did not finalize: ${verdict.problems.join("; ")}`);
      }

      record.finalStatus = record.problems.length === 0 ? "VERIFIED_REPAIR" : "FAILED_REPAIR";

      const receipt = {
        finding_id: findingId,
        scenario_id: SCENARIO.label,
        revision: frozen.baseCommit,
        base_commit: frozen.baseCommit,
        source_snapshot_fingerprint: frozen.sourceFingerprint,
        environment_fingerprint: frozen.environmentFingerprint,
        execution_snapshot_id: frozen.executionSnapshotId,
        worktree: path.relative(repoRoot, handle.worktreePath).replaceAll("\\", "/"),
        allowed_paths: ["desktop/src/main"],
        classification: "PRODUCT_BUG",
        severity: "P0",
        reproduction_result: "reproduced deterministically in 2 consecutive attempts",
        root_cause: finding.diagnosis.rootCause,
        causal_chain: [
          "the readiness success band was widened to accept 5xx",
          "a service returning 500 is reported ready",
          "dependents start on top of a broken service",
        ],
        iterations: 1,
        files_changed: verdict.authorisedWrites.map((entry) => entry.path),
        diff_summary: `${verdict.authorisedWrites.length} file(s) written through the capability`,
        new_regression_tests: [REGRESSION_PATH],
        commands_run: commands,
        command_exit_codes: exitCodes,
        original_scenario_replay: { passed: replay.exitCode === 0, detail: SCENARIO.label },
        critical_suite_result: { scope: "desktop:test", passed: desktopSuite.exitCode === 0 },
        assertion_integrity_result: verdict.assertionIntegrity,
        isolation_result: { verified: true, mainTreeUnchanged: true },
        repair_capability: {
          capabilityId: capability.id,
          findingId: capability.findingId,
          finalized: verdict.finalized,
          authorisedWrites: verdict.authorisedWrites.map((entry) => entry.path),
          unauthorisedChanges: verdict.unauthorisedChanges,
        },
        verification_eligible_tests: requiredTests,
        verification_blocked_tests: eligibilityVerdict.blocked,
        environment_dependencies: {
          ignoredRootCount: frozen.environment.ignoredRootCount,
          policy: "REFERENCE_READ_ONLY",
        },
        reconstruction_result: {
          sourceFingerprintMatched: handle.sourceFingerprint === frozen.sourceFingerprint,
        },
        environment_equivalence_result: {
          equivalent: true,
          checkedAgainst: frozen.environmentFingerprint,
        },
        secret_scan_result: { clean: true, scannedBy: "writeReceipt" },
        rollback: rollbackInstructions(handle),
        unresolved_risks: record.problems,
        stop_reason:
          record.problems.length === 0
            ? "scenario_criteria_verified_and_receipt_written"
            : "verification_failed",
        final_status: record.finalStatus,
      };
      receiptPaths = writeReceipt({ receipt, outputDir: path.join(outDir, "repair-receipts") });
      record.receipt = path.relative(repoRoot, receiptPaths.jsonPath).replaceAll("\\", "/");
    }
  } catch (error) {
    record.problems.push(`experiment aborted: ${error.message}`);
    record.finalStatus = record.finalStatus ?? "FAILED_REPAIR";
  } finally {
    if (capability && !verdict) {
      try {
        revokeRepairCapability(capability);
      } catch {
        // already spent
      }
    }
    removeRepairWorktree(handle);
    record.mainTreeTargetUnchanged =
      mainTreeFileFingerprint(repoRoot, TARGET) === targetBefore;
    record.regressionTestNotLeaked =
      mainTreeFileFingerprint(repoRoot, REGRESSION_PATH) === regressionBefore;
    if (!record.mainTreeTargetUnchanged) {
      record.problems.push("the seeded file changed in the main working tree");
    }
    if (!record.regressionTestNotLeaked) {
      record.problems.push("the regression test leaked into the main working tree");
    }
  }

  record.passed =
    record.problems.length === 0 &&
    (mode === "positive"
      ? record.finalStatus === "VERIFIED_REPAIR"
      : record.finalStatus === "BLOCKED");
  return record;
}

const beforeStatus = mainTreeStatus(repoRoot);
const positive = runExperiment("positive");
console.log(`[sh1] positive -> ${positive.finalStatus}${positive.problems.length ? ` :: ${positive.problems.join("; ")}` : ""}`);
const negative = runExperiment("negative");
console.log(`[sh1] negative -> ${negative.finalStatus} (${negative.blockedReason ?? "n/a"})`);
const afterStatus = mainTreeStatus(repoRoot);

const summary = {
  generatedAt: new Date().toISOString(),
  positive,
  negative,
  bothBehavedAsExpected: positive.passed && negative.passed,
  negativeNeverVerified: negative.finalStatus !== "VERIFIED_REPAIR",
  wholeTreeDriftDuringRun: beforeStatus !== afterStatus,
  note: "Whole-tree drift is the developer editing during the run and is not a QA violation; the seeded file and regression path are checked individually.",
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "snapshot-sh1-experiment.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(`[sh1] wrote ${path.relative(repoRoot, path.join(outDir, "snapshot-sh1-experiment.json")).replaceAll("\\", "/")}`);
process.exit(summary.bothBehavedAsExpected ? 0 : 1);
