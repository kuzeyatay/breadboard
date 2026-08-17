#!/usr/bin/env node

/**
 * Dashboard failure triage (Week 2, Phase 10).
 *
 * Week 1 reported "51 failing dashboard tests" as one number, which says nothing
 * about whether Breadboard is broken. This parses the node:test output into one
 * record per failure with its file, error signature, and cascade relationship,
 * so each can be classified individually.
 *
 * The parser only extracts facts. Classification is a judgement and lives in a
 * companion file that this merges in, so a classification always has a name
 * attached to it rather than being inferred from a regex.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const logPath = path.resolve(arg("--log", ""));
const outPath = path.resolve(arg("--out", path.join(repoRoot, "dashboard-triage.json")));
const classificationPath = arg("--classifications", null);

if (!logPath || !fs.existsSync(logPath)) {
  console.error(`[triage] need --log <path to test:dashboard output>, got ${logPath}`);
  process.exit(2);
}

const raw = fs.readFileSync(logPath, "utf8");
const lines = raw.split(/\r?\n/);

/** Totals the runner itself reported; never recomputed from parsed rows. */
const totals = {};
for (const line of lines) {
  const match = /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
  if (match) totals[match[1]] = Number(match[2]);
}

const failingIndex = lines.findIndex((line) => line.includes("failing tests:"));
const failures = [];

if (failingIndex >= 0) {
  let current = null;
  for (let index = failingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const location = /^test at (.+?):(\d+):(\d+)$/.exec(line.trim());
    if (location) {
      if (current) failures.push(current);
      current = {
        file: location[1].replaceAll("\\", "/"),
        line: Number(location[2]),
        test: null,
        signature: null,
        detail: [],
      };
      continue;
    }
    if (!current) continue;
    const name = /^✖ (.+?) \([\d.]+ms\)$/.exec(line.trim());
    if (name && current.test === null) {
      current.test = name[1];
      continue;
    }
    if (current.signature === null && line.trim() !== "") {
      current.signature = line.trim().slice(0, 200);
    }
    if (current.detail.length < 6 && line.trim() !== "") current.detail.push(line.trim().slice(0, 200));
  }
  if (current) failures.push(current);
}

/**
 * A whole-file failure entry alongside individual test failures in the same
 * file is the runner reporting the file as failed *because* those tests failed.
 * Counting both would double-count one defect.
 */
const fileLevel = new Set(
  failures
    .filter((entry) => entry.test && /\.(test|spec)\.(mjs|js|ts)$/.test(entry.test))
    .map((entry) => entry.test.replaceAll("\\", "/")),
);

const rows = failures.map((entry) => {
  const isFileLevel = entry.test !== null && /\.(test|spec)\.(mjs|js|ts)$/.test(entry.test);
  const cascadeOf = isFileLevel ? null : undefined;
  return {
    test: entry.test,
    file: entry.file,
    line: entry.line,
    failureSignature: entry.signature,
    detail: entry.detail,
    kind: isFileLevel ? "file-rollup" : "test",
    firstRootFailure: cascadeOf ?? null,
    classification: null,
    evidence: `${path.relative(repoRoot, logPath).replaceAll("\\", "/")}:${entry.line}`,
    component: entry.file.split("/").pop()?.replace(/\.(test|spec)\.(mjs|js|ts)$/, "") ?? null,
    repairEligibility: null,
    recommendedAction: null,
    status: "UNTRIAGED",
  };
});

// Attach cascade relationships: a file rollup is explained by the individual
// failures in the same file.
for (const row of rows) {
  if (row.kind !== "file-rollup") continue;
  const siblings = rows.filter((other) => other.kind === "test" && other.file === row.file);
  row.firstRootFailure = siblings[0]?.test ?? null;
  row.classification = "I";
  row.repairEligibility = "NOT_ELIGIBLE";
  row.recommendedAction = "Count the individual failures in this file, not this rollup.";
  row.status = "TRIAGED";
}

if (classificationPath && fs.existsSync(classificationPath)) {
  const decisions = JSON.parse(fs.readFileSync(classificationPath, "utf8"));
  for (const row of rows) {
    const decision =
      decisions.byTest?.[row.test] ??
      decisions.byFile?.[row.file] ??
      null;
    if (!decision) continue;
    Object.assign(row, decision, { status: "TRIAGED" });
  }
}

const byClassification = {};
for (const row of rows) {
  const key = row.classification ?? "UNCLASSIFIED";
  byClassification[key] = (byClassification[key] ?? 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: path.relative(repoRoot, logPath).replaceAll("\\", "/"),
  runnerTotals: totals,
  parsed: {
    failureEntries: rows.length,
    individualTestFailures: rows.filter((row) => row.kind === "test").length,
    fileRollups: rows.filter((row) => row.kind === "file-rollup").length,
    distinctFiles: new Set(rows.filter((row) => row.kind === "test").map((row) => row.file)).size,
  },
  classificationLegend: {
    A: "real PRODUCT_BUG",
    B: "obsolete test",
    C: "incorrect test expectation",
    D: "harness problem",
    E: "fixture issue",
    F: "environment issue",
    G: "intentional behavior change not reflected in test",
    H: "flaky",
    I: "duplicate/cascade failure",
  },
  byClassification,
  untriaged: rows.filter((row) => row.status !== "TRIAGED").length,
  failures: rows,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`[triage] runner reported fail=${totals.fail ?? "?"} of ${totals.tests ?? "?"}`);
console.log(
  `[triage] parsed ${summary.parsed.individualTestFailures} individual failures across ` +
    `${summary.parsed.distinctFiles} file(s), plus ${summary.parsed.fileRollups} file rollup(s)`,
);
console.log(`[triage] untriaged: ${summary.untriaged}`);
console.log(`[triage] wrote ${path.relative(repoRoot, outPath).replaceAll("\\", "/")}`);
