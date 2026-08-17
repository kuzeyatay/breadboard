/**
 * Source snapshots — the identity of the code a scenario actually ran against.
 *
 * Week 2 exposed a verification hole (W2-2). Repair worktrees were cut from
 * `HEAD`, but this repository is developed with a large dirty working tree: at
 * the time of writing, `HEAD` failed 123 dashboard tests while the working tree
 * failed 51. A repair verified against `HEAD` was therefore being tested against
 * a different product than the one the user is running, which can reproduce a
 * bug that no longer exists, miss one that does, and still print VERIFIED.
 *
 * The fix is to stop conflating two different identities:
 *
 *   baseCommit          — which commit the repository is on
 *   sourceFingerprint   — what the source actually *was* when the scenario ran
 *
 * A snapshot captures the second: the base commit, the tracked diff over the
 * system under test, and the untracked source files under the same roots. It is
 * content-addressed, so reconstructing it anywhere and re-capturing must yield
 * the identical fingerprint — which is how reconstruction verifies itself.
 *
 * Nothing here commits, stashes, resets, or otherwise touches the user's
 * working tree. Capture is read-only; reconstruction happens in a disposable
 * worktree.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const SNAPSHOT_VERSION = 1;

/**
 * Paths whose churn is generated, not authored: Quartz's rendered output, the
 * embedded database's data files, and QA's own evidence. Everything else in the
 * repository is snapshot material.
 *
 * This is deliberately a deny-list. An allow-list was tried first and silently
 * dropped real dependencies — `hermes-skills/prebuilt/*` and
 * `dashboard/package.json` among them — which produced a worktree that carried
 * half of the developer's change and failed *more* tests than either the
 * working tree or HEAD. Excluding known noise is safe; guessing the full set of
 * things a test might read is not.
 */
export const EXCLUDED_PATHSPECS = Object.freeze([
  "quartz/public",
  "gbrain/pglite",
  ".qa-results",
  ".qa-worktrees",
  ".qa-runtime",
  "node_modules",
]);

/** Default scope: the whole repository, minus the generated paths above. */
export const SUT_ROOTS = Object.freeze(["."]);

/** Never captured, even inside a SUT root: build output and QA's own evidence. */
const EXCLUDED_PATTERNS = Object.freeze([
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)dist(-tests)?(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /^\.qa-results(\/|$)/,
  /^\.qa-worktrees(\/|$)/,
  /^\.qa-runtime(\/|$)/,
  /(^|\/)\.git(\/|$)/,
]);

/** Source-ish files only. A stray binary in a source tree is recorded, not read. */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".sql",
  ".css", ".scss", ".yaml", ".yml", ".txt", ".csv", ".html", ".sh", ".ps1",
]);

const MAX_UNTRACKED_FILES = 2_000;
const MAX_UNTRACKED_BYTES = 64 * 1024 * 1024;

export class SourceSnapshotError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SourceSnapshotError";
    this.code = code;
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "buffer",
    shell: false,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
}

function gitOrThrow(args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) {
    throw new SourceSnapshotError(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr.trim()}`,
      "git-failed",
    );
  }
  return result.stdout;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isExcludedPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isInsideRoots(relativePath, roots) {
  if (roots.length === 1 && roots[0] === ".") return true;
  const normalized = relativePath.replaceAll("\\", "/");
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

/** Git pathspecs for a scope: the roots, minus every generated path. */
function pathspecsFor(roots) {
  return [...roots, ...EXCLUDED_PATHSPECS.map((entry) => `:(exclude)${entry}`)];
}

/**
 * Capture the source state of `repoRoot` without modifying anything.
 *
 * Works on the user's main tree and on a reconstructed worktree alike, which is
 * what lets reconstruction verify itself by re-capturing and comparing.
 */
export function captureSourceSnapshot({ repoRoot, roots = SUT_ROOTS, label = null } = {}) {
  const resolved = path.resolve(repoRoot);
  const baseCommit = gitOrThrow(["rev-parse", "HEAD"], resolved).toString("utf8").trim();

  // `--binary` keeps the patch applicable when a binary asset changed;
  // `--no-ext-diff` and a fixed context keep it byte-stable across configs.
  const trackedDiff = gitOrThrow(
    ["diff", "--binary", "--no-ext-diff", "--unified=3", "HEAD", "--", ...pathspecsFor(roots)],
    resolved,
  );

  const untrackedList = gitOrThrow(
    ["ls-files", "--others", "--exclude-standard", "--", ...pathspecsFor(roots)],
    resolved,
  )
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const untrackedFiles = [];
  const skipped = [];
  let totalBytes = 0;

  for (const relative of untrackedList) {
    if (isExcludedPath(relative)) {
      skipped.push({ path: relative, reason: "excluded build/runtime/QA path" });
      continue;
    }
    if (!isInsideRoots(relative, roots)) {
      skipped.push({ path: relative, reason: "outside the requested scope" });
      continue;
    }
    const extension = path.extname(relative).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(extension)) {
      skipped.push({ path: relative, reason: `non-source extension ${extension || "(none)"}` });
      continue;
    }
    const absolute = path.join(resolved, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      skipped.push({ path: relative, reason: "disappeared during capture" });
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      skipped.push({ path: relative, reason: "not a regular file" });
      continue;
    }
    const contents = fs.readFileSync(absolute);
    totalBytes += contents.byteLength;
    if (untrackedFiles.length >= MAX_UNTRACKED_FILES || totalBytes > MAX_UNTRACKED_BYTES) {
      // Truncating would make the snapshot unreproducible while still looking
      // valid, which is exactly the failure mode this module exists to remove.
      throw new SourceSnapshotError(
        `Untracked source capture exceeded its bound (${untrackedFiles.length} files, ${totalBytes} bytes); refusing to record a truncated snapshot`,
        "snapshot-too-large",
      );
    }
    untrackedFiles.push({
      path: relative.replaceAll("\\", "/"),
      sha256: sha256(contents),
      bytes: contents.byteLength,
      contents: contents.toString("base64"),
    });
  }

  untrackedFiles.sort((left, right) => left.path.localeCompare(right.path));

  const trackedDiffSha = sha256(trackedDiff);
  const manifest = [
    `snapshotVersion ${SNAPSHOT_VERSION}`,
    `base ${baseCommit}`,
    `roots ${[...roots].sort().join(",")}`,
    `trackedDiff ${trackedDiffSha}`,
    ...untrackedFiles.map((file) => `untracked ${file.path} ${file.sha256}`),
  ].join("\n");

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    label,
    capturedAt: new Date().toISOString(),
    baseCommit,
    roots: [...roots],
    trackedDiff: trackedDiff.toString("utf8"),
    trackedDiffSha256: trackedDiffSha,
    trackedDiffBytes: trackedDiff.byteLength,
    untrackedFiles,
    untrackedSkipped: skipped,
    sourceFingerprint: sha256(manifest),
    dirty: trackedDiff.byteLength > 0 || untrackedFiles.length > 0,
  };
}

/**
 * A content manifest of every source file under the SUT roots: path -> sha256.
 *
 * A snapshot worktree is deliberately dirty — it carries the user's in-flight
 * work — so `git status` no longer isolates what a repair changed. Comparing two
 * manifests does, exactly and per file, which is what keeps
 * `finalizeRepairCapability`'s unauthorised-change detection meaningful.
 */
export function sourceManifest({ repoRoot, roots = SUT_ROOTS }) {
  const resolved = path.resolve(repoRoot);
  const tracked = gitOrThrow(["ls-files", "--", ...roots], resolved)
    .toString("utf8")
    .split(/\r?\n/);
  const untracked = gitOrThrow(
    ["ls-files", "--others", "--exclude-standard", "--", ...roots],
    resolved,
  )
    .toString("utf8")
    .split(/\r?\n/);

  const manifest = {};
  for (const raw of [...tracked, ...untracked]) {
    const relative = raw.trim();
    if (relative === "" || isExcludedPath(relative)) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    const absolute = path.join(resolved, relative);
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      manifest[relative.replaceAll("\\", "/")] = sha256(fs.readFileSync(absolute));
    } catch {
      // A file listed by git but absent on disk is a deletion; recorded by its
      // absence from the manifest, which `manifestDelta` reports as removed.
    }
  }
  return manifest;
}

/** Exactly which files differ between two manifests. */
export function manifestDelta(before, after) {
  const added = [];
  const changed = [];
  const removed = [];
  for (const [file, hash] of Object.entries(after)) {
    if (!(file in before)) added.push(file);
    else if (before[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(before)) {
    if (!(file in after)) removed.push(file);
  }
  return {
    added: added.sort(),
    changed: changed.sort(),
    removed: removed.sort(),
    all: [...added, ...changed, ...removed].sort(),
  };
}

/** The fingerprint alone, for comparing without carrying payloads around. */
export function snapshotIdentity(snapshot) {
  return {
    baseCommit: snapshot.baseCommit,
    sourceFingerprint: snapshot.sourceFingerprint,
    dirty: snapshot.dirty,
    trackedDiffBytes: snapshot.trackedDiffBytes,
    untrackedFileCount: snapshot.untrackedFiles.length,
  };
}

/** True when the live tree still matches the snapshot the finding was made on. */
export function snapshotStillCurrent({ repoRoot, snapshot }) {
  const current = captureSourceSnapshot({ repoRoot, roots: snapshot.roots });
  return {
    current: snapshotIdentity(current),
    expected: snapshotIdentity(snapshot),
    matches: current.sourceFingerprint === snapshot.sourceFingerprint,
  };
}

export function writeSnapshotFile(snapshot, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return filePath;
}

export function readSnapshotFile(filePath) {
  const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (snapshot.snapshotVersion !== SNAPSHOT_VERSION) {
    throw new SourceSnapshotError(
      `Unsupported snapshot version ${snapshot.snapshotVersion}`,
      "bad-version",
    );
  }
  return snapshot;
}

/**
 * Materialise a snapshot into an existing worktree checked out at its base
 * commit, then prove it by re-capturing and comparing fingerprints.
 *
 * Throws rather than returning a partial result: a worktree that does not carry
 * the snapshot it claims is worse than no worktree at all.
 */
export function materializeSnapshot({ worktreePath, snapshot }) {
  const resolved = path.resolve(worktreePath);
  const head = gitOrThrow(["rev-parse", "HEAD"], resolved).toString("utf8").trim();
  if (head !== snapshot.baseCommit) {
    throw new SourceSnapshotError(
      `worktree is at ${head} but the snapshot was taken at ${snapshot.baseCommit}`,
      "base-mismatch",
    );
  }

  if (snapshot.trackedDiffBytes > 0) {
    const patchPath = path.join(resolved, ".qa-source-snapshot.patch");
    fs.writeFileSync(patchPath, snapshot.trackedDiff, "utf8");
    try {
      const applied = git(["apply", "--binary", "--whitespace=nowarn", patchPath], resolved);
      if (applied.status !== 0) {
        throw new SourceSnapshotError(
          `could not reconstruct the source snapshot: ${applied.stderr.trim()}`,
          "patch-conflict",
        );
      }
    } finally {
      fs.rmSync(patchPath, { force: true });
    }
  }

  for (const file of snapshot.untrackedFiles) {
    const target = path.join(resolved, file.path);
    const relation = path.relative(resolved, target);
    if (relation.startsWith("..") || path.isAbsolute(relation)) {
      throw new SourceSnapshotError(
        `snapshot file ${file.path} escapes the worktree`,
        "path-escape",
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.contents, "base64"));
  }

  const rebuilt = captureSourceSnapshot({ worktreePath, repoRoot: resolved, roots: snapshot.roots });
  if (rebuilt.sourceFingerprint !== snapshot.sourceFingerprint) {
    throw new SourceSnapshotError(
      `reconstructed source fingerprint ${rebuilt.sourceFingerprint.slice(0, 16)} does not match the captured ${snapshot.sourceFingerprint.slice(0, 16)}`,
      "fingerprint-mismatch",
    );
  }
  return { verified: true, sourceFingerprint: rebuilt.sourceFingerprint, baseCommit: rebuilt.baseCommit };
}
