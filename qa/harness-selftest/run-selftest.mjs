#!/usr/bin/env node

/**
 * The deterministic QA-harness self-test suite.
 *
 * Two layers, both fast and both offline:
 *  - `node --test qa/harness-selftest/*.test.mjs` covers the repair gate, the
 *    assertion-integrity guard, receipts, and worktree isolation;
 *  - the Playwright `selftest` project covers evidence capture, fixtures,
 *    bounded waits, cleanup, selectors, and the classification oracle.
 *
 * The live-Electron injected-fault meta-run is deliberately separate
 * (`npm run qa:selftest:electron`) because it launches the real application.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outIndex = process.argv.indexOf("--out");
const outputDir =
  outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(repoRoot, ".qa-results", "selftest");

function stage(name, command, args) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  return {
    stage: name,
    command: `${path.basename(command)} ${args.join(" ")}`,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
  };
}

/**
 * Discovered, never hand-listed.
 *
 * This used to name four files explicitly while the docstring above promised
 * the whole glob. Three unit files — `repair-capability`, `source-snapshot` and
 * `execution-snapshot`, which carry capability binding and execution identity —
 * were therefore never run by `npm run qa:selftest`, and it reported 68 passing
 * tests where the glob runs 125. A partial list that looks like a full suite is
 * worse than no suite: it makes a green report mean less than the reader thinks.
 */
export function discoverHarnessUnitTests(root = path.join(repoRoot, "qa", "harness-selftest")) {
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(root, name));
}

const harnessUnitTests = discoverHarnessUnitTests();

const stages = [
  stage("harness-unit", process.execPath, ["--test", ...harnessUnitTests]),
  stage("harness-playwright", process.execPath, [
    path.join(repoRoot, "node_modules", "@playwright", "test", "cli.js"),
    "test",
    "--config",
    path.join(repoRoot, "qa", "electron", "playwright.config.ts"),
    "--project=selftest",
    "--reporter=line",
  ]),
];

const summary = {
  generatedAt: new Date().toISOString(),
  passed: stages.every((entry) => entry.exitCode === 0),
  stages,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "selftest-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

for (const entry of stages) {
  console.log(`[qa-selftest] ${entry.exitCode === 0 ? "PASS" : "FAIL"} ${entry.stage} (${entry.durationMs}ms)`);
}
process.exit(summary.passed ? 0 : 1);
