#!/usr/bin/env node

/**
 * W2-3E: does a FRESH checkout of the reviewed commit produce a working skill?
 *
 * The analytic answer above says the pin is unreachable for one skill and
 * CRLF-only for the other. Analysis is not execution, and the severity of the
 * finding turns on this exact question — a new user cloning the repository
 * either gets a working skill or does not — so both checkout policies are
 * materialised for real and hashed.
 *
 * Checkout policy is passed per command with `-c`. Nothing here writes
 * repository or global git configuration; W2-3C established why that matters.
 *
 * Run from the repository root.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const outPath = path.resolve(process.argv[2] ?? "checkout-arm-experiment.json");
const repoRoot = process.cwd();

function git(args, cwd = repoRoot) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

const configBefore = git(["config", "--get", "core.autocrlf"]).stdout;
const globalBefore = git(["config", "--global", "--get", "core.autocrlf"]).stdout;

const head = git(["rev-parse", "HEAD"]).stdout;
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, ".agents/skills/registry.json"), "utf8"));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const SKILLS = ["bullshit-detector", "premortem"];

const base = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-w23e-checkout-"));
const arms = [];

for (const autocrlf of ["true", "false"]) {
  const worktreePath = path.join(base, `arm-autocrlf-${autocrlf}`);
  const added = git([
    "-c",
    `core.autocrlf=${autocrlf}`,
    "worktree",
    "add",
    "--detach",
    "--no-checkout",
    worktreePath,
    head,
  ]);
  // Check out only the reviewed skill tree: the whole repository is not needed
  // to answer a question about six kilobytes of markdown.
  const checkout =
    added.status === 0
      ? git(["-c", `core.autocrlf=${autocrlf}`, "checkout", head, "--", ".agents/skills"], worktreePath)
      : { status: 1, stderr: "worktree add failed" };

  const files = {};
  for (const slug of SKILLS) {
    const absolute = path.join(worktreePath, ".agents/skills", slug, "SKILL.md");
    if (!fs.existsSync(absolute)) {
      files[slug] = { present: false };
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    const pin = registry.skills?.[slug]?.localHash ?? null;
    files[slug] = {
      present: true,
      bytes: bytes.length,
      hasCrlf: bytes.includes(0x0d),
      sha256: sha256(bytes),
      pin,
      matchesPin: sha256(bytes) === pin,
    };
  }

  arms.push({
    checkoutPolicy: `core.autocrlf=${autocrlf}`,
    worktreeCreated: added.status === 0,
    checkoutOk: checkout.status === 0,
    error: added.status === 0 ? checkout.stderr || null : added.stderr,
    files,
  });

  if (added.status === 0) {
    git(["worktree", "remove", "--force", worktreePath]);
  }
}

git(["worktree", "prune"]);
fs.rmSync(base, { recursive: true, force: true });

const configAfter = git(["config", "--get", "core.autocrlf"]).stdout;
const globalAfter = git(["config", "--global", "--get", "core.autocrlf"]).stdout;

const perSkill = SKILLS.map((slug) => {
  const matching = arms.filter((arm) => arm.files[slug]?.matchesPin).map((arm) => arm.checkoutPolicy);
  return {
    slug,
    checkoutPoliciesThatVerify: matching,
    verifiesUnderAnyCheckout: matching.length > 0,
    verifiesUnderThisRepositoryPolicy: matching.includes(`core.autocrlf=${configBefore || "false"}`),
    perArm: Object.fromEntries(arms.map((arm) => [arm.checkoutPolicy, arm.files[slug]])),
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  question:
    "Does a fresh checkout of the reviewed commit produce skill bytes that verify against the reviewed registry pin?",
  headCommit: head,
  repositoryAutocrlfBefore: configBefore,
  repositoryAutocrlfAfter: configAfter,
  repositoryConfigUnchanged: configBefore === configAfter,
  globalAutocrlfBefore: globalBefore,
  globalAutocrlfAfter: globalAfter,
  globalConfigUnchanged: globalBefore === globalAfter,
  arms,
  perSkill,
  conclusion: perSkill.every((entry) => entry.verifiesUnderThisRepositoryPolicy)
    ? "Every reviewed skill verifies on a fresh checkout under this repository's own policy."
    : "At least one reviewed skill cannot verify on a fresh checkout, so the shipped product disables it for the user who cloned it.",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

for (const entry of perSkill) {
  console.log(
    `[checkout-arms] ${entry.slug}: verifies under ${entry.checkoutPoliciesThatVerify.length ? entry.checkoutPoliciesThatVerify.join(", ") : "NO policy"}`,
  );
  for (const [policy, file] of Object.entries(entry.perArm)) {
    console.log(`    ${policy}: bytes=${file?.bytes} crlf=${file?.hasCrlf} matchesPin=${file?.matchesPin}`);
  }
}
console.log(`[checkout-arms] repository config unchanged: ${summary.repositoryConfigUnchanged} (${configBefore} -> ${configAfter})`);
console.log(`[checkout-arms] global config unchanged: ${summary.globalConfigUnchanged}`);
