import os from "node:os";

import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

export const LEARN_ROLLBACK_TEMP_PREFIX = "breadboard-learn-rollback-";
export const LEARN_ROLLBACK_TEMP_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

const LEARN_ROLLBACK_OWNER_FILE = ".breadboard-rollback-owner.json";
const LEARN_ROLLBACK_RETRY_DELAY_MS = 30_000;
const REMOVE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 12,
  retryDelay: 250,
} as const;

type Warn = (message: string, error?: unknown) => void;

interface RollbackOwner {
  pid: number;
  createdAt: string;
}

export interface ReclaimLearnRollbackRootsResult {
  removed: string[];
  skippedActive: string[];
  skippedRecent: string[];
  failed: string[];
}

export interface ReclaimLearnRollbackRootsOptions {
  tempDir?: string;
  nowMs?: number;
  staleAfterMs?: number;
  isProcessRunning?: (pid: number) => boolean;
  warn?: Warn;
}

export interface ReleaseLearnRollbackRootOptions {
  tempDir?: string;
  retryDelayMs?: number;
  scheduleRetry?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  warn?: Warn;
}

function defaultWarn(message: string, error?: unknown): void {
  console.warn(message, error ?? "");
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isDirectLearnRollbackRoot(candidate: string, tempDir: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  return (
    comparablePath(path.dirname(resolvedCandidate)) === comparablePath(tempDir) &&
    path.basename(resolvedCandidate).startsWith(LEARN_ROLLBACK_TEMP_PREFIX) &&
    path.basename(resolvedCandidate).length > LEARN_ROLLBACK_TEMP_PREFIX.length
  );
}

function defaultIsProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this account cannot signal it.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function rollbackOwner(root: string): RollbackOwner | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, LEARN_ROLLBACK_OWNER_FILE), "utf8"),
    ) as Partial<RollbackOwner>;
    if (
      !Number.isSafeInteger(parsed.pid) ||
      Number(parsed.pid) <= 0 ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return { pid: Number(parsed.pid), createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

function safeRollbackRootStats(root: string, tempDir: string): import("node:fs").Stats | undefined {
  if (!isDirectLearnRollbackRoot(root, tempDir)) {
    throw new Error(`Refusing to remove a non-Breadboard rollback temp root: ${root}`);
  }
  const stats = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!stats) return undefined;
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Refusing to recurse into a rollback temp reparse point: ${root}`);
  }
  return stats;
}

function removeRollbackRoot(root: string, tempDir: string): void {
  if (!safeRollbackRootStats(root, tempDir)) return;
  fs.rmSync(root, REMOVE_OPTIONS);
}

export function reclaimStaleLearnRollbackRoots(
  options: ReclaimLearnRollbackRootsOptions = {},
): ReclaimLearnRollbackRootsResult {
  const tempDir = path.resolve(options.tempDir ?? os.tmpdir());
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? LEARN_ROLLBACK_TEMP_STALE_AFTER_MS;
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const warn = options.warn ?? defaultWarn;
  const result: ReclaimLearnRollbackRootsResult = {
    removed: [],
    skippedActive: [],
    skippedRecent: [],
    failed: [],
  };

  let entries: import("node:fs").Dirent[];
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch (error) {
    warn(`[learn] Could not inspect rollback temporary roots in ${tempDir}.`, error);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(LEARN_ROLLBACK_TEMP_PREFIX)) continue;
    const candidate = path.join(tempDir, entry.name);
    if (!isDirectLearnRollbackRoot(candidate, tempDir)) continue;

    try {
      const stats = fs.lstatSync(candidate, { throwIfNoEntry: false });
      if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) continue;
      const owner = rollbackOwner(candidate);
      if (owner && isProcessRunning(owner.pid)) {
        result.skippedActive.push(candidate);
        continue;
      }
      if (nowMs - stats.mtimeMs < staleAfterMs) {
        result.skippedRecent.push(candidate);
        continue;
      }
      removeRollbackRoot(candidate, tempDir);
      result.removed.push(candidate);
    } catch (error) {
      result.failed.push(candidate);
      warn(`[learn] Stale rollback temporary root remains at ${candidate}.`, error);
    }
  }

  return result;
}

export function createLearnRollbackTemporaryRoot(
  options: ReclaimLearnRollbackRootsOptions = {},
): string {
  const tempDir = path.resolve(options.tempDir ?? os.tmpdir());
  reclaimStaleLearnRollbackRoots({ ...options, tempDir });
  const root = fs.mkdtempSync(path.join(tempDir, LEARN_ROLLBACK_TEMP_PREFIX));
  try {
    const owner: RollbackOwner = { pid: process.pid, createdAt: new Date().toISOString() };
    fs.writeFileSync(
      path.join(root, LEARN_ROLLBACK_OWNER_FILE),
      `${JSON.stringify(owner)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return root;
  } catch (error) {
    try {
      removeRollbackRoot(root, tempDir);
    } catch {
      // Preserve the original marker-write error.
    }
    throw error;
  }
}

export function releaseLearnRollbackTemporaryRoot(
  root: string,
  options: ReleaseLearnRollbackRootOptions = {},
): boolean {
  const tempDir = path.resolve(options.tempDir ?? os.tmpdir());
  const warn = options.warn ?? defaultWarn;
  if (!isDirectLearnRollbackRoot(root, tempDir)) {
    warn(`[learn] Refusing to release a non-Breadboard rollback temp root: ${root}`);
    return false;
  }

  try {
    if (!safeRollbackRootStats(root, tempDir)) return true;
    fs.rmSync(path.join(root, LEARN_ROLLBACK_OWNER_FILE), {
      force: true,
      maxRetries: 4,
      retryDelay: 100,
    });
    removeRollbackRoot(root, tempDir);
    return true;
  } catch (error) {
    warn(`[learn] Rollback temporary cleanup will retry for ${root}.`, error);
    const scheduleRetry = options.scheduleRetry ?? setTimeout;
    const timer = scheduleRetry(() => {
      try {
        removeRollbackRoot(root, tempDir);
      } catch (retryError) {
        warn(
          `[learn] Rollback temporary root remains at ${root}; a future rollback will reclaim it once stale.`,
          retryError,
        );
      }
    }, options.retryDelayMs ?? LEARN_ROLLBACK_RETRY_DELAY_MS);
    timer.unref?.();
    return false;
  }
}
