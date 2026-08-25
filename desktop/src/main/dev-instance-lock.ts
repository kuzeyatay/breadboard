import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Detects a second development stack running against the same checkout.
 *
 * `npm run dev` (scripts/dev-all.mjs) and `npm run desktop:dev` both launch
 * `next dev` plus the same sidecars. Neither used to check for the
 * other: dev-all.mjs spawns unconditionally, and the desktop supervisor's
 * `allocatePort` quietly moved the dashboard to a free port when 3000 was taken.
 * The result is two independent dev servers sharing one `dashboard/db`, each
 * able to grow into the gigabytes — doubling exactly the exposure that
 * exhausted the system commit limit.
 *
 * This lock is a warning, not a block. Isolated QA profiles and deliberately
 * parallel test runs are legitimate, so the guard reports and steps aside.
 * Separately, an identified dashboard already holding the preferred port is
 * refused because an externally owned compiler cannot be memory-supervised.
 */

export interface DevInstanceRecord {
  /** Which launcher took the lock: "desktop" or "stack". */
  owner: string;
  pid: number;
  startedAt: string;
  /** Absolute checkout path, so two clones never see each other's lock. */
  checkout: string;
}

export interface DevInstanceCheck {
  /** A live foreign stack was found. */
  conflict: boolean;
  /** The record that was found, whether live or stale. */
  existing: DevInstanceRecord | null;
  /** Set when a stale record was discarded. */
  staleReplaced: boolean;
}

export const DEV_INSTANCE_LOCK_RELATIVE = path.join(".runtime", "dev-stack.lock.json");

export function devInstanceLockPath(repoRoot: string): string {
  return path.join(repoRoot, DEV_INSTANCE_LOCK_RELATIVE);
}

function isRecord(value: unknown): value is DevInstanceRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["owner"] === "string" &&
    typeof record["pid"] === "number" &&
    Number.isInteger(record["pid"]) &&
    typeof record["startedAt"] === "string" &&
    typeof record["checkout"] === "string"
  );
}

export function readDevInstanceRecord(
  lockPath: string,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
): DevInstanceRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFile(lockPath));
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Missing, truncated or hand-edited: treat as no lock rather than fail.
    return null;
  }
}

/** Default liveness probe; signal 0 never disturbs the target. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ClaimOptions {
  repoRoot: string;
  owner: string;
  pid?: number;
  now?: Date;
  isAlive?: (pid: number) => boolean;
  readFile?: (file: string) => string;
  writeFile?: (file: string, contents: string) => void;
}

/**
 * Claim the development-instance lock for this checkout.
 *
 * A record whose pid is no longer alive is stale and is taken over silently —
 * a crashed or force-killed stack must never wedge the next run. A record
 * belonging to *this* process is not a conflict, and neither is a record from a
 * different checkout, which cannot be in this file in the first place.
 */
export function claimDevInstance(options: ClaimOptions): DevInstanceCheck {
  const {
    repoRoot,
    owner,
    pid = process.pid,
    now = new Date(),
    isAlive = processIsAlive,
    readFile = (file: string) => fs.readFileSync(file, "utf8"),
    writeFile = (file: string, contents: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    },
  } = options;

  const lockPath = devInstanceLockPath(repoRoot);
  const existing = readDevInstanceRecord(lockPath, readFile);
  // Only a record for this same checkout can conflict; a stale path means the
  // repository moved and the record is meaningless.
  const sameCheckout =
    existing !== null && path.resolve(existing.checkout) === path.resolve(repoRoot);
  const live = sameCheckout && existing.pid !== pid && isAlive(existing.pid);

  if (live) {
    return { conflict: true, existing, staleReplaced: false };
  }

  const record: DevInstanceRecord = {
    owner,
    pid,
    startedAt: now.toISOString(),
    checkout: path.resolve(repoRoot),
  };
  try {
    writeFile(lockPath, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // The guard is advisory; an unwritable .runtime must not stop startup.
  }
  return {
    conflict: false,
    existing,
    staleReplaced: existing !== null && sameCheckout && !live && existing.pid !== pid,
  };
}

/** Release the lock if this process still owns it. */
export function releaseDevInstance(
  repoRoot: string,
  pid: number = process.pid,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
  remove: (file: string) => void = (file) => fs.rmSync(file, { force: true }),
): void {
  const lockPath = devInstanceLockPath(repoRoot);
  const existing = readDevInstanceRecord(lockPath, readFile);
  if (existing && existing.pid === pid) {
    try {
      remove(lockPath);
    } catch {
      // Best effort; a leftover record is detected as stale next time.
    }
  }
}

/** High-visibility, secret-free warning text for a detected duplicate stack. */
export function duplicateStackWarning(existing: DevInstanceRecord): string {
  return (
    `Another Breadboard development stack is already running for this checkout ` +
    `(owner=${existing.owner}, pid=${existing.pid}, started=${existing.startedAt}). ` +
    `Two stacks run two "next dev" servers against the same dashboard/db, and each ` +
    `can grow to several gigabytes. Stop the other stack unless this is deliberate.`
  );
}
