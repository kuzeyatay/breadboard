#!/usr/bin/env node

/**
 * W2-3E Phase 19 — targeted stability, without a retry mechanism.
 *
 * Each behavioural arbitration is run three independent times and its invariant
 * verdicts compared by name. A result that moves between runs is FLAKY and must
 * not be treated as a stable contract verdict, however convincing a single run
 * looked. Nothing here retries a failure or masks one.
 *
 * Run from `dashboard/`.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const outPath = path.resolve(process.argv[2] ?? "targeted-stability.json");
const dashboardRoot = process.cwd();
const harness = path.resolve(dashboardRoot, "../qa/harness-selftest");
const ATTEMPTS = 3;

const SCRIPTS = [
  { subRoot: "SKILL_INTEGRITY_PIN", script: "w23e-arbitrate-skill-integrity.mjs", alias: false },
  { subRoot: "ARTIFACT_TURN_BINDING", script: "w23e-arbitrate-turn-binding.mjs", alias: false },
  { subRoot: "CATALOG_CHANGE_ANNOUNCEMENT", script: "w23e-arbitrate-catalog-announcement.mjs", alias: true },
  { subRoot: "WORKSPACE_MATERIAL_ISOLATION+AGENT_RUN_CARD_MATERIAL", script: "w23e-arbitrate-shared-material.mjs", alias: false },
  { subRoot: "VISUAL_CONTRACT_VALIDATION", script: "w23e-arbitrate-visual-contract.mjs", alias: true },
  { subRoot: "ALL (counterexamples)", script: "w23e-counterexamples.mjs", alias: true },
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-w23e-stability-"));
const entries = [];

for (const { subRoot, script, alias } of SCRIPTS) {
  const signatures = [];
  const attempts = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const resultPath = path.join(scratch, `${script}.${attempt}.json`);
    const args = ["--experimental-strip-types"];
    if (alias) args.push("--import", path.join(harness, "w23e-alias-hook.mjs"));
    args.push(path.join(harness, script), resultPath);
    const run = spawnSync(process.execPath, args, {
      cwd: dashboardRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    let signature = `process-exit-${run.status}`;
    let holds = null;
    if (fs.existsSync(resultPath)) {
      const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (Array.isArray(parsed.invariants)) {
        holds = parsed.invariants.map((entry) => `${entry.name}=${entry.holds}`);
      } else if (Array.isArray(parsed.results)) {
        holds = parsed.results.map((entry) => `${entry.mutation}=${entry.detected}`);
      }
      signature = holds ? holds.join("|") : signature;
    }
    signatures.push(signature);
    attempts.push({ attempt, exitCode: run.status, producedResult: fs.existsSync(resultPath), verdictCount: holds?.length ?? 0 });
  }
  const distinct = [...new Set(signatures)];
  entries.push({
    subRoot,
    script,
    attempts: ATTEMPTS,
    identicalOutcomes: distinct.length === 1,
    distinctSignatures: distinct.length,
    verdict: distinct.length === 1 ? "STABLE" : "FLAKY",
    failureSignatures: distinct.length === 1 ? [] : distinct.map((entry) => entry.slice(0, 400)),
    perAttempt: attempts,
  });
}

fs.rmSync(scratch, { recursive: true, force: true });

const allStable = entries.every((entry) => entry.identicalOutcomes);
const summary = {
  generatedAt: new Date().toISOString(),
  attemptsPerFamily: ATTEMPTS,
  retryMechanism: "none — each attempt is an independent process and a differing outcome is reported, not re-run",
  families: entries,
  allStable,
  flaky: entries.filter((entry) => !entry.identicalOutcomes).map((entry) => entry.subRoot),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

for (const entry of entries) {
  console.log(`  ${entry.verdict.padEnd(6)} ${entry.subRoot} (${entry.attempts} attempts, ${entry.distinctSignatures} distinct outcome(s))`);
}
console.log(`[stability] all stable: ${allStable}`);
