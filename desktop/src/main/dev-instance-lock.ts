import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

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
 * Hot development is checkout-scoped because Next writes compiler state beside
 * the dashboard source. Ordinary and QA Hot launches therefore share this
 * strict lock. Lean and packaged launches do not run the Hot compiler and do
 * not claim it.
 */

export interface DevInstanceRecord {
  /** Which launcher took the lock: "desktop" or "stack". */
  owner: string;
  pid: number;
  startedAt: string;
  /** Absolute checkout path, so two clones never see each other's lock. */
  checkout: string;
  /** Unique claim generation used to distinguish PID reuse and stale records. */
  claimId?: string;
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

const MAX_CLAIM_ATTEMPTS = 16;

export interface HotCheckoutContext {
  desktopMode: "dev" | "packaged";
  launchMode: "hot" | "lean" | "packaged";
  qaMode: boolean;
}

/** QA isolation does not create a second physical Next.js source checkout. */
export function requiresExclusiveHotCheckout({
  desktopMode,
  launchMode,
}: HotCheckoutContext): boolean {
  return desktopMode === "dev" && launchMode === "hot";
}

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
    typeof record["checkout"] === "string" &&
    (record["claimId"] === undefined || typeof record["claimId"] === "string")
  );
}

function parseDevInstanceRecord(contents: string): DevInstanceRecord | null {
  try {
    const parsed: unknown = JSON.parse(contents);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readDevInstanceRecord(
  lockPath: string,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
): DevInstanceRecord | null {
  try {
    return parseDevInstanceRecord(readFile(lockPath));
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
  claimId?: string;
  isAlive?: (pid: number) => boolean;
  readFile?: (file: string) => string;
  createExclusive?: (file: string, contents: string) => void;
  removeFile?: (file: string) => void;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function strictClaimFailure(cause: unknown): Error {
  return new Error(
    "Breadboard could not secure the Hot development lock for this checkout. " +
      "Stop any other Breadboard Hot launch and make sure the checkout's .runtime folder is writable.",
    { cause },
  );
}

interface LockSnapshot {
  raw: string;
  record: DevInstanceRecord | null;
}

function readLockSnapshot(
  lockPath: string,
  readFile: (file: string) => string,
): LockSnapshot | null {
  try {
    const raw = readFile(lockPath);
    return { raw, record: parseDevInstanceRecord(raw) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw strictClaimFailure(error);
  }
}

function staleClaimMarkerPath(lockPath: string, raw: string): string {
  const digest = createHash("sha256").update(raw).digest("hex");
  return `${lockPath}.replace-${digest}`;
}

function markerOwnerPid(contents: string): number | null {
  try {
    const value = JSON.parse(contents) as { pid?: unknown };
    return typeof value.pid === "number" && Number.isInteger(value.pid)
      ? value.pid
      : null;
  } catch {
    return null;
  }
}

/**
 * Claim the development-instance lock for this checkout.
 *
 * New claims use exclusive-create rather than read-then-overwrite, so two
 * simultaneous Hot launches cannot both win. Replacing a stale/corrupt record
 * is also serialized by a marker derived from the exact bytes observed. The
 * winner re-reads those bytes before removal; it can never delete a newer claim
 * installed after its first read.
 */
export function claimDevInstance(options: ClaimOptions): DevInstanceCheck {
  const {
    repoRoot,
    owner,
    pid = process.pid,
    now = new Date(),
    claimId = randomUUID(),
    isAlive = processIsAlive,
    readFile = (file: string) => fs.readFileSync(file, "utf8"),
    createExclusive = (file: string, contents: string) =>
      fs.writeFileSync(file, contents, { encoding: "utf8", flag: "wx" }),
    removeFile = (file: string) => fs.rmSync(file, { force: true }),
  } = options;

  const lockPath = devInstanceLockPath(repoRoot);
  const record: DevInstanceRecord = {
    owner,
    pid,
    startedAt: now.toISOString(),
    checkout: path.resolve(repoRoot),
    claimId,
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch (error) {
    throw strictClaimFailure(error);
  }

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const snapshot = readLockSnapshot(lockPath, readFile);
    if (snapshot === null) {
      try {
        createExclusive(lockPath, serialized);
        return { conflict: false, existing: null, staleReplaced: false };
      } catch (error) {
        if (errorCode(error) === "EEXIST") continue;
        throw strictClaimFailure(error);
      }
    }

    const existing = snapshot.record;
    const sameCheckout =
      existing !== null && path.resolve(existing.checkout) === path.resolve(repoRoot);
    if (sameCheckout && existing.pid === pid) {
      return { conflict: false, existing, staleReplaced: false };
    }
    if (sameCheckout && existing !== null && isAlive(existing.pid)) {
      return { conflict: true, existing, staleReplaced: false };
    }

    // The record is stale, corrupt, or belongs to a checkout that moved. Only
    // one contender may attempt to replace these exact bytes.
    const markerPath = staleClaimMarkerPath(lockPath, snapshot.raw);
    let ownsMarker = false;
    try {
      try {
        createExclusive(
          markerPath,
          `${JSON.stringify({ pid, claimId, observedAt: now.toISOString() })}\n`,
        );
        ownsMarker = true;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw strictClaimFailure(error);
        const marker = readLockSnapshot(markerPath, readFile);
        const markerPid = marker === null ? null : markerOwnerPid(marker.raw);
        if (markerPid !== null && markerPid !== pid && isAlive(markerPid)) {
          throw strictClaimFailure(
            new Error("another Hot launch is replacing an abandoned lock"),
          );
        }
        try {
          removeFile(markerPath);
        } catch (removeError) {
          throw strictClaimFailure(removeError);
        }
        continue;
      }

      const current = readLockSnapshot(lockPath, readFile);
      if (current === null || current.raw !== snapshot.raw) continue;
      try {
        removeFile(lockPath);
      } catch (error) {
        throw strictClaimFailure(error);
      }
      try {
        createExclusive(lockPath, serialized);
        return {
          conflict: false,
          existing,
          staleReplaced:
            existing !== null &&
            sameCheckout &&
            existing.pid !== pid,
        };
      } catch (error) {
        if (errorCode(error) === "EEXIST") continue;
        throw strictClaimFailure(error);
      }
    } finally {
      if (ownsMarker) {
        try {
          removeFile(markerPath);
        } catch {
          // A leftover marker carries this live PID and makes contenders fail
          // closed. It is safely reaped after this process exits.
        }
      }
    }
  }

  throw strictClaimFailure(new Error("the lock changed too many times"));
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

/** High-visibility, secret-free failure text for a detected duplicate stack. */
export function duplicateStackWarning(existing: DevInstanceRecord): string {
  return (
    `Another Breadboard Hot development server is already running for this checkout ` +
    `(owner=${existing.owner}, pid=${existing.pid}, started=${existing.startedAt}). ` +
    `A second compiler for the same source tree is not allowed. Stop the other ` +
    `Hot launch before trying again.`
  );
}
