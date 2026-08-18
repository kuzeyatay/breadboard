#!/usr/bin/env node

/**
 * W2-3 Phase 0 and 1: freeze one execution snapshot, run the dashboard suite
 * against a reconstruction of it, and build a per-test failure inventory.
 *
 * Everything downstream in this pass keys off `executionSnapshotId`. The
 * developer keeps editing while the review runs; that is fine and expected, and
 * it is precisely why the review must never re-measure against the live tree.
 *
 * The inventory records what the runner actually said — assertion text, expected
 * and actual, the stack, the source files the test imports — rather than a
 * summarised count, because a classification made from a count is a guess.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureExecutionSnapshot,
  executionIdentity,
} from "../autonomous/lib/execution-snapshot.mjs";
import {
  createSnapshotWorktree,
  mainTreeStatus,
  removeRepairWorktree,
} from "../autonomous/lib/repair-worktree.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = path.resolve(arg("--out", path.join(repoRoot, ".qa-results", "dashboard-contract")));
const eligibilityPath = arg("--eligibility", null);
const keepWorktree = process.argv.includes("--keep-worktree");

const eligibility = eligibilityPath && fs.existsSync(eligibilityPath)
  ? JSON.parse(fs.readFileSync(eligibilityPath, "utf8"))
  : { environmentBlockedTests: [] };
const blockedSet = new Set(eligibility.environmentBlockedTests ?? []);

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

/** Local module specifiers a test imports, for the `sourceFiles` column. */
function importedSources(testAbsolute) {
  let text;
  try {
    text = fs.readFileSync(testAbsolute, "utf8");
  } catch {
    return [];
  }
  const found = new Set();
  for (const match of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) found.add(match[1]);
  for (const match of text.matchAll(/new URL\(\s*["'](\.[^"']+)["']/g)) found.add(match[1]);
  return [...found]
    .map((specifier) =>
      path
        .relative(repoRoot, path.resolve(path.dirname(testAbsolute), specifier))
        .replaceAll("\\", "/"),
    )
    .sort();
}

/**
 * Parse node:test output into one record per failing test, keeping the detail
 * block so a human can see the assertion rather than only its name.
 */
function parseFailures(text) {
  const lines = text.split(/\r?\n/);
  const totals = {};
  for (const line of lines) {
    const match = /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (match) totals[match[1]] = Number(match[2]);
  }

  const start = lines.findIndex((line) => line.includes("failing tests:"));
  const failures = [];
  if (start < 0) return { totals, failures };

  let current = null;
  const push = () => {
    if (current) failures.push(current);
  };
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const location = /^test at (.+?):(\d+):(\d+)$/.exec(line.trim());
    if (location) {
      push();
      current = {
        testFile: location[1].replaceAll("\\", "/"),
        line: Number(location[2]),
        testName: null,
        detail: [],
      };
      continue;
    }
    if (!current) continue;
    const name = /^✖ (.+?) \([\d.]+ms\)$/.exec(line.trim());
    if (name && current.testName === null) {
      current.testName = name[1];
      continue;
    }
    if (current.detail.length < 40) current.detail.push(line);
  }
  push();
  return { totals, failures };
}

function extractField(detail, label) {
  const line = detail.find((entry) => entry.trim().startsWith(`${label}:`));
  if (!line) return null;
  return line.trim().slice(label.length + 1).trim().slice(0, 400);
}

function classifyFailureType(signature, detail) {
  const joined = detail.join("\n");
  if (/did not match the regular expression/.test(signature)) return "SOURCE_TEXT_REGEX";
  if (/Expected values to be strictly (deep-)?equal/.test(signature)) return "VALUE_EQUALITY";
  if (/The expression evaluated to a falsy value/.test(signature)) return "TRUTHINESS";
  if (/Missing expected (exception|rejection)/.test(signature)) return "EXPECTED_THROW_MISSING";
  if (/^AssertionError/.test(signature)) return "OTHER_ASSERTION";
  if (/ENOENT|ENOTDIR|EACCES/.test(joined)) return "FILESYSTEM_ERROR";
  if (/^\w*Error/.test(signature)) return "THROWN_ERROR";
  if (/'test failed'/.test(signature)) return "SUBTEST_ROLLUP";
  return "UNKNOWN";
}

// --- Phase 0: freeze -----------------------------------------------------
const frozen = captureExecutionSnapshot({ repoRoot, label: "w2-3-dashboard-contract-review" });
console.log(`[inventory] executionSnapshotId ${frozen.executionSnapshotId.slice(0, 16)}`);
console.log(`[inventory]   base ${frozen.baseCommit.slice(0, 12)} source ${frozen.sourceFingerprint.slice(0, 16)} env ${frozen.environmentFingerprint.slice(0, 16)}`);

const beforeStatus = mainTreeStatus(repoRoot);
const handle = createSnapshotWorktree({
  repoRoot,
  findingId: "w23-contract-review",
  snapshot: frozen.source,
});
let run;
try {
  if (handle.sourceFingerprint !== frozen.sourceFingerprint) {
    throw new Error("reconstruction fingerprint drifted from the frozen snapshot");
  }
  console.log(`[inventory] reconstructed, ${(handle.linkedRoots ?? []).length} external roots linked`);
  linkNodeModules(handle.worktreePath);

  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "tests/*.test.mjs"],
    {
      cwd: path.join(handle.worktreePath, "dashboard"),
      encoding: "utf8",
      shell: false,
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  run = { ...parseFailures(text), text, exitCode: result.status ?? 1, durationMs: Date.now() - started };
  console.log(`[inventory] ${run.failures.length} failing of ${run.totals.tests} (${run.durationMs}ms)`);
} finally {
  if (!keepWorktree) removeRepairWorktree(handle);
}
const afterStatus = mainTreeStatus(repoRoot);

// --- Phase 1: inventory --------------------------------------------------
const rows = run.failures.map((failure) => {
  const testId = `${failure.testFile} :: ${failure.testName}`;
  const signature = (failure.detail.find((line) => line.trim() !== "") ?? "").trim().slice(0, 300);
  const isFileRollup = /\.(test|spec)\.(mjs|js|ts)$/.test(failure.testName ?? "");
  const testAbsolute = path.join(repoRoot, "dashboard", failure.testFile);
  return {
    testId,
    testFile: `dashboard/${failure.testFile}`,
    testName: failure.testName,
    line: failure.line,
    suite: path.basename(failure.testFile, ".test.mjs"),
    executionSnapshotId: frozen.executionSnapshotId,
    failureSignature: signature,
    failureType: isFileRollup ? "FILE_ROLLUP" : classifyFailureType(signature, failure.detail),
    assertionText: signature,
    actualValue: extractField(failure.detail, "actual"),
    expectedValue: extractField(failure.detail, "expected"),
    stack: failure.detail
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 6)
      .map((line) => line.trim()),
    detailExcerpt: failure.detail.slice(0, 12).map((line) => line.slice(0, 200)),
    sourceFilesReferenced: isFileRollup ? [] : importedSources(testAbsolute),
    verificationEligibility: blockedSet.has(testId) ? "ENVIRONMENT_BLOCKED" : "ELIGIBLE",
    environmentDependencies: blockedSet.has(testId) ? ["gitignored vendored root"] : [],
    cascadeParent: null,
    cascadeStatus: isFileRollup ? "ROOT_FAILURE_ROLLUP" : "INDEPENDENT_FAILURE",
  };
});

// A file-level rollup is the runner reporting a file failed *because* its tests
// did. Link them so one defect is not counted many times.
const byFile = new Map();
for (const row of rows) {
  if (row.cascadeStatus === "INDEPENDENT_FAILURE") {
    const list = byFile.get(row.testFile) ?? [];
    list.push(row.testId);
    byFile.set(row.testFile, list);
  }
}
for (const row of rows) {
  if (row.cascadeStatus !== "ROOT_FAILURE_ROLLUP") continue;
  const owned = byFile.get(`dashboard/${row.testName}`) ?? [];
  row.cascadeStatus = owned.length > 0 ? "CASCADE" : "INDEPENDENT_FAILURE";
  row.cascadeParent = owned[0] ?? null;
  row.cascadeChildren = owned;
}

const eligible = rows.filter((row) => row.verificationEligibility === "ELIGIBLE");
const blocked = rows.filter((row) => row.verificationEligibility === "ENVIRONMENT_BLOCKED");
const independentEligible = eligible.filter((row) => row.cascadeStatus === "INDEPENDENT_FAILURE");

const byType = {};
for (const row of independentEligible) byType[row.failureType] = (byType[row.failureType] ?? 0) + 1;
const byFileCount = {};
for (const row of independentEligible) byFileCount[row.testFile] = (byFileCount[row.testFile] ?? 0) + 1;

const inventory = {
  generatedAt: new Date().toISOString(),
  method:
    "One frozen execution snapshot, reconstructed into an isolated worktree with external roots linked. The dashboard suite ran there once. Nothing was compared against the live developer tree.",
  executionSnapshot: executionIdentity(frozen),
  ignoredRootCount: frozen.environment.ignoredRootCount,
  linkedRootCount: (handle.linkedRoots ?? []).length,
  run: { totals: run.totals, exitCode: run.exitCode, durationMs: run.durationMs },
  counts: {
    failingEntries: rows.length,
    eligible: eligible.length,
    environmentBlocked: blocked.length,
    independentEligible: independentEligible.length,
    cascades: rows.filter((row) => row.cascadeStatus === "CASCADE").length,
  },
  independentEligibleByFailureType: byType,
  independentEligibleByFile: Object.fromEntries(
    Object.entries(byFileCount).sort((left, right) => right[1] - left[1]),
  ),
  userTreeDriftDuringRun: beforeStatus !== afterStatus,
  failures: rows,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "dashboard-failure-inventory.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
  "utf8",
);
fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
fs.writeFileSync(path.join(outDir, "logs", "dashboard-frozen-run.log"), run.text, "utf8");

console.log(`[inventory] eligible ${eligible.length} | environment-blocked ${blocked.length} | cascades ${inventory.counts.cascades}`);
console.log(`[inventory] independent eligible failures to review: ${independentEligible.length}`);
for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${type}`);
}
console.log(`[inventory] wrote ${path.relative(repoRoot, outDir).replaceAll("\\", "/")}/dashboard-failure-inventory.json`);
