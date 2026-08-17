#!/usr/bin/env node

/**
 * Assemble `qa/autonomous/WEEK1_QA_CERTIFICATION.json` from the actual run
 * evidence rather than from prose. Anything this script cannot find in an
 * evidence file is emitted as `null`, so a missing result reads as missing
 * instead of as a pass.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const runId = arg("--run", fs.readFileSync(path.join(repoRoot, ".qa-results", "week1", "CURRENT_RUN_ID"), "utf8").trim());
const runDir = path.join(repoRoot, ".qa-results", "week1", runId);

const readJson = (relative) => {
  const target = path.join(runDir, relative);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
};

const baseline = readJson("baseline.json");
const injected = readJson("injected/injected-fault-report.json");
const experiments = readJson("experiments/experiments.json");
const burnIn = readJson("burn-in/burn-in.json");
const selftest = readJson("selftest/selftest-summary.json");
const decision = readJson("decision.json") ?? {};

const experimentRows = (experiments?.experiments ?? []).map((entry) => {
  const step = (name) => entry.steps.find((item) => item.step === name) ?? {};
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    seededFile: entry.seededFile,
    reproduced: step("reproduction").reproduced ?? null,
    deterministic: step("reproduction").deterministic ?? null,
    classification: step("repair-gate").classification ?? null,
    gateScope: step("repair-gate").allowedMutationScope ?? null,
    scopeGuardVerdict: step("scope-guard").verdict ?? null,
    assertionIntegrityVerdict: step("assertion-integrity").verdict ?? null,
    filesChanged: step("changed-files").changed ?? null,
    unrelatedFilesChanged: step("changed-files").unexpected ?? null,
    scenarioReplayPassed: step("scenario-replay").passed ?? null,
    regressionDetectsDefect: step("regression-detects-defect").failsOnReintroducedDefect ?? null,
    regressionPassesOnRepair: step("regression-detects-defect").passesOnRepairedSource ?? null,
    mainTreeUnchanged: step("main-tree-unchanged").unchanged ?? null,
    worktreeRemoved: entry.worktreeRemoved ?? null,
    finalStatus: entry.finalStatus ?? null,
    receipt: entry.receipt ?? null,
  };
});

const certification = {
  schemaVersion: 1,
  document: "Breadboard QA Week 1 Certification",
  generatedAt: new Date().toISOString(),
  runId,
  evidenceRoot: path.relative(repoRoot, runDir).replace(/\\/g, "/"),
  revision: baseline?.revision ?? null,
  environment: baseline?.environment ?? null,
  baseline: baseline
    ? { suites: baseline.suites, notRun: baseline.notRunAtBaseline }
    : null,
  harnessSelfTest: {
    unitAndPlaywright: selftest
      ? { passed: selftest.passed, stages: selftest.stages }
      : null,
    injectedFaultMetaRun: injected
      ? {
          harnessReportedFaultsCorrectly: injected.harnessReportedFaultsCorrectly,
          runExitCode: injected.execution?.exitCode ?? null,
          playwrightStats: injected.stats,
          checks: injected.checks,
        }
      : null,
  },
  controlledExperiments: {
    total: experimentRows.length,
    verified: experimentRows.filter((row) => row.finalStatus === "VERIFIED_REPAIR").length,
    allPassed: experiments?.allPassed ?? null,
    experiments: experimentRows,
  },
  burnIn: burnIn ?? null,
  ...decision,
};

const outputPath = path.join(repoRoot, "qa", "autonomous", "WEEK1_QA_CERTIFICATION.json");
fs.writeFileSync(outputPath, `${JSON.stringify(certification, null, 2)}\n`, "utf8");
console.log(`[certification] wrote ${path.relative(repoRoot, outputPath)}`);
for (const [key, value] of Object.entries({
  baseline: Boolean(baseline),
  selftest: Boolean(selftest),
  injected: Boolean(injected),
  experiments: Boolean(experiments),
  burnIn: Boolean(burnIn),
  decision: Object.keys(decision).length > 0,
})) {
  console.log(`  ${value ? "present" : "MISSING"}: ${key}`);
}
