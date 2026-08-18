#!/usr/bin/env node

/**
 * W2-3F / A6 — the three shipped skills under three real checkout policies,
 * verified against the migrated pins by the repaired verifier.
 *
 * The skill CONTENT is committed and untouched by the repair, so a real
 * checkout is the honest way to produce each byte form. The migrated pins live
 * in the repair worktree and are not committed, so they are read from there.
 *
 * Checkout policy is passed per command. Nothing writes repository or global
 * git configuration.
 *
 * Run from the repaired worktree's `dashboard/` with --experimental-strip-types.
 * Argument 1: evidence directory. Argument 2: main repository root.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = path.resolve(process.argv[2] ?? ".");
const mainRepo = path.resolve(process.argv[3] ?? "../..");
const dashboardRoot = process.cwd();
const worktreeRoot = path.resolve(dashboardRoot, "..");

const { reviewedTextPin } = await import(
  pathToFileURL(path.join(dashboardRoot, "src/lib/hermes/skills.ts")).href
);

function git(args, cwd = mainRepo) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  return { status: run.status ?? 1, stdout: (run.stdout ?? "").trim(), stderr: (run.stderr ?? "").trim() };
}

const configBefore = git(["config", "--get", "core.autocrlf"]).stdout;
const globalBefore = git(["config", "--global", "--get", "core.autocrlf"]).stdout;
const head = git(["rev-parse", "HEAD"]).stdout;

/** The migrated pins, from the repaired worktree. */
const registry = JSON.parse(
  fs.readFileSync(path.join(worktreeRoot, ".agents/skills/registry.json"), "utf8"),
);
const SLUGS = Object.keys(registry.skills);

const base = fs.mkdtempSync(path.join(os.tmpdir(), "w23f-after-arms-"));
const arms = [];
for (const autocrlf of ["true", "false", "input"]) {
  const worktreePath = path.join(base, "arm-" + autocrlf);
  const added = git([
    "-c", "core.autocrlf=" + autocrlf,
    "worktree", "add", "--detach", "--no-checkout", worktreePath, head,
  ]);
  const checkout =
    added.status === 0
      ? git(["-c", "core.autocrlf=" + autocrlf, "checkout", head, "--", ".agents/skills"], worktreePath)
      : { status: 1 };
  const files = {};
  for (const slug of SLUGS) {
    const absolute = path.join(worktreePath, ".agents/skills", slug, "SKILL.md");
    if (!fs.existsSync(absolute)) {
      files[slug] = { present: false };
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    const pin = registry.skills[slug].fileHashes["SKILL.md"];
    files[slug] = {
      present: true,
      bytes: bytes.length,
      hasCrlf: bytes.includes(0x0d),
      migratedPin: pin,
      computedPin: reviewedTextPin(bytes),
      verifies: reviewedTextPin(bytes) === pin,
    };
  }
  arms.push({ checkoutPolicy: "core.autocrlf=" + autocrlf, checkoutOk: checkout.status === 0, files });
  if (added.status === 0) git(["worktree", "remove", "--force", worktreePath]);
}
git(["worktree", "prune"]);
fs.rmSync(base, { recursive: true, force: true });

const configAfter = git(["config", "--get", "core.autocrlf"]).stdout;
const globalAfter = git(["config", "--global", "--get", "core.autocrlf"]).stdout;

const perSkill = SLUGS.map((slug) => {
  const verifying = arms.filter((arm) => arm.files[slug]?.verifies).map((arm) => arm.checkoutPolicy);
  const byteForms = new Set(arms.map((arm) => arm.files[slug]?.hasCrlf));
  return {
    slug,
    verifiesUnder: verifying,
    verifiesUnderEveryPolicy: verifying.length === arms.length,
    byteFormsGenuinelyDifferedAcrossArms: byteForms.size > 1,
    perArm: Object.fromEntries(arms.map((arm) => [arm.checkoutPolicy, arm.files[slug]])),
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  question:
    "After the repair, does every shipped reviewed skill verify under every checkout policy the repository can apply?",
  headCommit: head,
  policiesTested: arms.map((arm) => arm.checkoutPolicy),
  pinsReadFrom: "the repaired worktree registry (migrated, uncommitted)",
  contentReadFrom: "real checkouts of the committed skill content",
  perSkill,
  allSkillsVerifyEverywhere: perSkill.every((entry) => entry.verifiesUnderEveryPolicy),
  repositoryAutocrlfBefore: configBefore,
  repositoryAutocrlfAfter: configAfter,
  repositoryConfigUnchanged: configBefore === configAfter,
  globalConfigUnchanged: globalBefore === globalAfter,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "checkout-matrix-after.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

for (const entry of perSkill) {
  console.log(
    entry.slug.padEnd(24) +
      " verifies under [" + entry.verifiesUnder.join(", ") + "]" +
      "  byte forms differed across arms: " + entry.byteFormsGenuinelyDifferedAcrossArms,
  );
}
console.log("all skills verify under every policy: " + summary.allSkillsVerifyEverywhere);
console.log("repo config unchanged: " + summary.repositoryConfigUnchanged + "; global unchanged: " + summary.globalConfigUnchanged);
