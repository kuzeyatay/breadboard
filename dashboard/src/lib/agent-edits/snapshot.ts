import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Instant undo for coding agents, in any repository a Garden is connected to.
 *
 * A run is bracketed by two snapshots of the whole working tree — taken with a
 * private index so neither the user's index nor their stash is disturbed — and
 * every snapshot is anchored under `refs/breadboard/agent-edits/` so git never
 * garbage-collects the "before" state. Everything the card shows (file list,
 * per-file patch, undo) is then a plain tree-to-tree comparison, which stays
 * accurate no matter what happens in the repository afterwards.
 */

const SNAPSHOT_REF_PREFIX = "refs/breadboard/agent-edits";
const SNAPSHOT_INDEX = "breadboard-agent-edits-index";
const GIT_TIMEOUT_MS = 120_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface AgentEditsRef {
  /** Working tree as it was before the run. */
  before: string;
  /** Working tree as it was when the run finished. */
  after: string;
}

export type AgentEditStatus = "added" | "modified" | "deleted";

export interface AgentEditFile {
  path: string;
  status: AgentEditStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface AgentEditsSummary {
  files: AgentEditFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface AgentEditsUndoResult {
  restored: string[];
  /** Touched again after the run — left alone rather than silently reverted. */
  skipped: string[];
}

// Line-ending conversion is disabled throughout: a snapshot has to store the
// bytes that are on disk, and an undo has to put those exact bytes back.
const GIT_BASE_ARGS = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false"];

function gitArgs(repositoryPath: string, args: string[]): string[] {
  return ["-C", repositoryPath, ...GIT_BASE_ARGS, ...args];
}

function git(repositoryPath: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", gitArgs(repositoryPath, args), {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    windowsHide: true,
    env: env ?? process.env,
  });
}

function gitBlob(repositoryPath: string, snapshot: string, filePath: string): Buffer {
  return execFileSync(
    "git",
    gitArgs(repositoryPath, ["cat-file", "blob", `${snapshot}:${filePath}`]),
    {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BUFFER,
      windowsHide: true,
    },
  );
}

export function isSnapshotId(value: unknown): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function snapshotEnv(repositoryPath: string): NodeJS.ProcessEnv {
  const indexFile = git(repositoryPath, ["rev-parse", "--git-path", SNAPSHOT_INDEX]).trim();
  return {
    ...process.env,
    // A private index keeps `git add -A` away from anything the user staged,
    // and its stat cache makes every snapshot after the first one cheap.
    GIT_INDEX_FILE: path.isAbsolute(indexFile)
      ? indexFile
      : path.join(repositoryPath, indexFile),
    GIT_AUTHOR_NAME: "Breadboard",
    GIT_AUTHOR_EMAIL: "agent@breadboard.local",
    GIT_COMMITTER_NAME: "Breadboard",
    GIT_COMMITTER_EMAIL: "agent@breadboard.local",
  };
}

/**
 * Record the current working tree, including files git does not track yet.
 * Returns null when the repository cannot be snapshotted, which only costs the
 * run its undo button.
 */
export function captureSnapshot(repositoryPath: string): string | null {
  try {
    const env = snapshotEnv(repositoryPath);
    git(repositoryPath, ["add", "--all", "--force", "--"], env);
    const tree = git(repositoryPath, ["write-tree"], env).trim();
    if (!isSnapshotId(tree)) return null;
    const commit = git(
      repositoryPath,
      ["commit-tree", tree, "-m", "breadboard agent edits snapshot"],
      env,
    ).trim();
    if (!isSnapshotId(commit)) return null;
    git(repositoryPath, ["update-ref", `${SNAPSHOT_REF_PREFIX}/${commit}`, commit], env);
    return commit;
  } catch {
    return null;
  }
}

interface PendingRun {
  repositoryPath: string;
  before: string;
  after?: string;
  startedAt: number;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardAgentEditRuns?: Map<string, PendingRun>;
};
const pendingRuns =
  runtimeGlobal.__breadboardAgentEditRuns ?? new Map<string, PendingRun>();
runtimeGlobal.__breadboardAgentEditRuns = pendingRuns;

/**
 * How long a bracket stays in memory. Only a browser that reconnects to a live
 * run needs it — once the turn is stored, undo works from the message itself.
 */
const PENDING_RUN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/** Called at launch, once the "before" snapshot exists. */
export function rememberRunSnapshot(
  runId: string,
  repositoryPath: string,
  before: string | null,
): void {
  if (!before) return;
  const now = Date.now();
  for (const [id, pending] of pendingRuns) {
    if (now - pending.startedAt > PENDING_RUN_TTL_MS) pendingRuns.delete(id);
  }
  pendingRuns.set(runId, { repositoryPath, before, startedAt: now });
}

/**
 * Close a run's bracket. Idempotent, because both the server-side terminal
 * handler and the browser ask for it — whoever gets there first wins, and a
 * later caller must not re-snapshot a tree the user has since edited.
 */
export function finalizeRunSnapshot(
  runId: string,
  repositoryPath: string,
): AgentEditsRef | null {
  const pending = pendingRuns.get(runId);
  if (!pending || pending.repositoryPath !== repositoryPath) return null;
  if (pending.after) return { before: pending.before, after: pending.after };
  const after = captureSnapshot(repositoryPath);
  if (!after) return null;
  pending.after = after;
  return { before: pending.before, after };
}

export function forgetRunSnapshot(runId: string): void {
  pendingRuns.delete(runId);
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [additions, deletions, ...rest] = line.split("\t");
    const filePath = rest.join("\t");
    if (!filePath) continue;
    const binary = additions === "-" || deletions === "-";
    stats.set(filePath, {
      additions: binary ? 0 : Number(additions) || 0,
      deletions: binary ? 0 : Number(deletions) || 0,
      binary,
    });
  }
  return stats;
}

function parseNameStatus(raw: string): Map<string, AgentEditStatus> {
  const statuses = new Map<string, AgentEditStatus>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [code, ...rest] = line.split("\t");
    const filePath = rest.join("\t");
    if (!filePath) continue;
    statuses.set(
      filePath,
      code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
    );
  }
  return statuses;
}

/** What the run changed — always recomputed, never trusted from a client. */
export function summarizeAgentEdits(
  repositoryPath: string,
  ref: AgentEditsRef,
): AgentEditsSummary {
  // Renames are expanded into add + delete so undo stays a per-path decision.
  const diff = (format: string) =>
    git(repositoryPath, ["diff", "--no-renames", format, ref.before, ref.after, "--"]);
  const stats = parseNumstat(diff("--numstat"));
  const statuses = parseNameStatus(diff("--name-status"));

  const files: AgentEditFile[] = [];
  for (const [filePath, status] of statuses) {
    const stat = stats.get(filePath) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path: filePath, status, ...stat });
  }
  files.sort(
    (left, right) =>
      right.additions + right.deletions - (left.additions + left.deletions) ||
      left.path.localeCompare(right.path),
  );
  return {
    files,
    filesChanged: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function agentEditPatch(
  repositoryPath: string,
  ref: AgentEditsRef,
  filePath: string,
): string {
  return git(repositoryPath, [
    "diff",
    "--no-renames",
    "--no-color",
    ref.before,
    ref.after,
    "--",
    filePath,
  ]);
}

function existsInSnapshot(
  repositoryPath: string,
  snapshot: string,
  filePath: string,
): boolean {
  try {
    // A missing path is the expected answer for anything the run created, so
    // git's complaint about it must not reach the server log.
    execFileSync("git", gitArgs(repositoryPath, ["cat-file", "-e", `${snapshot}:${filePath}`]), {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Put every file the run touched back the way it was. Files the user has since
 * edited are reported instead of reverted — an undo button must never eat work
 * the agent did not do.
 */
export function undoAgentEdits(
  repositoryPath: string,
  ref: AgentEditsRef,
): AgentEditsUndoResult {
  const summary = summarizeAgentEdits(repositoryPath, ref);
  const current = captureSnapshot(repositoryPath);
  const touchedSince = new Set(
    current
      ? git(repositoryPath, ["diff", "--no-renames", "--name-only", ref.after, current, "--"])
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [],
  );

  const restored: string[] = [];
  const skipped: string[] = [];
  for (const file of summary.files) {
    if (touchedSince.has(file.path)) {
      skipped.push(file.path);
      continue;
    }
    const target = path.join(repositoryPath, file.path);
    if (existsInSnapshot(repositoryPath, ref.before, file.path)) {
      // Written from the raw blob rather than `git restore`, so no smudge
      // filter rewrites the bytes and the index keeps whatever the user staged.
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, gitBlob(repositoryPath, ref.before, file.path));
    } else {
      fs.rmSync(target, { force: true });
    }
    restored.push(file.path);
  }
  return { restored, skipped };
}
