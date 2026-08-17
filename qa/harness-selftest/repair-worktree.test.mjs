import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import {
  captureDiff,
  changedFiles,
  createRepairWorktree,
  mainTreeStatus,
  removeRepairWorktree,
  rollbackInstructions,
  verifyRepairWorktree,
  WORKTREE_ROOT_NAME,
} from "../autonomous/lib/repair-worktree.mjs";

/**
 * Worktree isolation is tested against a throwaway repository, never against
 * Breadboard itself: the point is to prove the helper cannot touch a main tree,
 * and running it on the real one to find that out would be self-defeating.
 */

let sandbox;
let repoRoot;

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bb-worktree-"));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(repoRoot);
  git(["init", "-q", "-b", "main"], repoRoot);
  git(["config", "user.email", "qa@example.invalid"], repoRoot);
  git(["config", "user.name", "Breadboard QA"], repoRoot);
  fs.mkdirSync(path.join(repoRoot, "dashboard", "src", "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "route.ts"),
    "export const link = (base, slug) => base + slug;\n",
    "utf8",
  );
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), `${WORKTREE_ROOT_NAME}/\n`, "utf8");
  git(["add", "-A"], repoRoot);
  git(["commit", "-qm", "initial"], repoRoot);
});

after(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

test("a repair worktree is created below .qa-worktrees at the requested revision", () => {
  const handle = createRepairWorktree({ repoRoot, findingId: "seed-route-join" });
  try {
    assert.equal(
      path.dirname(handle.worktreePath),
      path.join(repoRoot, WORKTREE_ROOT_NAME),
    );
    assert.equal(handle.isolationVerified, true);
    const verification = verifyRepairWorktree(handle);
    assert.equal(verification.verified, true, verification.problems.join("; "));
    assert.match(rollbackInstructions(handle), /git worktree remove --force/);
  } finally {
    removeRepairWorktree(handle);
  }
});

test("editing in the worktree never changes the main working tree", () => {
  const before = mainTreeStatus(repoRoot);
  const handle = createRepairWorktree({ repoRoot, findingId: "seed-isolation-check" });
  try {
    const target = path.join(handle.worktreePath, "dashboard", "src", "lib", "route.ts");
    fs.writeFileSync(target, "export const link = (base, slug) => `${base}/${slug}`;\n", "utf8");
    fs.writeFileSync(
      path.join(handle.worktreePath, "dashboard", "src", "lib", "route.test.mjs"),
      "// regression test\n",
      "utf8",
    );

    assert.deepEqual(changedFiles(handle).sort(), [
      "dashboard/src/lib/route.test.mjs",
      "dashboard/src/lib/route.ts",
    ]);
    const diff = captureDiff(handle);
    assert.match(diff, /dashboard\/src\/lib\/route\.ts/);
    assert.match(diff, /dashboard\/src\/lib\/route\.test\.mjs/, "untracked additions must be diffed");

    assert.equal(
      mainTreeStatus(repoRoot),
      before,
      "the main working tree must be byte-identical after a worktree repair",
    );
    assert.equal(
      fs.readFileSync(path.join(repoRoot, "dashboard", "src", "lib", "route.ts"), "utf8"),
      "export const link = (base, slug) => base + slug;\n",
    );
  } finally {
    removeRepairWorktree(handle);
  }
});

test("a repair worktree is fully removed on rollback", () => {
  const handle = createRepairWorktree({ repoRoot, findingId: "seed-rollback" });
  fs.writeFileSync(path.join(handle.worktreePath, "scratch.txt"), "dirty\n", "utf8");
  const removal = removeRepairWorktree(handle);
  assert.equal(removal.removed, true);
  assert.equal(fs.existsSync(handle.worktreePath), false);
  assert.equal(verifyRepairWorktree(handle).verified, false);
});

test("two repairs cannot share one worktree directory", () => {
  const handle = createRepairWorktree({ repoRoot, findingId: "seed-collision" });
  try {
    assert.throws(
      () => createRepairWorktree({ repoRoot, findingId: "seed-collision" }),
      /already exists/,
    );
  } finally {
    removeRepairWorktree(handle);
  }
});

test("an unsafe finding id is refused before git is invoked", () => {
  for (const findingId of ["../escape", "a", "Seed_Upper", "seed/nested", ""]) {
    assert.throws(
      () => createRepairWorktree({ repoRoot, findingId }),
      /Invalid finding id/,
      `${JSON.stringify(findingId)} must be refused`,
    );
  }
  assert.equal(fs.existsSync(path.join(repoRoot, WORKTREE_ROOT_NAME, "..")), true);
});

test("verification notices a worktree that no longer sits at the source revision", () => {
  const handle = createRepairWorktree({ repoRoot, findingId: "seed-revision-drift" });
  try {
    fs.writeFileSync(path.join(handle.worktreePath, "extra.txt"), "x\n", "utf8");
    git(["add", "-A"], handle.worktreePath);
    git(["commit", "-qm", "unexpected commit"], handle.worktreePath);
    const verification = verifyRepairWorktree(handle);
    assert.equal(verification.verified, false);
    assert.ok(verification.problems.some((problem) => problem.includes("no longer matches")));
  } finally {
    removeRepairWorktree(handle);
  }
});
