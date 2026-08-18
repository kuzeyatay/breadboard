#!/usr/bin/env node

/**
 * Execution-environment equivalence, measured without a moving oracle.
 *
 * The previous pass compared reconstructions against the developer's live tree
 * and could not conclude anything: the same suite measured 52, 81 and 50
 * failures within an hour because the tree was being edited throughout. That is
 * not an experiment, it is a moving target.
 *
 * This isolates the one variable that matters. Both arms reconstruct the *same*
 * frozen execution snapshot, so their authored source is byte-identical by
 * construction (identical `sourceFingerprint`). They differ only in whether the
 * gitignored vendored roots are present:
 *
 *   arm A  source only              — what an SH1 repair worktree gets today
 *   arm B  source + ignored roots   — the previously abandoned linking strategy
 *
 * A test that behaves identically in both arms cannot be sensitive to the
 * missing environment, and is therefore valid verification evidence. A test that
 * differs is environment-dependent and must never count as positive evidence.
 *
 * This also answers, with signatures rather than counts, why linking made things
 * worse: arm B's *new* failures are exactly the linking damage.
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
const outDir = path.resolve(arg("--out", path.join(repoRoot, ".qa-results", "equivalence")));

/** Per-test outcome plus a normalised failure signature. */
function parseRun(text) {
  const lines = text.split(/\r?\n/);
  const totals = {};
  for (const line of lines) {
    const match = /^ℹ (tests|pass|fail|skipped) (\d+)$/.exec(line);
    if (match) totals[match[1]] = Number(match[2]);
  }
  const failures = new Map();
  const start = lines.findIndex((line) => line.includes("failing tests:"));
  if (start >= 0) {
    let file = null;
    let current = null;
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const location = /^test at (.+?):(\d+):(\d+)$/.exec(line.trim());
      if (location) {
        file = location[1].replaceAll("\\", "/");
        current = null;
        continue;
      }
      const name = /^✖ (.+?) \([\d.]+ms\)$/.exec(line.trim());
      if (name) {
        current = `${file} :: ${name[1]}`;
        failures.set(current, null);
        continue;
      }
      if (current && failures.get(current) === null && line.trim() !== "") {
        // First non-empty line after the title is the error class + message.
        failures.set(
          current,
          line
            .trim()
            .slice(0, 160)
            .replace(/0x[0-9a-f]+/gi, "0xADDR")
            .replace(/\d+ms/g, "Nms"),
        );
      }
    }
  }
  return { totals, failures };
}

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

function runDashboard(root, label) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "tests/*.test.mjs"],
    {
      cwd: path.join(root, "dashboard"),
      encoding: "utf8",
      shell: false,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const parsed = parseRun(text);
  console.log(
    `[equivalence] ${label}: ${parsed.failures.size} failing of ${parsed.totals.tests ?? "?"} (${Date.now() - started}ms)`,
  );
  return { ...parsed, text };
}

function arm({ findingId, linkExternal, snapshot, label }) {
  const handle = createSnapshotWorktree({
    repoRoot,
    findingId,
    snapshot: snapshot.source,
    linkExternal,
  });
  try {
    if (snapshot.source.sourceFingerprint !== handle.sourceFingerprint) {
      throw new Error("reconstruction fingerprint drifted");
    }
    linkNodeModules(handle.worktreePath);
    const run = runDashboard(handle.worktreePath, label);
    return { run, linkedRoots: handle.linkedRoots ?? [], fingerprint: handle.sourceFingerprint };
  } finally {
    removeRepairWorktree(handle);
  }
}

// --- freeze once, use for both arms -------------------------------------
const frozen = captureExecutionSnapshot({ repoRoot, label: "w2-2b-equivalence" });
console.log(`[equivalence] frozen executionSnapshotId ${frozen.executionSnapshotId.slice(0, 16)}`);
console.log(
  `[equivalence]   source ${frozen.sourceFingerprint.slice(0, 16)} | environment ${frozen.environmentFingerprint.slice(0, 16)}`,
);
console.log(`[equivalence]   ${frozen.environment.ignoredRootCount} gitignored roots on this machine`);

const beforeStatus = mainTreeStatus(repoRoot);

const armA = arm({
  findingId: "w22b-arm-a-source-only",
  linkExternal: false,
  snapshot: frozen,
  label: "arm A (source only)",
});
const armB = arm({
  findingId: "w22b-arm-b-with-roots",
  linkExternal: true,
  snapshot: frozen,
  label: "arm B (source + ignored roots)",
});

const afterStatus = mainTreeStatus(repoRoot);

// --- per-test comparison, never counts ----------------------------------
const allTests = new Set([...armA.run.failures.keys(), ...armB.run.failures.keys()]);
const classification = { MATCH_FAIL: [], ENVIRONMENT_DIVERGENCE: [], LINKING_DAMAGE: [] };

for (const test of allTests) {
  const inA = armA.run.failures.has(test);
  const inB = armB.run.failures.has(test);
  if (inA && inB) {
    const sameSignature = armA.run.failures.get(test) === armB.run.failures.get(test);
    classification.MATCH_FAIL.push({
      test,
      sameSignature,
      signatureA: armA.run.failures.get(test),
      signatureB: armB.run.failures.get(test),
    });
  } else if (inA && !inB) {
    // Fails without the roots, passes with them: a genuine environment escape.
    classification.ENVIRONMENT_DIVERGENCE.push({ test, signature: armA.run.failures.get(test) });
  } else {
    // Passes without the roots, fails with them: linking itself broke it.
    classification.LINKING_DAMAGE.push({ test, signature: armB.run.failures.get(test) });
  }
}

const damageBySignature = {};
for (const entry of classification.LINKING_DAMAGE) {
  const key = (entry.signature ?? "(none)").slice(0, 90);
  damageBySignature[key] = (damageBySignature[key] ?? 0) + 1;
}
const escapeBySignature = {};
for (const entry of classification.ENVIRONMENT_DIVERGENCE) {
  const key = (entry.signature ?? "(none)").slice(0, 90);
  escapeBySignature[key] = (escapeBySignature[key] ?? 0) + 1;
}

const totalTests = armA.run.totals.tests ?? null;
const environmentSensitive = new Set([
  ...classification.ENVIRONMENT_DIVERGENCE.map((entry) => entry.test),
  ...classification.LINKING_DAMAGE.map((entry) => entry.test),
]);

const summary = {
  generatedAt: new Date().toISOString(),
  method:
    "Two reconstructions of one frozen execution snapshot, identical in authored source (same sourceFingerprint) and differing only in whether the gitignored vendored roots are present. No comparison against the developer's live tree.",
  frozen: executionIdentity(frozen),
  ignoredRootCount: frozen.environment.ignoredRootCount,
  armA: {
    label: "source only (what an SH1 repair worktree gets)",
    failing: armA.run.failures.size,
    totals: armA.run.totals,
    fingerprint: armA.fingerprint,
  },
  armB: {
    label: "source + ignored roots junctioned",
    failing: armB.run.failures.size,
    totals: armB.run.totals,
    fingerprint: armB.fingerprint,
    linkedRootCount: armB.linkedRoots.length,
  },
  fingerprintsIdentical: armA.fingerprint === armB.fingerprint,
  comparison: {
    matchFail: classification.MATCH_FAIL.length,
    matchFailSameSignature: classification.MATCH_FAIL.filter((entry) => entry.sameSignature).length,
    matchFailDifferentSignature: classification.MATCH_FAIL.filter((entry) => !entry.sameSignature)
      .length,
    environmentDivergence: classification.ENVIRONMENT_DIVERGENCE.length,
    linkingDamage: classification.LINKING_DAMAGE.length,
    environmentSensitiveTests: environmentSensitive.size,
  },
  environmentDivergenceBySignature: escapeBySignature,
  linkingDamageBySignature: damageBySignature,
  details: classification,
  eligibility: {
    totalTests,
    environmentSensitive: environmentSensitive.size,
    eligible: totalTests === null ? null : totalTests - environmentSensitive.size,
    rule: "A test is ELIGIBLE as repair-verification evidence only if it behaves identically with and without the gitignored roots. Anything in ENVIRONMENT_DIVERGENCE or LINKING_DAMAGE is ENVIRONMENT_BLOCKED.",
  },
  userTreeUntouched: beforeStatus === afterStatus,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "equivalence-experiment.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(path.join(outDir, "arm-a.log"), armA.run.text, "utf8");
fs.writeFileSync(path.join(outDir, "arm-b.log"), armB.run.text, "utf8");

console.log(`[equivalence] match-fail ${summary.comparison.matchFail} (same signature ${summary.comparison.matchFailSameSignature})`);
console.log(`[equivalence] environment divergence ${summary.comparison.environmentDivergence}`);
console.log(`[equivalence] linking damage ${summary.comparison.linkingDamage}`);
console.log(`[equivalence] environment-sensitive tests ${summary.comparison.environmentSensitiveTests}`);
console.log(`[equivalence] user tree untouched: ${summary.userTreeUntouched}`);
