/**
 * File-lock-resilient atomic publication (Part 16) and per-garden build lock
 * (Part 17).
 *
 * Generation and repair happen entirely in the unsynchronized workspace.
 * Publication is the ONLY step that writes the repository garden, and it does so
 * atomically: the validated staging tree is copied into a sibling temp dir next
 * to the destination, verified, then swapped in while the previous published
 * version is retained until the swap succeeds. A Windows/OneDrive `EBUSY`/`EPERM`
 * lock is retried with exponential backoff; if it ultimately fails, the previous
 * published garden is left completely intact (never a half-old/half-new tree).
 */

import fs from "node:fs";
import path from "node:path";

export interface AtomicPromotionOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_PROMOTION_OPTIONS: AtomicPromotionOptions = {
  maxAttempts: 8,
  initialDelayMs: 100,
  maxDelayMs: 3000,
};

export interface AtomicPromotionResult {
  promoted: boolean;
  destination: string;
  attempts: number;
  previousPreservedAt?: string;
  reason: string;
}

const LOCK_ERROR_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

function isLockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && LOCK_ERROR_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyTreeSync(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyTreeSync(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

/**
 * Publish a validated staging garden to its repository destination atomically,
 * retrying lock failures. On ultimate failure the previous published garden is
 * preserved untouched.
 */
export async function promoteStagingGarden(input: {
  stagingGardenDir: string;
  destinationGardenDir: string;
  verifyManifest?: (promotedDir: string) => boolean;
  /** Last-moment optimistic-concurrency check, run after the incoming tree is
   * ready and immediately before the destination is renamed. */
  verifyCurrentDestination?: (destinationDir: string) => boolean;
  /** Keep the previous tree after a successful swap so a caller can complete
   * a second transactional resource (for example SQLite) before discarding it. */
  retainPreviousUntilCallerCommit?: boolean;
  options?: Partial<AtomicPromotionOptions>;
}): Promise<AtomicPromotionResult> {
  const options = { ...DEFAULT_PROMOTION_OPTIONS, ...input.options };
  const destination = input.destinationGardenDir;
  const parent = path.dirname(destination);
  const base = path.basename(destination);
  const incoming = path.join(parent, `.${base}.incoming-${Date.now().toString(36)}`);
  const backup = path.join(parent, `.${base}.previous-${Date.now().toString(36)}`);

  let attempts = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      // 1. Stage the complete tree in a sibling temp dir.
      fs.rmSync(incoming, { recursive: true, force: true });
      copyTreeSync(input.stagingGardenDir, incoming);

      // 2. Verify the promoted-to-be tree before touching the destination.
      if (input.verifyManifest && !input.verifyManifest(incoming)) {
        fs.rmSync(incoming, { recursive: true, force: true });
        return {
          promoted: false,
          destination,
          attempts,
          reason: "promoted tree failed manifest verification; destination untouched",
        };
      }

      // 3. Atomically swap: move the old dest aside, move incoming in. If the
      //    second move fails, restore the old dest so we never leave a
      //    half-old/half-new tree.
      const destExists = fs.existsSync(destination);
      if (
        destExists &&
        input.verifyCurrentDestination &&
        !input.verifyCurrentDestination(destination)
      ) {
        fs.rmSync(incoming, { recursive: true, force: true });
        return {
          promoted: false,
          destination,
          attempts,
          reason: "destination changed while staging; destination untouched",
        };
      }
      if (destExists) fs.renameSync(destination, backup);
      try {
        fs.renameSync(incoming, destination);
      } catch (swapError) {
        if (destExists) {
          try { fs.renameSync(backup, destination); } catch { /* destination already restored or gone */ }
        }
        throw swapError;
      }

      // 4. Success: retain the previous version until the swap succeeded, then
      //    clean it up best-effort.
      let previousPreservedAt: string | undefined;
      if (destExists) {
        previousPreservedAt = backup;
        if (!input.retainPreviousUntilCallerCommit) {
          try { fs.rmSync(backup, { recursive: true, force: true }); previousPreservedAt = undefined; } catch { /* keep backup */ }
        }
      }
      return {
        promoted: true,
        destination,
        attempts,
        previousPreservedAt,
        reason: `promoted staging garden to ${destination} on attempt ${attempt}`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // Clean the incoming temp dir before retrying.
      try { fs.rmSync(incoming, { recursive: true, force: true }); } catch { /* ignore */ }
      if (!isLockError(error) || attempt === options.maxAttempts) break;
      const delay = Math.min(options.maxDelayMs, options.initialDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  // Ensure the destination is intact (restore from backup if the swap half-ran).
  try {
    if (!fs.existsSync(destination) && fs.existsSync(backup)) fs.renameSync(backup, destination);
  } catch { /* best effort */ }
  return {
    promoted: false,
    destination,
    attempts,
    reason: `promotion failed after ${attempts} attempt(s); previous published garden preserved. Last error: ${lastError}`,
  };
}

// ---------------------------------------------------------------------------
// Per-garden build lock (Part 17)
// ---------------------------------------------------------------------------

export interface GardenLearnLock {
  gardenSlug: string;
  jobId: string;
  buildId: string;
  acquiredAt: string;
  heartbeatAt: string;
}

const LOCK_REL = ".breadboard/learn-build.lock.json";
/** A lock whose heartbeat is older than this is considered stale. */
export const LOCK_STALE_MS = 5 * 60 * 1000;

function lockPath(gardenDir: string): string {
  return path.join(gardenDir, ...LOCK_REL.split("/"));
}

export function readGardenLearnLock(gardenDir: string): GardenLearnLock | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath(gardenDir), "utf-8")) as GardenLearnLock;
  } catch {
    return null;
  }
}

/**
 * Try to acquire the per-garden build lock. Only one generation/publication job
 * may own a garden at a time. A second job is refused unless the existing lock
 * is stale (heartbeat expired). Returns the lock on success or a conflict.
 */
export function acquireGardenLearnLock(
  gardenDir: string,
  owner: { gardenSlug: string; jobId: string; buildId: string },
  now: number = Date.now(),
): { acquired: true; lock: GardenLearnLock } | { acquired: false; conflict: GardenLearnLock } {
  const existing = readGardenLearnLock(gardenDir);
  if (existing && existing.jobId !== owner.jobId) {
    const heartbeat = Date.parse(existing.heartbeatAt);
    const fresh = Number.isFinite(heartbeat) && now - heartbeat < LOCK_STALE_MS;
    if (fresh) return { acquired: false, conflict: existing };
    // Stale lock — safe to take over.
  }
  const lock: GardenLearnLock = {
    gardenSlug: owner.gardenSlug,
    jobId: owner.jobId,
    buildId: owner.buildId,
    acquiredAt: existing && existing.jobId === owner.jobId ? existing.acquiredAt : new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
  };
  const abs = lockPath(gardenDir);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(lock, null, 2)}\n`);
  return { acquired: true, lock };
}

export function heartbeatGardenLearnLock(gardenDir: string, jobId: string, now: number = Date.now()): boolean {
  const existing = readGardenLearnLock(gardenDir);
  if (!existing || existing.jobId !== jobId) return false;
  existing.heartbeatAt = new Date(now).toISOString();
  fs.writeFileSync(lockPath(gardenDir), `${JSON.stringify(existing, null, 2)}\n`);
  return true;
}

export function releaseGardenLearnLock(gardenDir: string, jobId: string): void {
  const existing = readGardenLearnLock(gardenDir);
  if (existing && existing.jobId !== jobId) return; // do not release someone else's lock
  fs.rmSync(lockPath(gardenDir), { force: true });
}
