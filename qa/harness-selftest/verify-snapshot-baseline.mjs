#!/usr/bin/env node

/**
 * The decisive W2-2 measurement.
 *
 * Week 2 found that the dashboard suite fails 123 tests at clean `HEAD` and 51
 * in the developer's working tree. Repair worktrees were cut from `HEAD`, so a
 * repair was verified against a product the user is not running.
 *
 * This runs the same suite three ways and compares the failure sets:
 *
 *   working tree      — the product the user actually has
 *   clean HEAD        — what Week 2 verified against
 *   snapshot worktree — what the new model verifies against
 *
 * The snapshot run must match the working tree, not HEAD. Anything else means
 * the snapshot does not carry the source it claims.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { captureSourceSnapshot, snapshotIdentity } from "../autonomous/lib/source-snapshot.mjs";
import {
  createRepairWorktree,
  createSnapshotWorktree,
  mainTreeStatus,
  removeRepairWorktree,
} from "../autonomous/lib/repair-worktree.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outPath = path.resolve(arg("--out", path.join(repoRoot, "snapshot-baseline.json")));

function failingTests(text) {
  const lines = text.split(/\r?\n/);
  const totals = {};
  for (const line of lines) {
    const match = /^ℹ (tests|pass|fail|skipped) (\d+)$/.exec(line);
    if (match) totals[match[1]] = Number(match[2]);
  }
  const start = lines.findIndex((line) => line.includes("failing tests:"));
  const tests = [];
  if (start >= 0) {
    let file = null;
    for (let index = start + 1; index < lines.length; index += 1) {
      const location = /^test at (.+?):(\d+):(\d+)$/.exec(lines[index].trim());
      if (location) {
        file = location[1].replaceAll("\\", "/");
        continue;
      }
      const name = /^✖ (.+?) \([\d.]+ms\)$/.exec(lines[index].trim());
      if (name) tests.push(`${file} :: ${name[1]}`);
    }
  }
  return { tests, totals };
}

function linkDependencies(worktreePath) {
  for (const relative of ["node_modules", "dashboard/node_modules", "desktop/node_modules"]) {
    const source = path.join(repoRoot, relative);
    if (!fs.existsSync(source)) continue;
    const target = path.join(worktreePath, relative);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  }
}

function runDashboardSuite(cwdRoot, label) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "tests/*.test.mjs"],
    {
      cwd: path.join(cwdRoot, "dashboard"),
      encoding: "utf8",
      shell: false,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const parsed = failingTests(text);
  console.log(`[snapshot-baseline] ${label}: ${parsed.tests.length} failing (${Date.now() - started}ms)`);
  return { ...parsed, exitCode: result.status ?? 1, text };
}

const beforeStatus = mainTreeStatus(repoRoot);
const snapshot = captureSourceSnapshot({ repoRoot, label: "snapshot-baseline-verification" });
console.log(
  `[snapshot-baseline] snapshot ${snapshot.sourceFingerprint.slice(0, 16)} on base ${snapshot.baseCommit.slice(0, 12)} ` +
    `(${snapshot.trackedDiffBytes} diff bytes, ${snapshot.untrackedFiles.length} untracked files)`,
);

const working = runDashboardSuite(repoRoot, "working tree");

let head;
const headHandle = createRepairWorktree({ repoRoot, findingId: "w2c-head-baseline" });
try {
  linkDependencies(headHandle.worktreePath);
  head = runDashboardSuite(headHandle.worktreePath, "clean HEAD");
} finally {
  removeRepairWorktree(headHandle);
}

let snapshotRun;
let snapshotWorktreeFingerprint = null;
const snapHandle = createSnapshotWorktree({
  repoRoot,
  findingId: "w2c-snapshot-baseline",
  snapshot,
});
try {
  snapshotWorktreeFingerprint = snapHandle.sourceFingerprint;
  linkDependencies(snapHandle.worktreePath);
  snapshotRun = runDashboardSuite(snapHandle.worktreePath, "snapshot worktree");
} finally {
  removeRepairWorktree(snapHandle);
}

const afterStatus = mainTreeStatus(repoRoot);

const setOf = (run) => new Set(run.tests);
const workingSet = setOf(working);
const headSet = setOf(head);
const snapSet = setOf(snapshotRun);

const missingFromSnapshot = [...workingSet].filter((id) => !snapSet.has(id));
const extraInSnapshot = [...snapSet].filter((id) => !workingSet.has(id));
const snapshotMatchesWorkingTree =
  missingFromSnapshot.length === 0 && extraInSnapshot.length === 0;

const summary = {
  generatedAt: new Date().toISOString(),
  snapshot: snapshotIdentity(snapshot),
  snapshotWorktreeFingerprint,
  fingerprintPreserved: snapshotWorktreeFingerprint === snapshot.sourceFingerprint,
  runs: {
    workingTree: { failing: working.tests.length, totals: working.totals, exitCode: working.exitCode },
    cleanHead: { failing: head.tests.length, totals: head.totals, exitCode: head.exitCode },
    snapshotWorktree: {
      failing: snapshotRun.tests.length,
      totals: snapshotRun.totals,
      exitCode: snapshotRun.exitCode,
    },
  },
  comparison: {
    snapshotMatchesWorkingTree,
    missingFromSnapshot,
    extraInSnapshot,
    headVsWorkingTreeDelta: Math.abs(head.tests.length - working.tests.length),
    interpretation: snapshotMatchesWorkingTree
      ? "The snapshot worktree reproduces the working tree's failure set exactly, so a repair verified there is verified against the product the user is running."
      : "The snapshot worktree did not reproduce the working tree's failure set; the snapshot does not carry the source it claims and repairs must not be trusted against it.",
  },
  userTreeUntouched: beforeStatus === afterStatus,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`[snapshot-baseline] snapshot matches working tree: ${snapshotMatchesWorkingTree}`);
console.log(`[snapshot-baseline] user tree untouched: ${summary.userTreeUntouched}`);
console.log(`[snapshot-baseline] wrote ${path.relative(repoRoot, outPath).replaceAll("\\", "/")}`);
process.exit(snapshotMatchesWorkingTree && summary.userTreeUntouched ? 0 : 1);
