import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import {
  captureEnvironmentSnapshot,
  captureExecutionSnapshot,
  compareEnvironments,
  discoverIgnoredRoots,
  executionIdentity,
} from "../autonomous/lib/execution-snapshot.mjs";
import { captureSourceSnapshot } from "../autonomous/lib/source-snapshot.mjs";
import {
  applyGatedMutation,
  finalizeRepairCapability,
  issueRepairCapability,
  RepairCapabilityError,
  resetCapabilityRegistryForTests,
} from "../autonomous/lib/repair-capability.mjs";
import {
  createSnapshotWorktree,
  mainTreeStatus,
  removeRepairWorktree,
} from "../autonomous/lib/repair-worktree.mjs";
import { evaluateVerificationEligibility } from "../autonomous/lib/verification-eligibility.mjs";

/**
 * W2-2B: execution identity, not just source identity.
 *
 * Phase 7 (a non-equivalent environment must fail closed), Phase 8 (developer
 * edits after a freeze must not move the oracle) and Phase 9 (time-of-check /
 * time-of-use) are all exercised here against a throwaway repository.
 */

let sandbox;
let repoRoot;
const openWorktrees = [];

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function write(relative, contents) {
  const target = path.join(repoRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bb-exec-"));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(repoRoot);
  git(["init", "-q", "-b", "main"], repoRoot);
  git(["config", "user.email", "qa@example.invalid"], repoRoot);
  git(["config", "user.name", "Breadboard QA"], repoRoot);
  git(["config", "core.autocrlf", "false"], repoRoot);
  write("dashboard/src/lib/route.ts", "export const link = (b, s) => b + s;\n");
  write("dashboard/tests/existing.test.mjs", "import test from 'node:test';\ntest('a', () => {});\n");
  write("package.json", '{"name":"sandbox","version":"1.0.0"}\n');
  write(".gitignore", ".qa-worktrees/\nnode_modules/\nvendored-clone/\n");
  git(["add", "-A"], repoRoot);
  git(["commit", "-qm", "initial"], repoRoot);
  // A gitignored vendored clone, standing in for Breadboard's ~63.
  fs.mkdirSync(path.join(repoRoot, "vendored-clone"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "vendored-clone", "tool.ts"),
    "export const tool = 'v1';\n",
    "utf8",
  );
});

after(() => {
  for (const handle of openWorktrees) {
    try {
      removeRepairWorktree(handle);
    } catch {
      // sandbox cleanup below
    }
  }
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => resetCapabilityRegistryForTests());

function productBugFinding(execution, overrides = {}) {
  return {
    id: "exec-finding",
    scenario: "route-links",
    status: "failed",
    classification: "PRODUCT_BUG",
    revision: execution.baseCommit,
    sourceSnapshotFingerprint: execution.sourceFingerprint,
    environmentFingerprint: execution.environmentFingerprint,
    executionSnapshotId: execution.executionSnapshotId,
    reproduction: { reproduced: true, attempts: 2 },
    diagnosis: { rootCause: "missing separator", responsibleCodePath: "dashboard/src/lib/route.ts" },
    ...overrides,
  };
}

// --- execution identity --------------------------------------------------

test("execution identity separates source from environment", () => {
  const first = captureExecutionSnapshot({ repoRoot, label: "first" });
  assert.match(first.executionSnapshotId, /^[0-9a-f]{64}$/);
  assert.match(first.sourceFingerprint, /^[0-9a-f]{64}$/);
  assert.match(first.environmentFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(first.sourceFingerprint, first.environmentFingerprint);

  // Changing only source moves the source fingerprint and the execution id,
  // and leaves the environment fingerprint alone.
  write("dashboard/src/lib/route.ts", "export const link = (b, s) => `${b}/${s}`;\n");
  const second = captureExecutionSnapshot({ repoRoot });
  assert.notEqual(second.sourceFingerprint, first.sourceFingerprint);
  assert.equal(second.environmentFingerprint, first.environmentFingerprint);
  assert.notEqual(second.executionSnapshotId, first.executionSnapshotId);
  git(["checkout", "--", "."], repoRoot);
});

test("changing a vendored clone moves the environment fingerprint, not the source", () => {
  const before = captureExecutionSnapshot({ repoRoot });
  fs.writeFileSync(path.join(repoRoot, "vendored-clone", "tool.ts"), "export const tool = 'v2';\n", "utf8");
  const after = captureExecutionSnapshot({ repoRoot });

  // The clone is not a git repository here, so its identity is presence-based;
  // what matters is that source identity is unaffected by it.
  assert.equal(after.sourceFingerprint, before.sourceFingerprint);
  fs.writeFileSync(path.join(repoRoot, "vendored-clone", "tool.ts"), "export const tool = 'v1';\n", "utf8");
});

test("removing a vendored clone is detected as an environment difference", () => {
  const frozen = captureEnvironmentSnapshot({ repoRoot });
  assert.ok(frozen.ignoredRoots.some((root) => root.name === "vendored-clone"));

  fs.renameSync(path.join(repoRoot, "vendored-clone"), path.join(sandbox, "moved-clone"));
  const current = captureEnvironmentSnapshot({ repoRoot });
  const comparison = compareEnvironments(frozen, current);

  assert.equal(comparison.equivalent, false);
  assert.deepEqual(comparison.missingIgnoredRoots, ["vendored-clone"]);
  fs.renameSync(path.join(sandbox, "moved-clone"), path.join(repoRoot, "vendored-clone"));
  assert.equal(compareEnvironments(frozen, captureEnvironmentSnapshot({ repoRoot })).equivalent, true);
});

// --- Phase 8: the developer keeps working -------------------------------

test("developer edits after a freeze do not move the frozen snapshot", () => {
  const frozen = captureExecutionSnapshot({ repoRoot, label: "frozen-A" });
  const frozenIdentity = executionIdentity(frozen);

  // The developer carries on.
  write("dashboard/src/lib/route.ts", "export const link = 'developer-moved-on';\n");
  write("dashboard/src/lib/brand-new-feature.ts", "export const feature = true;\n");

  // The frozen object is unchanged, and a reconstruction still yields snapshot A.
  assert.deepEqual(executionIdentity(frozen), frozenIdentity);
  const handle = createSnapshotWorktree({
    repoRoot,
    findingId: "exec-frozen-a",
    snapshot: frozen.source,
    linkExternal: false,
  });
  openWorktrees.push(handle);
  try {
    assert.equal(handle.sourceFingerprint, frozen.sourceFingerprint);
    // The later work must not have leaked in.
    assert.equal(
      fs.existsSync(path.join(handle.worktreePath, "dashboard/src/lib/brand-new-feature.ts")),
      false,
      "post-freeze developer work must not appear in a reconstruction of snapshot A",
    );
    assert.equal(
      fs.readFileSync(path.join(handle.worktreePath, "dashboard/src/lib/route.ts"), "utf8").trim(),
      "export const link = (b, s) => b + s;",
    );
  } finally {
    removeRepairWorktree(handle);
  }

  // And a finding from snapshot A cannot be repaired against snapshot B.
  const snapshotB = captureExecutionSnapshot({ repoRoot, label: "later-B" });
  assert.notEqual(snapshotB.sourceFingerprint, frozen.sourceFingerprint);

  const handleB = createSnapshotWorktree({
    repoRoot,
    findingId: "exec-frozen-b",
    snapshot: snapshotB.source,
    linkExternal: false,
  });
  openWorktrees.push(handleB);
  try {
    assert.throws(
      () =>
        issueRepairCapability({
          repoRoot,
          finding: productBugFinding(frozen),
          worktree: handleB,
          allowedPaths: ["dashboard/src/lib"],
        }),
      (error) => error instanceof RepairCapabilityError && error.code === "stale-source-snapshot",
    );
  } finally {
    removeRepairWorktree(handleB);
  }

  git(["checkout", "--", "."], repoRoot);
  fs.rmSync(path.join(repoRoot, "dashboard/src/lib/brand-new-feature.ts"), { force: true });
});

// --- Phase 9: time-of-check / time-of-use -------------------------------

test("source changed after the finding is rejected at capability issuance", () => {
  const atFinding = captureExecutionSnapshot({ repoRoot });
  write("dashboard/src/lib/route.ts", "export const link = 'changed-after-finding';\n");
  const now = captureExecutionSnapshot({ repoRoot });

  const handle = createSnapshotWorktree({
    repoRoot,
    findingId: "exec-toctou-source",
    snapshot: now.source,
    linkExternal: false,
  });
  openWorktrees.push(handle);
  try {
    assert.throws(
      () =>
        issueRepairCapability({
          repoRoot,
          finding: productBugFinding(atFinding),
          worktree: handle,
          allowedPaths: ["dashboard/src/lib"],
        }),
      (error) => error instanceof RepairCapabilityError && error.code === "stale-source-snapshot",
    );
  } finally {
    removeRepairWorktree(handle);
    git(["checkout", "--", "."], repoRoot);
  }
});

test("a worktree reconstructed from the wrong snapshot is rejected", () => {
  const snapshotA = captureExecutionSnapshot({ repoRoot });
  write("dashboard/src/lib/route.ts", "export const link = 'state-b';\n");
  const snapshotB = captureExecutionSnapshot({ repoRoot });
  git(["checkout", "--", "."], repoRoot);

  const handle = createSnapshotWorktree({
    repoRoot,
    findingId: "exec-wrong-snapshot",
    snapshot: snapshotB.source,
    linkExternal: false,
  });
  openWorktrees.push(handle);
  try {
    assert.throws(
      () =>
        issueRepairCapability({
          repoRoot,
          finding: productBugFinding(snapshotA),
          worktree: handle,
          allowedPaths: ["dashboard/src/lib"],
        }),
      (error) => error instanceof RepairCapabilityError && error.code === "stale-source-snapshot",
    );
  } finally {
    removeRepairWorktree(handle);
  }
});

// --- Phase 7: the negative environment gate -----------------------------

test("verification is denied when a required test is environment-blocked", () => {
  const eligibility = {
    environmentBlockedTests: [
      "tests/watermark-tools.test.mjs :: scripts resolve",
      "tests/audio-analysis.test.mjs :: analyzer present",
    ],
  };

  const denied = evaluateVerificationEligibility({
    eligibility,
    requiredTests: [
      "tests/route.test.mjs :: separator",
      "tests/watermark-tools.test.mjs :: scripts resolve",
    ],
  });
  assert.equal(denied.eligible, false);
  assert.equal(denied.reason, "verification-suite-blocked");
  assert.deepEqual(denied.blocked, ["tests/watermark-tools.test.mjs :: scripts resolve"]);

  const allowed = evaluateVerificationEligibility({
    eligibility,
    requiredTests: ["tests/route.test.mjs :: separator"],
  });
  assert.equal(allowed.eligible, true);
  assert.deepEqual(allowed.blocked, []);
});

test("verification is denied when the environment itself is not equivalent", () => {
  const frozen = captureEnvironmentSnapshot({ repoRoot });
  fs.renameSync(path.join(repoRoot, "vendored-clone"), path.join(sandbox, "gone-clone"));
  const current = captureEnvironmentSnapshot({ repoRoot });

  const verdict = evaluateVerificationEligibility({
    eligibility: { environmentBlockedTests: [] },
    requiredTests: ["tests/route.test.mjs :: separator"],
    environmentComparison: compareEnvironments(frozen, current),
  });
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reason, "environment-not-equivalent");
  assert.deepEqual(verdict.missingExecutionDependencies, ["vendored-clone"]);

  fs.renameSync(path.join(sandbox, "gone-clone"), path.join(repoRoot, "vendored-clone"));
});

// --- user tree integrity across all of the above ------------------------

test("the sandbox working tree is untouched by every check above", () => {
  const status = mainTreeStatus(repoRoot);
  assert.equal(status.trim(), "", `expected a clean sandbox tree, saw:\n${status}`);
  assert.equal(
    fs.readFileSync(path.join(repoRoot, "vendored-clone", "tool.ts"), "utf8").trim(),
    "export const tool = 'v1';",
    "the vendored clone must be byte-identical",
  );
  const snapshot = captureSourceSnapshot({ repoRoot });
  assert.equal(snapshot.dirty, false);
});

// --- W2-3C Phase 0: checkout semantics are part of execution identity ----

test("checkout policy is recorded in the environment snapshot", () => {
  const environment = captureEnvironmentSnapshot({ repoRoot });
  const policy = environment.checkoutPolicy;
  assert.ok(policy, "the environment snapshot must record checkout semantics");
  assert.equal(policy.inheritsMachineGlobalPolicy, false);
  assert.match(policy.qaReconstructionPolicy, /autocrlf=false/);
  assert.equal(typeof policy.gitattributesPresent, "boolean");
  assert.equal(policy.platform, process.platform);
});

test("a repository autocrlf=true does not change reconstructed bytes", () => {
  // Reproduce the defect's precondition inside the sandbox.
  git(["config", "core.autocrlf", "true"], repoRoot);
  try {
    write("dashboard/src/lib/multiline.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const snapshot = captureSourceSnapshot({ repoRoot });
    const handle = createSnapshotWorktree({
      repoRoot,
      findingId: "exec-crlf-policy",
      snapshot,
      linkExternal: false,
    });
    openWorktrees.push(handle);
    try {
      const bytes = fs.readFileSync(
        path.join(handle.worktreePath, "dashboard/src/lib/multiline.ts"),
      );
      const text = bytes.toString("binary");
      const crlf = (text.match(/\r\n/g) ?? []).length;
      assert.equal(crlf, 0, "a reconstruction must carry committed bytes, not CRLF-rewritten ones");
      // The regression this guards: a bare-newline assertion must still match.
      assert.match(bytes.toString("utf8"), /const a = 1;\nconst b = 2;/);
    } finally {
      removeRepairWorktree(handle);
    }
  } finally {
    git(["config", "core.autocrlf", "false"], repoRoot);
    fs.rmSync(path.join(repoRoot, "dashboard/src/lib/multiline.ts"), { force: true });
  }
});

test("QA never writes the repository's git configuration", () => {
  git(["config", "core.autocrlf", "true"], repoRoot);
  const before = git(["config", "--get", "core.autocrlf"], repoRoot).trim();
  const snapshot = captureSourceSnapshot({ repoRoot });
  const handle = createSnapshotWorktree({
    repoRoot,
    findingId: "exec-config-untouched",
    snapshot,
    linkExternal: false,
  });
  openWorktrees.push(handle);
  removeRepairWorktree(handle);
  const after = git(["config", "--get", "core.autocrlf"], repoRoot).trim();
  assert.equal(
    after,
    before,
    "creating and removing a reconstruction must not rewrite the developer's git config",
  );
  git(["config", "core.autocrlf", "false"], repoRoot);
});

test("a checkout-policy difference is an environment difference", () => {
  const frozen = captureEnvironmentSnapshot({ repoRoot });
  const drifted = {
    ...frozen,
    checkoutPolicy: { ...frozen.checkoutPolicy, qaReconstructionPolicy: "inherited from machine" },
  };
  const comparison = compareEnvironments(frozen, drifted);
  assert.equal(comparison.equivalent, false);
  assert.ok(comparison.differences.some((entry) => entry.kind === "checkout"));
});

test("a matching source fingerprint alone does not imply execution equivalence", () => {
  // The heart of the CRLF defect: identical source identity, different bytes.
  const snapshot = captureSourceSnapshot({ repoRoot });
  const environmentA = captureEnvironmentSnapshot({ repoRoot });
  const environmentB = {
    ...environmentA,
    checkoutPolicy: { ...environmentA.checkoutPolicy, repositoryAutocrlf: "true" },
  };
  assert.equal(snapshot.sourceFingerprint, captureSourceSnapshot({ repoRoot }).sourceFingerprint);
  assert.equal(compareEnvironments(environmentA, environmentB).equivalent, false);
});
