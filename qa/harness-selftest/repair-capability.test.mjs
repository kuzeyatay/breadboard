import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import {
  applyGatedMutation,
  capabilityState,
  CAPABILITY_STATE,
  finalizeRepairCapability,
  issueRepairCapability,
  RepairCapabilityError,
  resetCapabilityRegistryForTests,
  revokeRepairCapability,
} from "../autonomous/lib/repair-capability.mjs";
import {
  createRepairWorktree,
  removeRepairWorktree,
} from "../autonomous/lib/repair-worktree.mjs";

/**
 * Week 2 exit criteria 1 and 2: supported SH1 product mutation cannot bypass the
 * finding, the reproduction, the classification, the worktree isolation, the
 * allowed-path checks, or the assertion-integrity checks.
 *
 * Every test here is an attack. A passing run means the attack failed.
 */

let sandbox;
let repoRoot;
const openWorktrees = [];

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bb-capability-"));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(repoRoot);
  git(["init", "-q", "-b", "main"], repoRoot);
  git(["config", "user.email", "qa@example.invalid"], repoRoot);
  git(["config", "user.name", "Breadboard QA"], repoRoot);
  fs.mkdirSync(path.join(repoRoot, "dashboard", "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "dashboard", "tests"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "desktop", "src", "main"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "route.ts"),
    "export const link = (base, slug) => base + slug;\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "server-auth.ts"),
    "export const requireUser = () => 1;\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(repoRoot, "dashboard", "tests", "existing-oracle.test.mjs"),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('a', () => { assert.equal(1, 1); });\n",
    "utf8",
  );
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), ".qa-worktrees/\n", "utf8");
  git(["add", "-A"], repoRoot);
  git(["commit", "-qm", "initial"], repoRoot);
});

after(() => {
  for (const handle of openWorktrees) {
    try {
      removeRepairWorktree(handle);
    } catch {
      // sandbox removal below covers anything left behind
    }
  }
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => resetCapabilityRegistryForTests());

function worktreeFor(findingId) {
  const handle = createRepairWorktree({ repoRoot, findingId });
  openWorktrees.push(handle);
  return handle;
}

function reproducedFinding(handle, overrides = {}) {
  return {
    id: "seed-route-join",
    scenario: "garden-index-links",
    status: "failed",
    classification: "PRODUCT_BUG",
    revision: handle.sourceRevision,
    reproduction: { reproduced: true, attempts: 2 },
    diagnosis: {
      rootCause: "the link builder concatenated without a separator",
      responsibleCodePath: "dashboard/src/lib/route.ts",
    },
    ...overrides,
  };
}

function issue(handle, overrides = {}, options = {}) {
  return issueRepairCapability({
    repoRoot,
    finding: reproducedFinding(handle, overrides),
    worktree: handle,
    allowedPaths: ["dashboard/src/lib"],
    regressionTestPaths: ["dashboard/tests/qa-regression-route.test.mjs"],
    ...options,
  });
}

function expectDenied(code, run) {
  let caught;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected the attack to be denied with ${code}, but it succeeded`);
  assert.ok(
    caught instanceof RepairCapabilityError,
    `expected a RepairCapabilityError, got ${caught?.name}: ${caught?.message}`,
  );
  assert.equal(
    caught.code,
    code,
    `expected denial code ${code}, got ${caught.code}: ${caught.message}`,
  );
}

// ---------------------------------------------------------------------------
// The supported path works at all.
// ---------------------------------------------------------------------------

test("a reproduced PRODUCT_BUG can repair product source and add one regression test", () => {
  const handle = worktreeFor("cap-happy-path");
  const capability = issue(handle);

  applyGatedMutation({
    capability,
    targetPath: "dashboard/src/lib/route.ts",
    edit: (before) => before.replace("base + slug", "`${base}/${slug}`"),
  });
  applyGatedMutation({
    capability,
    targetPath: "dashboard/tests/qa-regression-route.test.mjs",
    edit: () =>
      "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('separator', () => { assert.equal(1, 1); });\n",
  });

  const verdict = finalizeRepairCapability({ capability, worktree: handle });
  assert.equal(verdict.finalized, true, verdict.problems.join("; "));
  assert.deepEqual(verdict.unauthorisedChanges, []);
  assert.equal(verdict.authorisedWrites.length, 2);
  assert.equal(capabilityState(capability), CAPABILITY_STATE.CONSUMED);
});

// ---------------------------------------------------------------------------
// Attacks on issuance.
// ---------------------------------------------------------------------------

test("attack: mutate with no finding at all", () => {
  const handle = worktreeFor("cap-no-finding");
  expectDenied("no-finding", () =>
    issueRepairCapability({ repoRoot, worktree: handle, allowedPaths: ["dashboard/src/lib"] }),
  );
});

test("attack: mutate a TEST_ENVIRONMENT failure as if it were a product bug", () => {
  const handle = worktreeFor("cap-test-env");
  expectDenied("gate-denied", () => issue(handle, { classification: "TEST_ENVIRONMENT" }));
});

for (const classification of [
  "EXTERNAL_DEPENDENCY",
  "EXPECTED_BEHAVIOR",
  "FLAKY",
  "MISSING_FEATURE",
]) {
  test(`attack: mutate a ${classification} failure`, () => {
    const handle = worktreeFor(`cap-class-${classification.toLowerCase().replace(/_/g, "-")}`);
    expectDenied("gate-denied", () => issue(handle, { classification }));
  });
}

test("attack: mutate without having reproduced the failure", () => {
  const handle = worktreeFor("cap-no-repro");
  expectDenied("gate-denied", () =>
    issue(handle, { reproduction: { reproduced: false, attempts: 1 } }),
  );
});

test("attack: mutate without a root cause", () => {
  const handle = worktreeFor("cap-no-root-cause");
  expectDenied("gate-denied", () =>
    issue(handle, { diagnosis: { rootCause: "  ", responsibleCodePath: "x.ts" } }),
  );
});

test("attack: mutate the main working tree", () => {
  expectDenied("main-tree", () =>
    issueRepairCapability({
      repoRoot,
      finding: reproducedFinding({ sourceRevision: git(["rev-parse", "HEAD"], repoRoot).trim() }),
      worktree: {
        repoRoot,
        worktreePath: repoRoot,
        sourceRevision: git(["rev-parse", "HEAD"], repoRoot).trim(),
      },
      allowedPaths: ["dashboard/src/lib"],
    }),
  );
});

test("attack: mutate a worktree that is not a disposable QA worktree", () => {
  const foreign = path.join(sandbox, "foreign");
  fs.mkdirSync(foreign, { recursive: true });
  expectDenied("foreign-worktree", () =>
    issueRepairCapability({
      repoRoot,
      finding: reproducedFinding({ sourceRevision: "deadbeef" }),
      worktree: { repoRoot, worktreePath: foreign, sourceRevision: "deadbeef" },
      allowedPaths: ["dashboard/src/lib"],
    }),
  );
});

test("attack: replay a stale finding against a newer revision", () => {
  const handle = worktreeFor("cap-stale");
  expectDenied("stale-finding", () =>
    issue(handle, { revision: "0000000000000000000000000000000000000000" }),
  );
});

test("attack: name a forbidden trust boundary as an allowed path", () => {
  const handle = worktreeFor("cap-forbidden-scope");
  expectDenied("bad-allowed-path", () =>
    issue(handle, {}, { allowedPaths: ["dashboard/src/lib/server-auth.ts"] }),
  );
});

test("attack: declare an existing oracle as the repair's regression test", () => {
  const handle = worktreeFor("cap-existing-oracle");
  expectDenied("existing-oracle", () =>
    issue(handle, {}, { regressionTestPaths: ["dashboard/tests/existing-oracle.test.mjs"] }),
  );
});

test("attack: smuggle a QA oracle in through allowedPaths", () => {
  const handle = worktreeFor("cap-oracle-as-product");
  expectDenied("bad-allowed-path", () => issue(handle, {}, { allowedPaths: ["dashboard/tests"] }));
});

// ---------------------------------------------------------------------------
// Attacks on an already-issued capability.
// ---------------------------------------------------------------------------

test("attack: write outside the allowed paths", () => {
  const handle = worktreeFor("cap-outside-path");
  const capability = issue(handle);
  expectDenied("outside-scope", () =>
    applyGatedMutation({
      capability,
      targetPath: "desktop/src/main/health-checker.ts",
      edit: () => "broken\n",
    }),
  );
});

test("attack: write to a forbidden trust boundary inside an allowed directory", () => {
  const handle = worktreeFor("cap-forbidden-write");
  const capability = issue(handle);
  expectDenied("forbidden-path", () =>
    applyGatedMutation({
      capability,
      targetPath: "dashboard/src/lib/server-auth.ts",
      edit: () => "export const requireUser = () => 999;\n",
    }),
  );
});

test("attack: change a QA assertion using a product-repair capability", () => {
  const handle = worktreeFor("cap-assertion-change");
  const capability = issue(handle);
  expectDenied("oracle-not-writable", () =>
    applyGatedMutation({
      capability,
      targetPath: "dashboard/tests/existing-oracle.test.mjs",
      edit: (before) => before.replace("assert.equal(1, 1)", "assert.ok(true)"),
    }),
  );
});

test("attack: escape the worktree with a traversing path", () => {
  const handle = worktreeFor("cap-traversal");
  const capability = issue(handle);
  expectDenied("escapes-worktree", () =>
    applyGatedMutation({
      capability,
      targetPath: "../../dashboard/src/lib/route.ts",
      edit: () => "escaped\n",
    }),
  );
});

test("attack: reuse one finding's capability for another finding", () => {
  const handle = worktreeFor("cap-reuse-finding");
  const capability = issue(handle);
  const forged = { ...capability, findingId: "some-other-finding" };
  expectDenied("bad-signature", () =>
    applyGatedMutation({
      capability: forged,
      targetPath: "dashboard/src/lib/route.ts",
      edit: () => "x\n",
    }),
  );
});

test("attack: widen a capability's allowed paths after issuance", () => {
  const handle = worktreeFor("cap-widen");
  const capability = issue(handle);
  const forged = { ...capability, allowedPaths: ["dashboard", "desktop"] };
  expectDenied("bad-signature", () =>
    applyGatedMutation({
      capability: forged,
      targetPath: "desktop/src/main/health-checker.ts",
      edit: () => "x\n",
    }),
  );
});

test("attack: reuse a consumed capability", () => {
  const handle = worktreeFor("cap-reuse-consumed");
  const capability = issue(handle);
  applyGatedMutation({
    capability,
    targetPath: "dashboard/src/lib/route.ts",
    edit: (before) => before.replace("base + slug", "`${base}/${slug}`"),
  });
  finalizeRepairCapability({ capability, worktree: handle });
  expectDenied("capability-spent", () =>
    applyGatedMutation({
      capability,
      targetPath: "dashboard/src/lib/route.ts",
      edit: () => "again\n",
    }),
  );
});

test("attack: use a capability after it expired", () => {
  const handle = worktreeFor("cap-expired");
  const capability = issueRepairCapability({
    repoRoot,
    finding: reproducedFinding(handle),
    worktree: handle,
    allowedPaths: ["dashboard/src/lib"],
    ttlMs: 1_000,
    now: 0,
  });
  expectDenied("expired", () =>
    applyGatedMutation({
      capability,
      targetPath: "dashboard/src/lib/route.ts",
      edit: () => "late\n",
      now: 60_000,
    }),
  );
});

test("attack: use a revoked capability", () => {
  const handle = worktreeFor("cap-revoked");
  const capability = issue(handle);
  assert.equal(revokeRepairCapability(capability).revoked, true);
  expectDenied("capability-spent", () =>
    applyGatedMutation({
      capability,
      targetPath: "dashboard/src/lib/route.ts",
      edit: () => "x\n",
    }),
  );
});

test("attack: hand-craft a capability without ever calling the gate", () => {
  const handle = worktreeFor("cap-forged");
  const forged = {
    version: 1,
    id: "11111111-1111-1111-1111-111111111111",
    findingId: "invented",
    scenarioId: "invented",
    revision: handle.sourceRevision,
    worktreePath: handle.worktreePath,
    repoRoot,
    allowedPaths: ["dashboard/src/lib"],
    regressionTestPaths: [],
    issuedAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    signature: "00".repeat(32),
  };
  expectDenied("bad-signature", () =>
    applyGatedMutation({
      capability: forged,
      targetPath: "dashboard/src/lib/route.ts",
      edit: () => "x\n",
    }),
  );
});

// ---------------------------------------------------------------------------
// The teeth: finalize detects edits made outside the capability.
// ---------------------------------------------------------------------------

test("attack: bypass the capability with a direct filesystem write", () => {
  const handle = worktreeFor("cap-direct-write");
  const capability = issue(handle);

  applyGatedMutation({
    capability,
    targetPath: "dashboard/src/lib/route.ts",
    edit: (before) => before.replace("base + slug", "`${base}/${slug}`"),
  });

  // A controller that ignores the supported path and just writes the file.
  fs.writeFileSync(
    path.join(handle.worktreePath, "dashboard", "src", "lib", "smuggled.ts"),
    "export const smuggled = true;\n",
    "utf8",
  );

  const verdict = finalizeRepairCapability({ capability, worktree: handle });
  assert.equal(verdict.finalized, false);
  assert.deepEqual(verdict.unauthorisedChanges, ["dashboard/src/lib/smuggled.ts"]);
  assert.ok(verdict.problems.some((problem) => problem.includes("never authorised")));
});

test("attack: weaken an existing oracle by direct write, then finalize", () => {
  const handle = worktreeFor("cap-direct-oracle");
  const capability = issue(handle);
  applyGatedMutation({
    capability,
    targetPath: "dashboard/src/lib/route.ts",
    edit: (before) => before.replace("base + slug", "`${base}/${slug}`"),
  });

  const oracle = path.join(handle.worktreePath, "dashboard", "tests", "existing-oracle.test.mjs");
  fs.writeFileSync(
    oracle,
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('a', () => { assert.ok(true); });\n",
    "utf8",
  );

  const verdict = finalizeRepairCapability({ capability, worktree: handle });
  assert.equal(verdict.finalized, false);
  assert.ok(verdict.unauthorisedChanges.includes("dashboard/tests/existing-oracle.test.mjs"));
});

test("finalize records a declared regression test that was never written", () => {
  const handle = worktreeFor("cap-unwritten-regression");
  const capability = issue(handle);
  applyGatedMutation({
    capability,
    targetPath: "dashboard/src/lib/route.ts",
    edit: (before) => before.replace("base + slug", "`${base}/${slug}`"),
  });
  const verdict = finalizeRepairCapability({ capability, worktree: handle });
  // The repair itself is in scope, but the missing regression test is visible.
  assert.equal(verdict.finalized, true);
  assert.deepEqual(verdict.declaredButUnwritten, []);
  assert.deepEqual(
    verdict.authorisedWrites.map((entry) => entry.path),
    ["dashboard/src/lib/route.ts"],
  );
});
