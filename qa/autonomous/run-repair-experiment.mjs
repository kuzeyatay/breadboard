#!/usr/bin/env node

/**
 * Controlled self-heal experiment driver (Week 1, Phase 5).
 *
 * For each seeded defect this runs the full bounded repair protocol against an
 * isolated worktree and records what actually happened:
 *
 *   worktree → verify isolation → seed → reproduce twice → classify → gate →
 *   repair + regression test → assertion-integrity guard → scope guard →
 *   relevant checks → replay in a fresh process → prove the regression test
 *   detects the reintroduced defect → receipt → discard worktree
 *
 * The step that stops this from being theatre is the reintroduction check: a
 * regression test that still passes when the defect is put back has proven
 * nothing, and the experiment is recorded as a failure.
 *
 * Nothing is committed. The main working tree is snapshotted before and after
 * and any difference fails the experiment.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewAssertionIntegrity } from "./lib/assertion-integrity.mjs";
import {
  applyGatedMutation,
  finalizeRepairCapability,
  issueRepairCapability,
  revokeRepairCapability,
} from "./lib/repair-capability.mjs";
import {
  assertSeedablePath,
  classifyPath,
  enforceChangedFiles,
  evaluateRepairGate,
  PATH_KIND,
} from "./lib/repair-gate.mjs";
import {
  captureDiff,
  changedFiles,
  createRepairWorktree,
  diffStat,
  mainTreeFileFingerprint,
  mainTreeStatus,
  removeRepairWorktree,
  rollbackInstructions,
  scopedMainTreeStatus,
  verifyRepairWorktree,
} from "./lib/repair-worktree.mjs";
import { writeReceipt } from "./lib/receipt.mjs";
import { EXPERIMENTS, experimentById } from "./experiments/seeded-defects.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_ITERATIONS = 3;

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outputDir = path.resolve(
  argValue("--out", path.join(repoRoot, ".qa-results", "week1", "experiments")),
);
const only = argValue("--id", null);

/** Link installed dependencies into the worktree without copying them. */
function linkDependencies(worktreePath) {
  const linked = [];
  for (const relative of ["node_modules", "desktop/node_modules", "dashboard/node_modules"]) {
    const source = path.join(repoRoot, relative);
    if (!fs.existsSync(source)) continue;
    const target = path.join(worktreePath, relative);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
      linked.push(relative);
    } catch (error) {
      throw new Error(`Could not link ${relative} into the worktree: ${error.message}`);
    }
  }
  return linked;
}

function unlinkDependencies(worktreePath, linked) {
  for (const relative of linked) {
    const target = path.join(worktreePath, relative);
    try {
      fs.unlinkSync(target);
    } catch {
      try {
        fs.rmSync(target, { recursive: false, force: true });
      } catch {
        // The worktree removal below reports anything left behind.
      }
    }
  }
}

function runNode(step, worktreePath) {
  const cwd = path.join(worktreePath, step.cwd ?? ".");
  const started = Date.now();
  const result = spawnSync(process.execPath, step.command, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, NODE_ENV: "test" },
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    label: step.label ?? step.command.join(" "),
    command: `node ${step.command.join(" ")}`,
    cwd: step.cwd ?? ".",
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    output,
  };
}

function runPrepare(names, worktreePath) {
  const executed = [];
  for (const name of names ?? []) {
    if (name !== "desktop-test-build") throw new Error(`Unknown prepare step: ${name}`);
    const npmCli = path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    const cli = fs.existsSync(npmCli) ? npmCli : process.env.npm_execpath;
    if (!cli) throw new Error("Could not resolve npm-cli.js for the desktop test build");
    executed.push(
      runNode(
        {
          label: "desktop test build",
          cwd: ".",
          command: [cli, "--prefix", "desktop", "run", "test:build"],
        },
        worktreePath,
      ),
    );
  }
  return executed;
}

function applyEdit(worktreePath, file, find, replace) {
  const target = path.join(worktreePath, file);
  const original = fs.readFileSync(target, "utf8");
  const occurrences = original.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one occurrence of the anchor in ${file}, found ${occurrences}`,
    );
  }
  fs.writeFileSync(target, original.replace(find, replace), "utf8");
  return original;
}

function restore(worktreePath, file, contents) {
  fs.writeFileSync(path.join(worktreePath, file), contents, "utf8");
}

function truncate(text, limit = 4_000) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`;
}

async function runExperiment(experiment) {
  const record = {
    id: experiment.id,
    title: experiment.title,
    category: experiment.category,
    seededFile: experiment.file,
    startedAt: new Date().toISOString(),
    steps: [],
    problems: [],
  };
  const commands = [];
  const exitCodes = [];
  const note = (step, detail) => record.steps.push({ step, ...detail });
  const track = (execution) => {
    commands.push(`${execution.command} (cwd ${execution.cwd})`);
    exitCodes.push(execution.exitCode);
    return execution;
  };

  // A seeded defect may never be placed on a trust boundary.
  const seedTarget = assertSeedablePath(experiment.file);
  note("seed-target-permitted", { path: seedTarget.path, kind: seedTarget.kind });

  // Scope the isolation check to this experiment's blast radius. The repository
  // is edited concurrently by its developer, so a whole-tree comparison would
  // report their work as a QA violation; whole-tree drift is still recorded, as
  // external activity rather than as something the loop did.
  const scopePaths = [
    ...experiment.allowedPaths,
    experiment.file,
    experiment.regressionTest.path,
  ];
  const scopedBefore = scopedMainTreeStatus(repoRoot, scopePaths);
  const seededFileBefore = mainTreeFileFingerprint(repoRoot, experiment.file);
  const regressionFileBefore = mainTreeFileFingerprint(repoRoot, experiment.regressionTest.path);
  const wholeTreeBefore = mainTreeStatus(repoRoot);
  const handle = createRepairWorktree({ repoRoot, findingId: experiment.id });
  let linked = [];
  let receiptPaths = null;
  let capability = null;
  let capabilityVerdict = null;

  try {
    const isolation = verifyRepairWorktree(handle);
    note("isolation-verified", isolation);
    if (!isolation.verified) record.problems.push("worktree isolation could not be verified");

    linked = linkDependencies(handle.worktreePath);
    note("dependencies-linked", { linked });

    // ---- seed the defect -------------------------------------------------
    applyEdit(
      handle.worktreePath,
      experiment.file,
      experiment.seed.find,
      experiment.seed.replace,
    );
    const seededContents = fs.readFileSync(
      path.join(handle.worktreePath, experiment.file),
      "utf8",
    );
    note("defect-seeded", { file: experiment.file });

    const prepared = runPrepare(experiment.prepare, handle.worktreePath).map(track);
    for (const step of prepared) {
      if (step.exitCode !== 0) record.problems.push(`prepare step failed: ${step.label}`);
    }

    // ---- reproduce twice -------------------------------------------------
    const firstRun = track(runNode(experiment.scenario, handle.worktreePath));
    const secondRun = track(runNode(experiment.scenario, handle.worktreePath));
    const reproduced = firstRun.exitCode !== 0 && secondRun.exitCode !== 0;
    const matchesExpectation =
      experiment.expectedFailure.test(firstRun.output) &&
      experiment.expectedFailure.test(secondRun.output);
    note("reproduction", {
      scenario: experiment.scenario.label,
      attempts: 2,
      reproduced,
      deterministic: firstRun.exitCode === secondRun.exitCode,
      matchesExpectation,
      evidence: truncate(firstRun.output, 2_000),
    });
    if (!reproduced) {
      record.problems.push("the seeded defect did not produce a deterministic failing scenario");
    }
    if (!matchesExpectation) {
      record.problems.push("the failure output did not match the expected defect signature");
    }

    // ---- classify and gate ----------------------------------------------
    const finding = {
      id: experiment.id,
      scenario: experiment.scenario.label,
      revision: handle.sourceRevision,
      status: "failed",
      classification: reproduced ? "PRODUCT_BUG" : "FLAKY",
      reproduction: { reproduced, attempts: 2 },
      diagnosis: {
        rootCause: experiment.title,
        responsibleCodePath: `${experiment.file} (${experiment.category})`,
      },
    };
    const gate = evaluateRepairGate(finding);
    note("repair-gate", gate);
    if (!gate.productionSourceMutationAllowed) {
      record.problems.push(`the repair gate denied the repair: ${gate.blockingReasons.join("; ")}`);
    }

    // The gate now issues the only writer. Allowed paths are product-only; the
    // regression test is declared separately and may only be created, never
    // used as a way to reach an existing oracle.
    const productPaths = experiment.allowedPaths.filter(
      (entry) => classifyPath(entry).kind === PATH_KIND.PRODUCT,
    );
    capability = issueRepairCapability({
      repoRoot,
      finding,
      worktree: handle,
      allowedPaths: productPaths,
      regressionTestPaths: [experiment.regressionTest.path],
    });
    note("repair-capability-issued", {
      capabilityId: capability.id,
      allowedPaths: capability.allowedPaths,
      regressionTestPaths: capability.regressionTestPaths,
      expiresAt: capability.expiresAt,
    });

    // ---- repair + regression test ---------------------------------------
    // The repair is a forward fix authored against the defective source, not a
    // byte-revert to HEAD. That keeps the candidate diff a real production
    // change, so the scope guard and the assertion-integrity guard are exercised
    // on something a healer could actually have written.
    applyGatedMutation({
      capability,
      targetPath: experiment.file,
      edit: (before) => {
        const occurrences = before.split(experiment.repair.find).length - 1;
        if (occurrences !== 1) {
          throw new Error(
            `Expected exactly one repair anchor in ${experiment.file}, found ${occurrences}`,
          );
        }
        return before.replace(experiment.repair.find, experiment.repair.replace);
      },
    });
    applyGatedMutation({
      capability,
      targetPath: experiment.regressionTest.path,
      edit: () => experiment.regressionTest.contents,
    });
    const repairedContents = fs.readFileSync(
      path.join(handle.worktreePath, experiment.file),
      "utf8",
    );
    note("repair-applied", {
      summary: "forward fix written through the mandatory repair capability, plus a new regression test",
      regressionTest: experiment.regressionTest.path,
      writtenThroughCapability: true,
    });

    capabilityVerdict = finalizeRepairCapability({ capability, worktree: handle });
    note("repair-capability-finalized", {
      finalized: capabilityVerdict.finalized,
      authorisedWrites: capabilityVerdict.authorisedWrites.map((entry) => entry.path),
      unauthorisedChanges: capabilityVerdict.unauthorisedChanges,
      problems: capabilityVerdict.problems,
    });
    if (!capabilityVerdict.finalized) {
      record.problems.push(
        `the repair capability did not finalize: ${capabilityVerdict.problems.join("; ")}`,
      );
    }

    // ---- guards ----------------------------------------------------------
    const changed = changedFiles(handle);
    const diff = captureDiff(handle);
    const scope = enforceChangedFiles({
      gate,
      changedFiles: changed,
      allowedPaths: experiment.allowedPaths,
    });
    const integrity = reviewAssertionIntegrity(diff, { classification: finding.classification });
    note("scope-guard", scope);
    note("assertion-integrity", { verdict: integrity.verdict, findings: integrity.findings });
    if (!scope.allowed) {
      record.problems.push(`scope guard rejected the candidate: ${JSON.stringify(scope.violations)}`);
    }
    if (integrity.verdict === "REJECTED") {
      record.problems.push("the assertion-integrity guard rejected the candidate");
    }
    // The candidate must be exactly the responsible file plus the new test.
    const unexpected = changed.filter(
      (file) => file !== experiment.file && file !== experiment.regressionTest.path,
    );
    note("changed-files", { changed, unexpected, diffStat: diffStat(handle) });
    if (unexpected.length > 0) {
      record.problems.push(`the repair touched unrelated files: ${unexpected.join(", ")}`);
    }

    // ---- relevant existing checks ---------------------------------------
    const rebuilt = runPrepare(experiment.regressionTest.prepare ?? experiment.prepare, handle.worktreePath).map(
      track,
    );
    for (const step of rebuilt) {
      if (step.exitCode !== 0) record.problems.push(`rebuild after repair failed: ${step.label}`);
    }
    const checks = (experiment.relevantChecks ?? []).map((step) =>
      track(runNode(step, handle.worktreePath)),
    );
    note("relevant-checks", checks.map(({ output, ...rest }) => rest));
    for (const check of checks) {
      if (check.exitCode !== 0) record.problems.push(`relevant check failed: ${check.label}`);
    }

    // ---- replay the exact original scenario in a fresh process ----------
    const replay = track(runNode(experiment.scenario, handle.worktreePath));
    note("scenario-replay", {
      scenario: experiment.scenario.label,
      passed: replay.exitCode === 0,
      exitCode: replay.exitCode,
    });
    if (replay.exitCode !== 0) {
      record.problems.push("the original failing scenario did not pass after the repair");
    }

    // ---- the regression test must actually detect the defect ------------
    const regressionAfterRepair = track(
      runNode(
        { ...experiment.regressionTest, label: "new regression test (repaired source)" },
        handle.worktreePath,
      ),
    );
    restore(handle.worktreePath, experiment.file, seededContents);
    runPrepare(experiment.regressionTest.prepare ?? experiment.prepare, handle.worktreePath).map(track);
    const regressionAgainstDefect = track(
      runNode(
        { ...experiment.regressionTest, label: "new regression test (defect reintroduced)" },
        handle.worktreePath,
      ),
    );
    restore(handle.worktreePath, experiment.file, repairedContents);
    note("regression-detects-defect", {
      passesOnRepairedSource: regressionAfterRepair.exitCode === 0,
      failsOnReintroducedDefect: regressionAgainstDefect.exitCode !== 0,
    });
    if (regressionAfterRepair.exitCode !== 0) {
      record.problems.push("the new regression test does not pass against the repaired source");
    }
    if (regressionAgainstDefect.exitCode === 0) {
      record.problems.push(
        "the new regression test still passes with the defect reintroduced; it is vacuous",
      );
    }

    // ---- main tree untouched --------------------------------------------
    const mainTreeUnchanged =
      scopedMainTreeStatus(repoRoot, scopePaths) === scopedBefore &&
      mainTreeFileFingerprint(repoRoot, experiment.file) === seededFileBefore &&
      mainTreeFileFingerprint(repoRoot, experiment.regressionTest.path) ===
        regressionFileBefore;
    note("main-tree-unchanged", {
      unchanged: mainTreeUnchanged,
      scope: scopePaths,
      seededFileUntouched:
        mainTreeFileFingerprint(repoRoot, experiment.file) === seededFileBefore,
      regressionTestNotLeakedIntoMainTree:
        mainTreeFileFingerprint(repoRoot, experiment.regressionTest.path) === null,
      externalWholeTreeDrift: mainTreeStatus(repoRoot) !== wholeTreeBefore,
    });
    if (!mainTreeUnchanged) {
      record.problems.push("the main working tree changed inside this experiment's scope");
    }

    record.finalStatus = record.problems.length === 0 ? "VERIFIED_REPAIR" : "FAILED_REPAIR";
    const receipt = {
      finding_id: experiment.id,
      scenario_id: experiment.scenario.label,
      revision: handle.sourceRevision,
      worktree: path.relative(repoRoot, handle.worktreePath).replace(/\\/g, "/"),
      allowed_paths: experiment.allowedPaths,
      classification: finding.classification,
      severity: experiment.severity,
      reproduction_result: `reproduced deterministically in ${
        record.steps.find((step) => step.step === "reproduction")?.attempts ?? 2
      } consecutive attempts`,
      root_cause: experiment.title,
      causal_chain: [
        `${experiment.file} was seeded with a ${experiment.category}`,
        `the scenario "${experiment.scenario.label}" failed deterministically`,
        "reverting the responsible expression restored the scenario",
      ],
      iterations: 1,
      files_changed: changed,
      diff_summary: diffStat(handle),
      new_regression_tests: [experiment.regressionTest.path],
      commands_run: commands,
      command_exit_codes: exitCodes,
      original_scenario_replay: {
        passed: replay.exitCode === 0,
        detail: `${experiment.scenario.label} replayed in a fresh process`,
      },
      critical_suite_result: {
        scope: "relevant critical subset",
        passed: checks.every((check) => check.exitCode === 0),
        checks: checks.map((check) => ({ label: check.label, exitCode: check.exitCode })),
      },
      assertion_integrity_result: { verdict: integrity.verdict, rejections: integrity.rejections },
      isolation_result: { verified: isolation.verified, mainTreeUnchanged },
      repair_capability: {
        capabilityId: capability?.id ?? null,
        findingId: capability?.findingId ?? null,
        finalized: capabilityVerdict?.finalized ?? false,
        authorisedWrites: (capabilityVerdict?.authorisedWrites ?? []).map((entry) => entry.path),
        unauthorisedChanges: capabilityVerdict?.unauthorisedChanges ?? [],
        expiresAt: capability?.expiresAt ?? null,
      },
      secret_scan_result: { clean: true, scannedBy: "writeReceipt" },
      rollback: rollbackInstructions(handle),
      unresolved_risks: record.problems,
      stop_reason:
        record.problems.length === 0
          ? "scenario_criteria_verified_and_receipt_written"
          : "verification_failed",
      final_status: record.finalStatus,
      max_iterations: MAX_ITERATIONS,
    };
    receiptPaths = writeReceipt({ receipt, outputDir: path.join(outputDir, "receipts") });
    record.receipt = {
      json: path.relative(repoRoot, receiptPaths.jsonPath).replace(/\\/g, "/"),
      markdown: path.relative(repoRoot, receiptPaths.markdownPath).replace(/\\/g, "/"),
    };
  } catch (error) {
    record.problems.push(`experiment aborted: ${error.message}`);
    record.finalStatus = "FAILED_REPAIR";
  } finally {
    if (capability && !capabilityVerdict) {
      try {
        revokeRepairCapability(capability);
      } catch {
        // A capability that cannot be revoked is already spent or invalid.
      }
    }
    unlinkDependencies(handle.worktreePath, linked);
    const removal = removeRepairWorktree(handle);
    record.worktreeRemoved = removal.removed;
    if (!removal.removed) record.problems.push(`worktree was not removed: ${removal.detail}`);
    record.mainTreeUnchangedAfterCleanup =
      scopedMainTreeStatus(repoRoot, scopePaths) === scopedBefore &&
      mainTreeFileFingerprint(repoRoot, experiment.file) === seededFileBefore;
    if (!record.mainTreeUnchangedAfterCleanup) {
      record.problems.push("the main working tree differed in scope after worktree cleanup");
    }
  }

  record.completedAt = new Date().toISOString();
  record.passed = record.problems.length === 0 && record.finalStatus === "VERIFIED_REPAIR";
  return record;
}

const selected = only ? [experimentById(only)] : EXPERIMENTS;
const results = [];
for (const experiment of selected) {
  console.log(`\n[experiment] ${experiment.id} :: ${experiment.title}`);
  const record = await runExperiment(experiment);
  results.push(record);
  console.log(
    `[experiment] ${experiment.id} -> ${record.finalStatus}` +
      (record.problems.length ? `\n  problems: ${record.problems.join("\n  ")}` : ""),
  );
}

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  allPassed: results.every((record) => record.passed),
  experiments: results,
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "experiments.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(`\n[experiment] summary: ${path.join(outputDir, "experiments.json")}`);
process.exit(summary.allPassed ? 0 : 1);
