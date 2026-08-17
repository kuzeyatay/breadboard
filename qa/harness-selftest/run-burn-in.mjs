#!/usr/bin/env node

/**
 * Week 1 burn-in.
 *
 * Runs the deterministic core QA path several consecutive times and records
 * per-scenario pass/fail counts, flake rate, and durations. Retries are never
 * enabled: an intermittent scenario has to show up as intermittent, because a
 * flake that a retry hides becomes an unexplained production edit later.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rounds = Number(arg("--rounds", "3"));
const outputDir = path.resolve(arg("--out", path.join(repoRoot, ".qa-results", "week1", "burn-in")));
const resultsFile = path.join(repoRoot, ".qa-results", "results.json");

const npmCli = (() => {
  const bundled = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(bundled)) return bundled;
  if (process.env.npm_execpath) return process.env.npm_execpath;
  throw new Error("Could not resolve npm-cli.js");
})();

const SUITES = [
  { id: "qa:electron:typecheck", args: [npmCli, "run", "qa:electron:typecheck"] },
  { id: "desktop:test", args: [npmCli, "run", "desktop:test"] },
  { id: "qa:selftest", args: [npmCli, "run", "qa:selftest"] },
  {
    id: "qa:electron:critical",
    args: [npmCli, "run", "qa:electron:critical"],
    collectPlaywright: true,
  },
];

function collectSpecs(node, out = []) {
  for (const spec of node.specs ?? []) out.push(spec);
  for (const child of node.suites ?? []) collectSpecs(child, out);
  return out;
}

function readPlaywrightSpecs() {
  if (!fs.existsSync(resultsFile)) return [];
  const report = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  return (report.suites ?? [])
    .flatMap((suite) => collectSpecs(suite))
    .map((spec) => {
      const results = (spec.tests ?? []).flatMap((entry) => entry.results ?? []);
      return {
        title: spec.title,
        ok: spec.ok === true,
        status: results.at(-1)?.status ?? "unknown",
        durationMs: results.reduce((total, entry) => total + (entry.duration ?? 0), 0),
      };
    });
}

const suiteStats = new Map();
const scenarioStats = new Map();

for (let round = 1; round <= rounds; round += 1) {
  for (const suite of SUITES) {
    const started = Date.now();
    const result = spawnSync(process.execPath, suite.args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    const durationMs = Date.now() - started;
    const exitCode = result.status ?? 1;
    const entry = suiteStats.get(suite.id) ?? { id: suite.id, runs: 0, passes: 0, durations: [] };
    entry.runs += 1;
    if (exitCode === 0) entry.passes += 1;
    entry.durations.push(durationMs);
    suiteStats.set(suite.id, entry);
    console.log(`[burn-in] round ${round} ${suite.id} exit=${exitCode} (${durationMs}ms)`);

    if (suite.collectPlaywright) {
      for (const spec of readPlaywrightSpecs()) {
        const key = `${suite.id} :: ${spec.title}`;
        const stat = scenarioStats.get(key) ?? {
          scenario: key,
          runs: 0,
          passes: 0,
          failures: 0,
          durations: [],
          statuses: [],
        };
        stat.runs += 1;
        if (spec.ok) stat.passes += 1;
        else stat.failures += 1;
        stat.durations.push(spec.durationMs);
        stat.statuses.push(spec.status);
        scenarioStats.set(key, stat);
      }
    }
  }
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};

const summarise = (stat) => ({
  ...stat,
  flakeRate:
    stat.runs === 0 || stat.passes === stat.runs || stat.passes === 0
      ? 0
      : Number(((stat.runs - stat.passes) / stat.runs).toFixed(3)),
  intermittent: stat.passes > 0 && stat.passes < stat.runs,
  medianDurationMs: median(stat.durations),
  maxDurationMs: stat.durations.length ? Math.max(...stat.durations) : 0,
});

const suites = [...suiteStats.values()].map((stat) =>
  summarise({ ...stat, failures: stat.runs - stat.passes }),
);
const scenarios = [...scenarioStats.values()].map(summarise);
const summary = {
  generatedAt: new Date().toISOString(),
  rounds,
  retriesEnabled: false,
  suites: suites.map(({ durations, ...rest }) => rest),
  scenarios: scenarios.map(({ durations, ...rest }) => rest),
  intermittentScenarios: scenarios.filter((stat) => stat.intermittent).map((stat) => stat.scenario),
  deterministicFailures: scenarios.filter((stat) => stat.passes === 0).map((stat) => stat.scenario),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "burn-in.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\n[burn-in] report: ${path.join(outputDir, "burn-in.json")}`);
console.log(`[burn-in] intermittent scenarios: ${summary.intermittentScenarios.length}`);
console.log(`[burn-in] deterministic failures: ${summary.deterministicFailures.length}`);
process.exit(0);
