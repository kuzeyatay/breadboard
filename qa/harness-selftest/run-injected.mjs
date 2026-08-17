#!/usr/bin/env node

/**
 * Injected-fault meta-run.
 *
 * Runs the QA harness against a project of deliberately failing real-Electron
 * scenarios and then asserts that the harness *reported* those faults with the
 * evidence the contract promises. This is the end-to-end half of "test the
 * tester": the unit-level self-tests prove the collector's logic, this proves
 * that a live renderer fault actually produces a screenshot, a diagnostics
 * bundle, and a non-zero exit.
 *
 * A green exit from this script means the harness failed correctly.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultsFile = path.join(repoRoot, ".qa-results", "results.json");
const outputDir = process.argv.includes("--out")
  ? path.resolve(process.argv[process.argv.indexOf("--out") + 1])
  : path.join(repoRoot, ".qa-results", "week1", "injected");

/** Scenarios that must fail, and what evidence each one must leave behind. */
const EXPECTED = [
  {
    match: /INJECTED-A/,
    category: "A: renderer assertion failure",
    mustFail: true,
    requireScreenshot: true,
    requireDiagnostics: true,
  },
  {
    match: /INJECTED-B/,
    category: "B: renderer uncaught exception",
    mustFail: true,
    requireScreenshot: true,
    requireDiagnostics: true,
    requireDiagnosticText: "QA_INJECTED_RENDERER_FAULT",
  },
  {
    match: /INJECTED-C/,
    category: "worker survival after injected failures",
    mustFail: false,
    requireScreenshot: false,
    requireDiagnostics: false,
  },
];

function collectSpecs(node, out = []) {
  for (const spec of node.specs ?? []) out.push(spec);
  for (const child of node.suites ?? []) collectSpecs(child, out);
  return out;
}

function specOutcome(spec) {
  const results = (spec.tests ?? []).flatMap((testCase) => testCase.results ?? []);
  const statuses = results.map((result) => result.status);
  const attachments = results.flatMap((result) => result.attachments ?? []);
  const annotations = (spec.tests ?? []).flatMap((testCase) => testCase.annotations ?? []);
  return {
    title: spec.title,
    ok: spec.ok === true,
    statuses,
    attachments,
    annotations,
    errors: results.flatMap((result) =>
      (result.errors ?? []).map((error) => String(error.message ?? "").split("\n")[0]),
    ),
  };
}

function attachmentPresent(attachments, name) {
  return attachments.some(
    (attachment) =>
      attachment.name === name && attachment.path && fs.existsSync(attachment.path),
  );
}

function run() {
  const env = {
    ...process.env,
    BREADBOARD_QA_INJECT_FAULTS: "1",
    // Preserve nothing: the meta-run must also demonstrate normal cleanup.
    BREADBOARD_QA_PRESERVE_RUNTIME: "0",
  };
  const started = Date.now();
  const child = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "qa", "electron", "run-qa.mjs"),
      "--project=injected",
      "--skip-desktop-build",
    ],
    { cwd: repoRoot, env, stdio: "inherit", shell: false },
  );
  return { exitCode: child.status ?? 1, durationMs: Date.now() - started };
}

const execution = run();

if (!fs.existsSync(resultsFile)) {
  console.error(`[qa-selftest] no Playwright results at ${resultsFile}`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
const specs = (report.suites ?? []).flatMap((suite) => collectSpecs(suite)).map(specOutcome);

const checks = [];
for (const expectation of EXPECTED) {
  const spec = specs.find((candidate) => expectation.match.test(candidate.title));
  if (!spec) {
    checks.push({
      category: expectation.category,
      passed: false,
      detail: `no injected scenario matched ${expectation.match}`,
    });
    continue;
  }

  const problems = [];
  if (expectation.mustFail && spec.ok) {
    problems.push("the harness reported this injected fault as a pass");
  }
  if (!expectation.mustFail && !spec.ok) {
    problems.push(`the control scenario failed: ${spec.errors.join("; ")}`);
  }
  if (expectation.requireScreenshot && !attachmentPresent(spec.attachments, "electron-failure-screenshot")) {
    problems.push("no failure screenshot was retained");
  }
  if (
    expectation.requireDiagnostics &&
    !attachmentPresent(spec.attachments, "electron-failure-diagnostics")
  ) {
    problems.push("no failure diagnostics bundle was retained");
  }
  if (expectation.requireDiagnosticText) {
    const bundle = spec.attachments.find(
      (attachment) => attachment.name === "electron-failure-diagnostics" && attachment.path,
    );
    const text = bundle && fs.existsSync(bundle.path) ? fs.readFileSync(bundle.path, "utf8") : "";
    if (!text.includes(expectation.requireDiagnosticText)) {
      problems.push(
        `diagnostics bundle does not contain ${expectation.requireDiagnosticText}`,
      );
    }
  }

  checks.push({
    category: expectation.category,
    scenario: spec.title,
    passed: problems.length === 0,
    statuses: spec.statuses,
    reportedErrors: spec.errors,
    evidence: {
      screenshot: attachmentPresent(spec.attachments, "electron-failure-screenshot"),
      diagnostics: attachmentPresent(spec.attachments, "electron-failure-diagnostics"),
      trace: attachmentPresent(spec.attachments, "electron-trace"),
      evidenceGaps: spec.annotations
        .filter((annotation) => annotation.type === "qa-evidence-gap")
        .map((annotation) => annotation.description),
    },
    problems,
  });
}

if (execution.exitCode === 0) {
  checks.push({
    category: "run exit code",
    passed: false,
    problems: ["the injected-fault run exited 0; a harness that cannot fail cannot certify anything"],
  });
} else {
  checks.push({ category: "run exit code", passed: true, detail: `exit ${execution.exitCode}` });
}

const revision = (() => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : null;
})();

const summary = {
  generatedAt: new Date().toISOString(),
  // Evidence must be attributable to a revision and a run root, or it cannot be
  // replayed later against the same code.
  revision,
  qaRuntimeRoot: path.join(process.env.TEMP ?? process.env.TMPDIR ?? "", "breadboard-qa-runtime"),
  harnessReportedFaultsCorrectly: checks.every((check) => check.passed),
  execution,
  stats: report.stats ?? null,
  checks,
  scenarios: specs.map((spec) => ({ title: spec.title, ok: spec.ok, statuses: spec.statuses })),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "injected-fault-report.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
fs.copyFileSync(resultsFile, path.join(outputDir, "playwright-results.json"));

for (const check of checks) {
  console.log(
    `[qa-selftest] ${check.passed ? "OK  " : "FAIL"} ${check.category}` +
      (check.problems?.length ? ` :: ${check.problems.join("; ")}` : ""),
  );
}
console.log(`[qa-selftest] report: ${path.join(outputDir, "injected-fault-report.json")}`);
process.exit(summary.harnessReportedFaultsCorrectly ? 0 : 1);
