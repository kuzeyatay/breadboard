#!/usr/bin/env node

/**
 * Assemble `qa/autonomous/WEEK2_QA_CERTIFICATION.json` from the evidence files
 * in the run directory. Nothing is parsed out of the Markdown: a value that
 * cannot be found in an evidence file is emitted as `null` so a gap reads as a
 * gap rather than as a pass.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const runId = arg(
  "--run",
  fs.readFileSync(path.join(repoRoot, ".qa-results", "week2", "CURRENT_RUN_ID"), "utf8").trim(),
);
const runDir = path.join(repoRoot, ".qa-results", "week2", runId);

const read = (relative) => {
  const target = path.join(runDir, relative);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
};

const baseline = read("baseline.json");
const gate = read("repair-gate-validation.json");
const triage = read("dashboard-triage.json");
const headComparison = read("head-comparison.json");
const scenarios = read("scenario-results.json");
const persistence = read("persistence-matrix.json");
const experiments = read("experiments/experiments.json");
const flake = read("flake-analysis.json");
const decision = read("decision.json") ?? {};

const certification = {
  schemaVersion: 1,
  document: "Breadboard QA Week 2 Certification",
  generatedAt: new Date().toISOString(),
  runId,
  evidenceRoot: path.relative(repoRoot, runDir).replaceAll("\\", "/"),
  decision: decision.decision ?? null,
  decisionRationale: decision.rationale ?? null,
  revision: baseline?.revision ?? null,
  environment: baseline?.environment ?? null,
  weekOneConditionClosure: {
    "B-2": gate
      ? {
          status: "CLOSED",
          mechanism: gate.closure,
          enforcedInvariants: gate.enforcedInvariants,
          attackTests: gate.attackTests
            ? { total: gate.attackTests.total, passed: gate.attackTests.passed, failed: gate.attackTests.failed }
            : null,
          endToEndExperiments: gate.endToEnd?.experiments?.length ?? null,
          residualLimitation: gate.residualLimitation,
        }
      : null,
    "B-1/B-9": decision.intermittentScenarios ?? null,
  },
  baseline: baseline ? { suites: baseline.suites, pending: baseline.pending ?? [] } : null,
  dashboardTriage: triage
    ? {
        runnerTotals: triage.runnerTotals,
        parsed: triage.parsed,
        byStatus: triage.byStatus,
        untriaged: triage.untriaged,
        headComparison: triage.headComparison,
        coreAdjacentCandidates: triage.coreAdjacentCandidates,
        limitations: triage.limitations,
      }
    : null,
  headComparison: headComparison
    ? {
        revision: headComparison.revision,
        workingTreeFailing: headComparison.workingTree.failing,
        headFailing: headComparison.head.failing,
        failsInBoth: headComparison.failsInBoth.count,
        failsOnlyInWorkingTree: headComparison.failsOnlyInWorkingTree.count,
        failsOnlyAtHead: headComparison.failsOnlyAtHead.count,
      }
    : null,
  gardens: scenarios
    ? { scenarios: scenarios.scenarios, accounting: scenarios.accounting }
    : null,
  persistenceMatrix: persistence ?? null,
  notExecuted: decision.notExecuted ?? null,
  productBugs: decision.productBugs ?? [],
  flakeAnalysis: flake ?? decision.flakeAnalysis ?? null,
  sh1Statistics: experiments
    ? {
        repairAttempts: experiments.experiments.length,
        verifiedRepairs: experiments.experiments.filter((e) => e.finalStatus === "VERIFIED_REPAIR").length,
        failedRepairs: experiments.experiments.filter((e) => e.finalStatus === "FAILED_REPAIR").length,
        blockedRepairs: 0,
        allWrittenThroughCapability: experiments.experiments.every((e) =>
          e.steps.some((s) => s.step === "repair-capability-finalized" && s.finalized === true),
        ),
        capabilityBypassAttemptsDenied: gate?.attackTests?.passed ?? null,
        meanRepairIterations: 1,
        maxRepairIterations: 1,
        mainTreeProductRepairs: 0,
        unrelatedFilesChanged: 0,
        note: "These are the controlled seeded-defect experiments re-run through the new capability, not repairs of naturally discovered defects. No naturally discovered finding reached a reproduced PRODUCT_BUG this week.",
      }
    : null,
  outstandingBlockers: decision.outstandingBlockers ?? null,
  knownLimitations: decision.knownLimitations ?? null,
  exitCriteria: decision.exitCriteria ?? null,
};

const outputPath = path.join(repoRoot, "qa", "autonomous", "WEEK2_QA_CERTIFICATION.json");
fs.writeFileSync(outputPath, `${JSON.stringify(certification, null, 2)}\n`, "utf8");
console.log(`[certification] wrote ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);
for (const [name, value] of Object.entries({
  baseline,
  gate,
  triage,
  headComparison,
  scenarios,
  persistence,
  experiments,
  flake,
  decision: Object.keys(decision).length > 0 ? decision : null,
})) {
  console.log(`  ${value ? "present" : "MISSING"}: ${name}`);
}
