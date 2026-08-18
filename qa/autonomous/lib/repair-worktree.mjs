/**
 * Disposable git worktree isolation for repair experiments.
 *
 * No repair may be made in the main working tree, which in this repository
 * routinely carries unrelated uncommitted user work. Every candidate patch is
 * created in a detached worktree under `.qa-worktrees/<finding-id>/`, verified
 * against the source revision, diffed, and then discarded.
 *
 * Nothing here ever commits, pushes, stages, or touches the main tree's index.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { materializeSnapshot } from "./source-snapshot.mjs";

export const WORKTREE_ROOT_NAME = ".qa-worktrees";

/**
 * Checkout policy for every QA-owned git command that writes working-tree files.
 *
 * This repository sets `core.autocrlf=true`, so an ordinary checkout rewrites
 * text files to CRLF while the developer's tree keeps whatever their editor
 * wrote. That difference made ten source-contract assertions fail only in
 * reconstructions. Passing the policy per command keeps reconstructions on the
 * committed bytes without touching the developer's configuration.
 */
export const DETERMINISTIC_CHECKOUT = Object.freeze(["-c", "core.autocrlf=false"]);

const FINDING_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitOrThrow(args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function resolveRevision(repoRoot, revision = "HEAD") {
  return gitOrThrow(["rev-parse", revision], repoRoot).trim();
}

/**
 * Create the isolated worktree. Returns a handle carrying everything a receipt
 * needs to prove the repair happened outside the main tree.
 */
export function createRepairWorktree({ repoRoot, findingId, revision = "HEAD" }) {
  if (!FINDING_ID_PATTERN.test(String(findingId))) {
    throw new Error(
      `Invalid finding id ${JSON.stringify(findingId)}; use 3-64 lowercase letters, digits, or dashes`,
    );
  }
  const resolvedRepo = path.resolve(repoRoot);
  const worktreeRoot = path.join(resolvedRepo, WORKTREE_ROOT_NAME);
  const worktreePath = path.join(worktreeRoot, findingId);
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Repair worktree already exists: ${worktreePath}`);
  }
  const sourceRevision = resolveRevision(resolvedRepo, revision);

  fs.mkdirSync(worktreeRoot, { recursive: true });
  // `core.autocrlf=true` is set on this repository, so an ordinary checkout
  // rewrites every text file to CRLF. The developer's tree holds whatever their
  // editor wrote (LF here), so a reconstruction would differ from it byte for
  // byte while still matching on `git diff`, which normalises. That gap made ten
  // source-contract assertions fail in every QA reconstruction and pass for the
  // developer — a harness artefact indistinguishable from a contract failure.
  // Checking out with autocrlf disabled gives the committed bytes.
  //
  // The policy is passed per command with `-c`, never written with `git config`:
  // a worktree shares the repository's config file, so writing there would
  // silently change the developer's own checkout behaviour. QA must not mutate
  // the user's git configuration to make its own reconstructions deterministic.
  gitOrThrow(
    [...DETERMINISTIC_CHECKOUT, "worktree", "add", "--detach", worktreePath, sourceRevision],
    resolvedRepo,
  );

  const checkedOut = resolveRevision(worktreePath, "HEAD");
  if (checkedOut !== sourceRevision) {
    removeRepairWorktree({ repoRoot: resolvedRepo, worktreePath });
    throw new Error(
      `Repair worktree checked out ${checkedOut} but ${sourceRevision} was requested`,
    );
  }

  const initialStatus = gitOrThrow(["status", "--porcelain"], worktreePath);
  if (initialStatus.trim() !== "") {
    removeRepairWorktree({ repoRoot: resolvedRepo, worktreePath });
    throw new Error(`Repair worktree was not clean at creation:\n${initialStatus}`);
  }

  return {
    findingId,
    repoRoot: resolvedRepo,
    worktreePath,
    sourceRevision,
    createdAt: new Date().toISOString(),
    isolationVerified: true,
  };
}

/** Verify the handle still describes an isolated, correctly based worktree. */
export function verifyRepairWorktree(handle) {
  const problems = [];
  if (!fs.existsSync(handle.worktreePath)) {
    problems.push(`worktree path is missing: ${handle.worktreePath}`);
    return { verified: false, problems };
  }
  const resolvedWorktree = fs.realpathSync(handle.worktreePath);
  const resolvedRepo = fs.realpathSync(handle.repoRoot);
  const expectedRoot = path.join(resolvedRepo, WORKTREE_ROOT_NAME);
  if (!resolvedWorktree.startsWith(expectedRoot + path.sep)) {
    problems.push(`worktree ${resolvedWorktree} is not below ${expectedRoot}`);
  }
  const head = resolveRevision(handle.worktreePath, "HEAD");
  // A repair leaves the worktree dirty but never commits, so HEAD must still be
  // the exact source revision the experiment started from.
  if (head !== handle.sourceRevision) {
    problems.push(`worktree HEAD ${head} no longer matches source revision ${handle.sourceRevision}`);
  }
  return { verified: problems.length === 0, problems, worktreeHead: head };
}

/** Names of files changed in the worktree, including untracked additions. */
export function changedFiles(handle) {
  const porcelain = gitOrThrow(["status", "--porcelain", "-uall"], handle.worktreePath);
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3).trim())
    .map((entry) => {
      const renamed = entry.split(" -> ");
      return renamed.length > 1 ? renamed[1] : entry;
    })
    .map((entry) => entry.replace(/^"|"$/g, ""));
}

/**
 * Full candidate diff. Untracked files are included with `--no-index` so a new
 * regression test is reviewed by the assertion guard exactly like an edit.
 */
/**
 * The diff of a repair worktree, optionally narrowed to specific paths.
 *
 * `paths` matters on a snapshot worktree. That worktree deliberately carries the
 * developer's whole in-flight tree, so an unnarrowed diff describes their work
 * rather than the repair — and anything that adjudicates the diff, such as the
 * assertion-integrity guard, would be judging edits the repair never made. Pass
 * the changed-file set the capability actually authorised to see only the repair.
 */
export function captureDiff(handle, paths = null) {
  const scope = Array.isArray(paths) && paths.length > 0 ? ["--", ...paths] : [];
  const tracked = gitOrThrow(["diff", "HEAD", ...scope], handle.worktreePath);
  const untrackedAll = gitOrThrow(["ls-files", "--others", "--exclude-standard"], handle.worktreePath)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const untracked =
    scope.length === 0
      ? untrackedAll
      : untrackedAll.filter((file) => paths.includes(file.replace(/\\/g, "/")));
  let extra = "";
  for (const file of untracked) {
    const result = git(["diff", "--no-index", "--", "/dev/null", file], handle.worktreePath);
    // --no-index exits 1 when files differ, which is the normal case here.
    if (result.stdout) extra += result.stdout;
  }
  return tracked + extra;
}

export function diffStat(handle) {
  return gitOrThrow(["diff", "--stat", "HEAD"], handle.worktreePath).trim();
}

/** Assert the main working tree was untouched by comparing status snapshots. */
export function mainTreeStatus(repoRoot) {
  return gitOrThrow(["status", "--porcelain", "-uall"], path.resolve(repoRoot));
}

/**
 * A status snapshot narrowed to the paths one experiment could plausibly touch.
 *
 * This repository is worked on concurrently, so a whole-tree byte comparison
 * would flag a developer editing an unrelated file as if the QA loop had done
 * it. Scoping keeps the check meaningful — it still fails if the experiment
 * writes anywhere inside its own blast radius — while whole-tree drift is
 * reported separately as external activity rather than as a QA violation.
 */
export function scopedMainTreeStatus(repoRoot, scopePaths) {
  const normalized = scopePaths.map((entry) => entry.replace(/\\/g, "/").replace(/\/+$/, ""));
  return mainTreeStatus(repoRoot)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .filter((line) => {
      const filePath = line.slice(3).trim().replace(/^"|"$/g, "");
      return normalized.some(
        (scope) => filePath === scope || filePath.startsWith(`${scope}/`),
      );
    })
    .sort()
    .join("\n");
}

/** Content hash of a file in the main tree, or null when it does not exist. */
export function mainTreeFileFingerprint(repoRoot, relativePath) {
  const absolute = path.join(path.resolve(repoRoot), relativePath);
  if (!fs.existsSync(absolute)) return null;
  return createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
}

/**
 * Unlink every symlink/junction inside the worktree, deepest entries first.
 *
 * Callers junction the repository's real `node_modules` trees into the worktree
 * so the suite can resolve dependencies without a second install. On Windows
 * both `git worktree remove --force` and `fs.rmSync` recurse *through* a
 * junction and delete the target's contents, which empties the developer's real
 * `dashboard/node_modules` and leaves the workspace unable to start. Dropping
 * the links first makes either removal path safe.
 */
function unlinkNestedLinks(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      // A Windows directory junction refuses `unlink` and needs `rmdir`; a file
      // symlink is the other way round. Neither follows the link.
      try {
        fs.unlinkSync(absolute);
      } catch {
        try {
          fs.rmdirSync(absolute);
        } catch {
          // Leave it in place; git reports the failure through its own status.
        }
      }
      continue;
    }
    if (entry.isDirectory()) unlinkNestedLinks(absolute);
  }
}

export function removeRepairWorktree({ repoRoot, worktreePath }) {
  const resolvedRepo = path.resolve(repoRoot);
  unlinkNestedLinks(worktreePath);
  const result = git(["worktree", "remove", "--force", worktreePath], resolvedRepo);
  git(["worktree", "prune"], resolvedRepo);
  if (result.status !== 0 && fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
    git(["worktree", "prune"], resolvedRepo);
  }
  return { removed: !fs.existsSync(worktreePath), detail: result.stderr.trim() };
}

/**
 * Create a repair worktree that carries a specific source snapshot rather than
 * bare `HEAD`.
 *
 * This is the W2-2 fix. `createRepairWorktree` gives a clean checkout of a
 * commit, which is the wrong product when the user's tree is dirty. This creates
 * that worktree and then materialises the exact source the scenario ran against,
 * refusing to return a handle whose fingerprint does not match.
 */
/**
 * `linkExternal` defaults to **on**, reversing an earlier decision.
 *
 * A previous pass measured linking as harmful (227 failures against 120 at
 * HEAD) and disabled it. That measurement was confounded three ways: it compared
 * against a developer tree being edited throughout, it changed snapshot scope in
 * the same step, and it ran while worktree cleanup still recursed *through*
 * junctions and deleted the real `node_modules` — so later runs executed against
 * damaged dependencies.
 *
 * A controlled two-arm experiment — one frozen snapshot, identical source in
 * both arms, the ignored roots as the only variable — shows the opposite:
 * linking fixes 62 tests and changes 3, and the failures it fixes name their
 * cause outright ("the watermarks-remover scripts are not installed", "the
 * DeepTutor clone should be found next to the dashboard").
 *
 * Writes through these links are denied by `applyGatedMutation`'s realpath
 * check, so a repair still cannot touch a developer clone.
 */
export function createSnapshotWorktree({ repoRoot, findingId, snapshot, linkExternal = true }) {
  const handle = createRepairWorktree({
    repoRoot,
    findingId,
    revision: snapshot.baseCommit,
  });
  try {
    const materialized = materializeSnapshot({
      worktreePath: handle.worktreePath,
      snapshot,
    });
    const linkedRoots = linkExternal
      ? linkExternalRoots({ repoRoot, worktreePath: handle.worktreePath })
      : [];
    return {
      ...handle,
      sourceFingerprint: materialized.sourceFingerprint,
      snapshotVerified: true,
      // A snapshot worktree is intentionally dirty: it carries the user's
      // in-flight work. `git status` is therefore not an isolation signal here.
      carriesSnapshot: true,
      linkedRoots,
    };
  } catch (error) {
    removeRepairWorktree(handle);
    throw error;
  }
}

/**
 * Link the gitignored roots the product needs at runtime into the worktree.
 *
 * Breadboard vendors ~60 external clones and runtimes at the repository root and
 * gitignores them. They are environment, not authored source: no git worktree
 * can contain them, and several dashboard tests read them directly, which is why
 * a reconstructed snapshot otherwise fails ~98 tests that pass in the user's
 * tree. Junctions give the worktree the same environment without copying.
 *
 * These links point back into the user's tree, so writing through one would
 * modify their files. `applyGatedMutation` resolves real paths before writing
 * and refuses anything that leaves the worktree, which is what keeps this safe.
 */
export function linkExternalRoots({ repoRoot, worktreePath }) {
  const resolvedRepo = path.resolve(repoRoot);
  const linked = [];
  for (const entry of fs.readdirSync(resolvedRepo, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name.startsWith(".qa-")) continue;
    const ignored = git(["check-ignore", "-q", entry.name], resolvedRepo).status === 0;
    if (!ignored) continue;
    const target = path.join(worktreePath, entry.name);
    if (fs.existsSync(target)) continue;
    try {
      fs.symlinkSync(
        path.join(resolvedRepo, entry.name),
        target,
        process.platform === "win32" ? "junction" : "dir",
      );
      linked.push(entry.name);
    } catch {
      // A root that cannot be linked is reported by its absence from the list;
      // tests that need it will fail loudly rather than silently misbehave.
    }
  }
  return linked.sort();
}

/** Human-readable rollback instructions for the receipt. */
export function rollbackInstructions(handle) {
  return (
    `The candidate exists only in ${handle.worktreePath} (detached at ${handle.sourceRevision}). ` +
    `Roll back by discarding the worktree: ` +
    `git worktree remove --force ${handle.worktreePath} && git worktree prune. ` +
    `The main working tree was never modified, so no revert is required there.`
  );
}
