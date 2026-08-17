#!/usr/bin/env node

/**
 * Does a failing dashboard test fail because Breadboard is broken, or because
 * the working tree carries uncommitted work the test has not caught up with?
 *
 * The only way to answer that mechanically is to run the same suite against the
 * committed revision in a clean, isolated worktree and compare failure sets:
 *
 *   fails in working tree AND at HEAD  → independent of the uncommitted work;
 *                                        a real candidate
 *   fails in working tree, passes HEAD → explained by in-flight developer edits
 *   passes working tree, fails at HEAD → fixed by the in-flight edits
 *
 * This never modifies the working tree and never commits anything.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRepairWorktree,
  removeRepairWorktree,
} from "../autonomous/lib/repair-worktree.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const workingLog = path.resolve(arg("--working-log", ""));
const outPath = path.resolve(arg("--out", path.join(repoRoot, "head-comparison.json")));
const findingId = arg("--worktree-id", "week2-head-baseline");

if (!fs.existsSync(workingLog)) {
  console.error(`[head-compare] need --working-log <path>, got ${workingLog}`);
  process.exit(2);
}

/** Failing test names from a node:test log's "failing tests:" section. */
function failingTests(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("failing tests:"));
  const totals = {};
  for (const line of lines) {
    const match = /^ℹ (tests|pass|fail|skipped) (\d+)$/.exec(line);
    if (match) totals[match[1]] = Number(match[2]);
  }
  if (start < 0) return { tests: [], totals };
  const tests = [];
  let file = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const location = /^test at (.+?):(\d+):(\d+)$/.exec(lines[index].trim());
    if (location) {
      file = location[1].replaceAll("\\", "/");
      continue;
    }
    const name = /^✖ (.+?) \([\d.]+ms\)$/.exec(lines[index].trim());
    if (name) tests.push({ file, test: name[1] });
  }
  return { tests, totals };
}

function linkDependencies(worktreePath) {
  const linked = [];
  for (const relative of ["node_modules", "dashboard/node_modules", "desktop/node_modules"]) {
    const source = path.join(repoRoot, relative);
    if (!fs.existsSync(source)) continue;
    const target = path.join(worktreePath, relative);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
    linked.push(relative);
  }
  return linked;
}

const working = failingTests(fs.readFileSync(workingLog, "utf8"));
console.log(`[head-compare] working tree: ${working.tests.length} failing test(s)`);

const handle = createRepairWorktree({ repoRoot, findingId });
let headLogText = "";
let headExit = null;
try {
  linkDependencies(handle.worktreePath);
  console.log(`[head-compare] running the dashboard suite at ${handle.sourceRevision.slice(0, 12)}...`);
  const result = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "tests/*.test.mjs"],
    {
      cwd: path.join(handle.worktreePath, "dashboard"),
      encoding: "utf8",
      shell: false,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  headExit = result.status ?? 1;
  headLogText = `${result.stdout ?? ""}${result.stderr ?? ""}`;
} finally {
  removeRepairWorktree(handle);
}

const head = failingTests(headLogText);
console.log(`[head-compare] HEAD: ${head.tests.length} failing test(s), exit ${headExit}`);

const key = (entry) => `${entry.file} :: ${entry.test}`;
const workingSet = new Map(working.tests.map((entry) => [key(entry), entry]));
const headSet = new Map(head.tests.map((entry) => [key(entry), entry]));

const failsBoth = [...workingSet.keys()].filter((id) => headSet.has(id));
const workingOnly = [...workingSet.keys()].filter((id) => !headSet.has(id));
const headOnly = [...headSet.keys()].filter((id) => !workingSet.has(id));

const summary = {
  generatedAt: new Date().toISOString(),
  revision: handle.sourceRevision,
  method:
    "The same dashboard suite was run in a clean detached worktree at HEAD and compared with the working-tree run. Neither run modified the working tree.",
  workingTree: { failing: working.tests.length, totals: working.totals },
  head: { failing: head.tests.length, totals: head.totals, exitCode: headExit },
  failsInBoth: {
    count: failsBoth.length,
    interpretation:
      "Independent of the uncommitted work. These are the only candidates for a real product defect.",
    tests: failsBoth,
  },
  failsOnlyInWorkingTree: {
    count: workingOnly.length,
    interpretation:
      "Explained by uncommitted in-flight developer edits, not by committed Breadboard behaviour.",
    tests: workingOnly,
  },
  failsOnlyAtHead: {
    count: headOnly.length,
    interpretation: "Fixed by the uncommitted work in progress.",
    tests: headOnly,
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(`${outPath.replace(/\.json$/, "")}-head.log`, headLogText, "utf8");
console.log(`[head-compare] fails in both: ${failsBoth.length}`);
console.log(`[head-compare] working-tree only: ${workingOnly.length}`);
console.log(`[head-compare] HEAD only: ${headOnly.length}`);
console.log(`[head-compare] wrote ${path.relative(repoRoot, outPath).replaceAll("\\", "/")}`);
