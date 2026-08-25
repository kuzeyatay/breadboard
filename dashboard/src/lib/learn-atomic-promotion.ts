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
import crypto from "node:crypto";
import os from "node:os";
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
  /** Merge volatile append-only state (for example the event ledger) into the
   * already verified incoming tree immediately before the swap. */
  prepareIncomingForCommit?: (
    incomingDir: string,
    currentDestinationDir: string,
  ) => boolean;
  /** Hashes an exact operation owner into the retained backup name so startup
   * recovery never guesses which previous tree belongs to which job. */
  recoveryOwnerId?: string;
  /** Keep the previous tree after a successful swap so a caller can complete
   * a second transactional resource (for example SQLite) before discarding it. */
  retainPreviousUntilCallerCommit?: boolean;
  options?: Partial<AtomicPromotionOptions>;
}): Promise<AtomicPromotionResult> {
  const options = { ...DEFAULT_PROMOTION_OPTIONS, ...input.options };
  const destination = input.destinationGardenDir;
  const parent = path.dirname(destination);
  const base = path.basename(destination);
  // Validation resolves canonical /<garden-slug>/assets URLs from the garden
  // directory basename. Keep that logical basename inside a unique hidden
  // staging container so verification sees the same identity as publication.
  const incomingContainer = path.join(
    parent,
    `.${base}.incoming-${Date.now().toString(36)}`,
  );
  const incoming = path.join(incomingContainer, base);
  const recoveryOwnerSuffix = input.recoveryOwnerId
    ? `-${crypto.createHash("sha256").update(input.recoveryOwnerId).digest("hex").slice(0, 16)}`
    : "";
  const backup = path.join(
    parent,
    `.${base}.previous-${Date.now().toString(36)}${recoveryOwnerSuffix}`,
  );

  let attempts = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      // 1. Stage the complete tree in a sibling temp dir.
      fs.rmSync(incomingContainer, { recursive: true, force: true });
      copyTreeSync(input.stagingGardenDir, incoming);

      // 2. Verify the promoted-to-be tree before touching the destination.
      if (input.verifyManifest && !input.verifyManifest(incoming)) {
        fs.rmSync(incomingContainer, { recursive: true, force: true });
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
        fs.rmSync(incomingContainer, { recursive: true, force: true });
        return {
          promoted: false,
          destination,
          attempts,
          reason: "destination changed while staging; destination untouched",
        };
      }
      if (
        destExists &&
        input.prepareIncomingForCommit &&
        !input.prepareIncomingForCommit(incoming, destination)
      ) {
        fs.rmSync(incomingContainer, { recursive: true, force: true });
        return {
          promoted: false,
          destination,
          attempts,
          reason: "incoming garden could not merge volatile state; destination untouched",
        };
      }
      if (destExists) fs.renameSync(destination, backup);
      try {
        fs.renameSync(incoming, destination);
      } catch (swapError) {
        if (destExists) {
          let restoreError = "";
          let restored = false;
          for (let restoreAttempt = 1; restoreAttempt <= options.maxAttempts; restoreAttempt += 1) {
            try {
              fs.renameSync(backup, destination);
              restored = true;
              break;
            } catch (error) {
              restoreError = error instanceof Error ? error.message : String(error);
              if (restoreAttempt < options.maxAttempts) {
                const delay = Math.min(
                  options.maxDelayMs,
                  options.initialDelayMs * 2 ** (restoreAttempt - 1),
                );
                await sleep(delay);
              }
            }
          }
          if (!restored) {
            // Never start another promotion attempt while the old destination
            // is displaced. Doing so could install the incoming tree and lose
            // the caller's only rollback pointer.
            try { fs.rmSync(incomingContainer, { recursive: true, force: true }); } catch { /* preserve backup */ }
            return {
              promoted: false,
              destination,
              attempts,
              previousPreservedAt: backup,
              reason:
                `promotion swap failed and the previous garden could not be restored; ` +
                `the previous tree remains at ${backup}. Swap error: ${
                  swapError instanceof Error ? swapError.message : String(swapError)
                }. Restore error: ${restoreError}`,
            };
          }
        }
        throw swapError;
      }

      try { fs.rmdirSync(incomingContainer); } catch { /* empty staging container is harmless */ }

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
      try { fs.rmSync(incomingContainer, { recursive: true, force: true }); } catch { /* ignore */ }
      if (!isLockError(error) || attempt === options.maxAttempts) break;
      const delay = Math.min(options.maxDelayMs, options.initialDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  // Ensure the destination is intact (restore from backup if the swap half-ran).
  let previousPreservedAt: string | undefined;
  try {
    if (!fs.existsSync(destination) && fs.existsSync(backup)) {
      fs.renameSync(backup, destination);
    }
  } catch {
    if (fs.existsSync(backup)) previousPreservedAt = backup;
  }
  const destinationRestored = fs.existsSync(destination);
  return {
    promoted: false,
    destination,
    attempts,
    previousPreservedAt,
    reason: destinationRestored
      ? "promotion failed after " + attempts +
        " attempt(s); previous published garden restored. Last error: " + lastError
      : "promotion failed after " + attempts +
        " attempt(s); destination recovery is required" +
        (previousPreservedAt ? " from " + previousPreservedAt : "") +
        ". Last error: " + lastError,
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
  /** Fencing token for this particular ownership period. */
  leaseId?: string;
}

const LEGACY_LOCK_REL = ".breadboard/learn-build.lock.json";
const STABLE_LOCK_SUFFIX = ".learn-build.lock.json";
/** A lock whose heartbeat is older than this is considered stale. */
export const LOCK_STALE_MS = 5 * 60 * 1000;
/** Auto-renew well before the stale boundary, leaving room for transient I/O. */
export const DEFAULT_LOCK_HEARTBEAT_INTERVAL_MS = Math.floor(LOCK_STALE_MS / 3);

const MUTATION_GUARD_SUFFIX = ".guard";
const MUTATION_GUARD_RECORD = "owner.json";
const MUTATION_GUARD_STALE_MS = 30 * 1000;
const MUTATION_GUARD_WAIT_MS = 250;
const MUTATION_GUARD_RETRY_MS = 5;

interface LockOwner {
  gardenSlug: string;
  jobId: string;
  buildId: string;
}

interface LockMutationGuard {
  token: string;
  owner: LockOwner;
  acquiredAt: string;
  processId: number;
  hostname: string;
}

export interface GardenLearnLeaseOptions {
  /** Defaults to one third of LOCK_STALE_MS. Must remain below that limit. */
  heartbeatIntervalMs?: number;
  /** Primarily useful for deterministic tests. */
  now?: () => number;
  /**
   * Secret fencing token required to resume an already-owned fresh lease.
   * Omit for every new operation; matching job/build identifiers alone never
   * prove ownership.
   */
  resumeLeaseId?: string;
  /** Called once if a heartbeat proves that ownership has been lost. */
  onLeaseLost?: (conflict: GardenLearnLock | null) => void;
}

export type GardenLearnLeaseOwnership = "owned" | "lost" | "uncertain";

export interface GardenLearnLease {
  readonly lock: GardenLearnLock;
  readonly lost: boolean;
  /**
   * Confirm this exact fenced lease without collapsing a transient lock read or
   * mutation-guard collision into definitive ownership loss.
   */
  confirmOwnership(): GardenLearnLeaseOwnership;
  /**
   * Renew immediately, for example at an orchestration phase boundary.
   * Returns true only after the fenced heartbeat is durably committed.
   */
  heartbeat(): boolean;
  /** Stop the timer and release only if this exact fenced lease still owns it. */
  release(): boolean;
}

export type GardenLearnLockResult =
  | { acquired: true; lock: GardenLearnLock }
  | { acquired: false; conflict: GardenLearnLock };

export type GardenLearnLeaseResult =
  | { acquired: true; lease: GardenLearnLease }
  | { acquired: false; conflict: GardenLearnLock };

function lockPath(gardenDir: string): string {
  const garden = path.resolve(gardenDir);
  // Publication renames the entire garden directory. Keeping the canonical
  // lease beside it ensures ownership remains visible throughout that swap.
  return path.join(path.dirname(garden), `.${path.basename(garden)}${STABLE_LOCK_SUFFIX}`);
}

function legacyLockPath(gardenDir: string): string {
  return path.join(gardenDir, ...LEGACY_LOCK_REL.split("/"));
}

function mutationGuardPath(gardenDir: string): string {
  return `${lockPath(gardenDir)}${MUTATION_GUARD_SUFFIX}`;
}

function isGardenLearnLock(value: unknown): value is GardenLearnLock {
  if (!value || typeof value !== "object") return false;
  const lock = value as Partial<GardenLearnLock>;
  return (
    typeof lock.gardenSlug === "string" &&
    typeof lock.jobId === "string" &&
    typeof lock.buildId === "string" &&
    typeof lock.acquiredAt === "string" &&
    typeof lock.heartbeatAt === "string" &&
    (lock.leaseId === undefined || typeof lock.leaseId === "string")
  );
}

type GardenLearnLockRead =
  | { status: "found"; lock: GardenLearnLock }
  | { status: "missing" }
  | { status: "uncertain" };

function readLockFileState(filePath: string): GardenLearnLockRead {
  let serialized: string;
  try {
    serialized = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
      ? { status: "missing" }
      : { status: "uncertain" };
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isGardenLearnLock(parsed)
      ? { status: "found", lock: parsed }
      : { status: "uncertain" };
  } catch {
    return { status: "uncertain" };
  }
}

function readLockFile(filePath: string): GardenLearnLock | null {
  const result = readLockFileState(filePath);
  return result.status === "found" ? result.lock : null;
}

export function readGardenLearnLock(gardenDir: string): GardenLearnLock | null {
  return readLockFile(lockPath(gardenDir)) ?? readLockFile(legacyLockPath(gardenDir));
}

function readGardenLearnLockState(gardenDir: string): GardenLearnLockRead {
  const stable = readLockFileState(lockPath(gardenDir));
  // A malformed or temporarily unreadable stable lock may be hiding a newer
  // fencing token. Never fall back to legacy state unless stable storage is
  // definitely absent.
  return stable.status === "missing"
    ? readLockFileState(legacyLockPath(gardenDir))
    : stable;
}

function readMutationGuard(gardenDir: string): LockMutationGuard | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(mutationGuardPath(gardenDir), MUTATION_GUARD_RECORD), "utf-8"),
    ) as Partial<LockMutationGuard>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.processId !== "number" ||
      typeof parsed.hostname !== "string" ||
      !parsed.owner ||
      typeof parsed.owner.gardenSlug !== "string" ||
      typeof parsed.owner.jobId !== "string" ||
      typeof parsed.owner.buildId !== "string"
    ) return null;
    return parsed as LockMutationGuard;
  } catch {
    return null;
  }
}

function sleepSync(ms: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, ms);
}

function guardAgeMs(gardenDir: string, now: number): number {
  const guard = readMutationGuard(gardenDir);
  const acquired = guard ? Date.parse(guard.acquiredAt) : Number.NaN;
  if (Number.isFinite(acquired)) return now - acquired;
  try {
    return now - fs.statSync(mutationGuardPath(gardenDir)).mtimeMs;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

/**
 * Recover an abandoned transition guard by atomically moving it out of the
 * canonical name. The guard is deliberately short-lived and never spans user
 * or model work; a 30-second-old guard therefore indicates a crashed process.
 */
function recoverStaleMutationGuard(gardenDir: string, now: number): boolean {
  const guardDir = mutationGuardPath(gardenDir);
  if (guardAgeMs(gardenDir, now) < MUTATION_GUARD_STALE_MS) return false;
  const existing = readMutationGuard(gardenDir);
  if (
    existing?.hostname === os.hostname() &&
    Number.isInteger(existing.processId) &&
    localProcessIsAlive(existing.processId)
  ) return false;
  const abandoned = `${guardDir}.abandoned-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(guardDir, abandoned);
    fs.rmSync(abandoned, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function localProcessIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // A permissions failure still proves that the process exists.
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

/** Serialize every lock read/check/write transition with an atomic mkdir. */
function acquireMutationGuard(gardenDir: string, owner: LockOwner): LockMutationGuard | null {
  const guardDir = mutationGuardPath(gardenDir);
  fs.mkdirSync(path.dirname(guardDir), { recursive: true });
  const deadline = Date.now() + MUTATION_GUARD_WAIT_MS;
  while (true) {
    const guard: LockMutationGuard = {
      token: crypto.randomUUID(),
      owner,
      acquiredAt: new Date().toISOString(),
      processId: process.pid,
      hostname: os.hostname(),
    };
    try {
      fs.mkdirSync(guardDir);
      try {
        fs.writeFileSync(
          path.join(guardDir, MUTATION_GUARD_RECORD),
          `${JSON.stringify(guard, null, 2)}\n`,
          { flag: "wx" },
        );
      } catch (error) {
        fs.rmSync(guardDir, { recursive: true, force: true });
        throw error;
      }
      return guard;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") throw error;
    }

    if (recoverStaleMutationGuard(gardenDir, Date.now())) continue;
    if (Date.now() >= deadline) return null;
    sleepSync(MUTATION_GUARD_RETRY_MS);
  }
}

function releaseMutationGuard(gardenDir: string, token: string): void {
  // A delayed owner must never remove a newer owner's guard after recovery.
  if (readMutationGuard(gardenDir)?.token !== token) return;
  fs.rmSync(mutationGuardPath(gardenDir), { recursive: true, force: true });
}

function ownsMutationGuard(gardenDir: string, token: string): boolean {
  return readMutationGuard(gardenDir)?.token === token;
}

function writeGardenLearnLock(
  gardenDir: string,
  lock: GardenLearnLock,
  mutationGuardToken: string,
): void {
  const abs = lockPath(gardenDir);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const temporary = `${abs}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
    // Readers observe either the old complete JSON or the new complete JSON.
    if (!ownsMutationGuard(gardenDir, mutationGuardToken)) {
      throw new Error("Learn lock transition ownership was lost before commit");
    }
    fs.renameSync(temporary, abs);
    // Upgrade a pre-hardening in-garden lock only after the stable sibling has
    // committed, so a crash can never leave ownership invisible.
    try {
      fs.rmSync(legacyLockPath(gardenDir), { recursive: true, force: true });
    } catch {
      // Stable ownership is already committed and always takes precedence.
    }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }
}

function lockIsFresh(lock: GardenLearnLock, now: number): boolean {
  const heartbeat = Date.parse(lock.heartbeatAt);
  return Number.isFinite(heartbeat) && now - heartbeat < LOCK_STALE_MS;
}

function sameLockOwner(lock: GardenLearnLock, owner: LockOwner): boolean {
  return (
    lock.gardenSlug === owner.gardenSlug &&
    lock.jobId === owner.jobId &&
    lock.buildId === owner.buildId
  );
}

function transientConflict(gardenDir: string, owner: LockOwner, now: number): GardenLearnLock {
  const existing = readGardenLearnLock(gardenDir);
  if (existing) return existing;
  const guard = readMutationGuard(gardenDir);
  const timestamp = guard?.acquiredAt ?? new Date(now).toISOString();
  return {
    gardenSlug: guard?.owner.gardenSlug ?? owner.gardenSlug,
    jobId: guard?.owner.jobId ?? "lock-transition",
    buildId: guard?.owner.buildId ?? "lock-transition",
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
    leaseId: guard?.token,
  };
}

function unreadableLockConflict(
  gardenDir: string,
  owner: LockOwner,
  now: number,
  mutationGuardToken: string,
  candidatePath: string,
): GardenLearnLock | null {
  try {
    const modifiedAt = fs.statSync(candidatePath).mtimeMs;
    if (now - modifiedAt >= LOCK_STALE_MS) {
      if (ownsMutationGuard(gardenDir, mutationGuardToken)) {
        fs.rmSync(candidatePath, { force: true });
        return null;
      }
    }
    const timestamp = new Date(modifiedAt).toISOString();
    return {
      gardenSlug: owner.gardenSlug,
      jobId: "unreadable-lock",
      buildId: "unreadable-lock",
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    };
  } catch {
    return null;
  }
}

/**
 * Try to acquire the per-garden build lock. Only one generation/publication job
 * may own a garden at a time. A second job is refused unless the existing lock
 * is stale (heartbeat expired). Returns the lock on success or a conflict.
 */
function acquireGardenLearnLockInternal(
  gardenDir: string,
  owner: LockOwner,
  now: number,
  expectedLeaseId: string | undefined,
): GardenLearnLockResult {
  const guard = acquireMutationGuard(gardenDir, owner);
  if (!guard) return { acquired: false, conflict: transientConflict(gardenDir, owner, now) };
  try {
    let existing = readLockFile(lockPath(gardenDir));
    if (!existing) {
      const unreadable = unreadableLockConflict(
        gardenDir,
        owner,
        now,
        guard.token,
        lockPath(gardenDir),
      );
      if (unreadable) return { acquired: false, conflict: unreadable };
      existing = readLockFile(legacyLockPath(gardenDir));
      if (!existing) {
        const unreadableLegacy = unreadableLockConflict(
          gardenDir,
          owner,
          now,
          guard.token,
          legacyLockPath(gardenDir),
        );
        if (unreadableLegacy) return { acquired: false, conflict: unreadableLegacy };
      }
    }
    const matchingOwner = existing ? sameLockOwner(existing, owner) : false;
    const authenticatedResume = Boolean(
      existing?.leaseId &&
      matchingOwner &&
      expectedLeaseId === existing.leaseId,
    );
    const legacyMigration = Boolean(existing && matchingOwner && !existing.leaseId);

    if (expectedLeaseId !== undefined && !authenticatedResume) {
      // A resume request is capability-authenticated. Never silently turn a
      // bad token into a new acquisition, even when the observed lock is old.
      return { acquired: false, conflict: existing ?? transientConflict(gardenDir, owner, now) };
    }
    if (existing && !authenticatedResume && !legacyMigration && lockIsFresh(existing, now)) {
      // Fresh leases are deliberately non-reentrant. Job/build IDs are often
      // deterministic and can be repeated by concurrent recovery processes.
      return { acquired: false, conflict: existing };
    }

    const continuingLease = authenticatedResume || legacyMigration ? existing : null;
    const lock: GardenLearnLock = {
      gardenSlug: owner.gardenSlug,
      jobId: owner.jobId,
      buildId: owner.buildId,
      acquiredAt: continuingLease ? continuingLease.acquiredAt : new Date(now).toISOString(),
      heartbeatAt: new Date(now).toISOString(),
      // A stale normal acquisition is a new ownership period, even if its
      // public owner fields happen to match the previous job.
      leaseId: continuingLease?.leaseId ?? crypto.randomUUID(),
    };
    writeGardenLearnLock(gardenDir, lock, guard.token);
    return { acquired: true, lock };
  } finally {
    releaseMutationGuard(gardenDir, guard.token);
  }
}

export function acquireGardenLearnLock(
  gardenDir: string,
  owner: LockOwner,
  now: number = Date.now(),
): GardenLearnLockResult {
  return acquireGardenLearnLockInternal(gardenDir, owner, now, undefined);
}

/** Resume a fresh lock only when the caller possesses its secret lease token. */
export function resumeGardenLearnLock(
  gardenDir: string,
  owner: LockOwner,
  leaseId: string,
  now: number = Date.now(),
): GardenLearnLockResult {
  if (!leaseId) throw new TypeError("leaseId is required to resume a Learn lock");
  return acquireGardenLearnLockInternal(gardenDir, owner, now, leaseId);
}

function heartbeatFencedGardenLearnLock(
  gardenDir: string,
  jobId: string,
  expectedLeaseId: string | undefined,
  now: number,
):
  | { status: "renewed"; lock: GardenLearnLock }
  | { status: "lost" }
  | { status: "retry" } {
  const currentState = readGardenLearnLockState(gardenDir);
  const current = currentState.status === "found" ? currentState.lock : null;
  const owner: LockOwner = current
    ? { gardenSlug: current.gardenSlug, jobId, buildId: current.buildId }
    : { gardenSlug: "unknown", jobId, buildId: "unknown" };
  const guard = acquireMutationGuard(gardenDir, owner);
  if (!guard) return { status: "retry" };
  try {
    const existingState = readGardenLearnLockState(gardenDir);
    if (existingState.status === "uncertain") return { status: "retry" };
    if (existingState.status === "missing") return { status: "lost" };
    const existing = existingState.lock;
    if (existing.jobId !== jobId) return { status: "lost" };
    if (expectedLeaseId !== undefined && existing.leaseId !== expectedLeaseId) {
      return { status: "lost" };
    }
    const renewed = { ...existing, heartbeatAt: new Date(now).toISOString() };
    if (!ownsMutationGuard(gardenDir, guard.token)) return { status: "retry" };
    writeGardenLearnLock(gardenDir, renewed, guard.token);
    return { status: "renewed", lock: renewed };
  } finally {
    releaseMutationGuard(gardenDir, guard.token);
  }
}

export function heartbeatGardenLearnLock(
  gardenDir: string,
  jobId: string,
  now: number = Date.now(),
): boolean {
  return heartbeatFencedGardenLearnLock(gardenDir, jobId, undefined, now).status === "renewed";
}

function releaseFencedGardenLearnLock(
  gardenDir: string,
  jobId: string,
  expectedLeaseId?: string,
): boolean {
  const current = readGardenLearnLock(gardenDir);
  const owner: LockOwner = current
    ? { gardenSlug: current.gardenSlug, jobId, buildId: current.buildId }
    : { gardenSlug: "unknown", jobId, buildId: "unknown" };
  const guard = acquireMutationGuard(gardenDir, owner);
  if (!guard) return false;
  try {
    const existing = readGardenLearnLock(gardenDir);
    if (!existing || existing.jobId !== jobId) return false;
    if (expectedLeaseId !== undefined && existing.leaseId !== expectedLeaseId) return false;
    if (!ownsMutationGuard(gardenDir, guard.token)) return false;
    try {
      fs.rmSync(legacyLockPath(gardenDir), { recursive: true, force: true });
    } catch {
      // Do not hide a legacy ownership record unless both representations can
      // be released together. A later retry or stale recovery remains safe.
      return false;
    }
    if (!ownsMutationGuard(gardenDir, guard.token)) return false;
    fs.rmSync(lockPath(gardenDir), { force: true });
    return true;
  } finally {
    releaseMutationGuard(gardenDir, guard.token);
  }
}

export function releaseGardenLearnLock(gardenDir: string, jobId: string): void {
  // Compatibility API. Long-running callers should prefer the fenced lease.
  releaseFencedGardenLearnLock(gardenDir, jobId);
}

/** Acquire a fenced, automatically renewed lease for a long Learn operation. */
export function acquireGardenLearnLease(
  gardenDir: string,
  owner: LockOwner,
  options: GardenLearnLeaseOptions = {},
): GardenLearnLeaseResult {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_LOCK_HEARTBEAT_INTERVAL_MS;
  if (
    !Number.isFinite(heartbeatIntervalMs) ||
    heartbeatIntervalMs <= 0 ||
    heartbeatIntervalMs >= LOCK_STALE_MS
  ) {
    throw new RangeError(`heartbeatIntervalMs must be greater than 0 and less than ${LOCK_STALE_MS}`);
  }
  const now = options.now ?? Date.now;
  const acquired = options.resumeLeaseId !== undefined
    ? resumeGardenLearnLock(gardenDir, owner, options.resumeLeaseId, now())
    : acquireGardenLearnLock(gardenDir, owner, now());
  if ("conflict" in acquired) return { acquired: false, conflict: acquired.conflict };

  let lock = acquired.lock;
  let lost = false;
  let released = false;
  let lossReported = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const reportLoss = () => {
    if (lossReported) return;
    lossReported = true;
    try { options.onLeaseLost?.(readGardenLearnLock(gardenDir)); } catch { /* observer only */ }
  };
  const confirmOwnership = (): GardenLearnLeaseOwnership => {
    if (released || lost) return "lost";
    let result: ReturnType<typeof heartbeatFencedGardenLearnLock>;
    try {
      result = heartbeatFencedGardenLearnLock(gardenDir, lock.jobId, lock.leaseId, now());
    } catch {
      // A transient filesystem failure must not crash the process or surrender
      // ownership. The next interval (and phase-boundary heartbeat) can retry.
      return "uncertain";
    }
    if (result.status === "retry") return "uncertain";
    if (result.status === "lost") {
      lost = true;
      stopTimer();
      reportLoss();
      return "lost";
    }
    lock = result.lock;
    return "owned";
  };
  const heartbeat = (): boolean => confirmOwnership() === "owned";

  const lease: GardenLearnLease = {
    get lock() { return lock; },
    get lost() { return lost; },
    confirmOwnership,
    heartbeat,
    release(): boolean {
      if (released) return false;
      released = true;
      stopTimer();
      return releaseFencedGardenLearnLock(gardenDir, lock.jobId, lock.leaseId);
    },
  };

  timer = setInterval(heartbeat, heartbeatIntervalMs);
  timer.unref?.();
  return { acquired: true, lease };
}
