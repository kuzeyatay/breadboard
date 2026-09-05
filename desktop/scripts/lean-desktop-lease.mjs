import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const LEAN_DESKTOP_LEASE_RELATIVE = path.join(
  ".runtime",
  "lean-desktop.lock.json",
);

const MAX_CLAIM_ATTEMPTS = 16;

function errorCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isInteger(value.pid) &&
    typeof value.startedAt === "string" &&
    typeof value.checkout === "string" &&
    typeof value.claimId === "string"
  );
}

function parseRecord(contents) {
  try {
    const parsed = JSON.parse(contents);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sameCheckout(left, right) {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

function strictLeaseFailure(cause) {
  return new Error(
    "Breadboard could not secure the lean desktop lease for this checkout. " +
      "Stop any other lean Breadboard command and make sure the checkout's .runtime folder is writable.",
    { cause },
  );
}

function readSnapshot(lockPath, readFile) {
  try {
    const raw = readFile(lockPath);
    return { raw, record: parseRecord(raw) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw strictLeaseFailure(error);
  }
}

function markerPathFor(lockPath, raw) {
  const digest = createHash("sha256").update(raw).digest("hex");
  return `${lockPath}.replace-${digest}`;
}

function markerOwnerPid(contents) {
  try {
    const value = JSON.parse(contents);
    return Number.isInteger(value.pid) ? value.pid : null;
  } catch {
    return null;
  }
}

export function leanDesktopLeasePath(repoRoot) {
  return path.join(repoRoot, LEAN_DESKTOP_LEASE_RELATIVE);
}

/** Signal zero checks liveness without interrupting the incumbent process. */
export function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export function readLeanDesktopLease(
  lockPath,
  readFile = (file) => fs.readFileSync(file, "utf8"),
) {
  try {
    return parseRecord(readFile(lockPath));
  } catch {
    return null;
  }
}

/**
 * Claim one checkout-wide lean desktop lifecycle.
 *
 * The lease covers both the standalone build and the Electron process that
 * consumes it. That prevents a second launcher from rotating `.next-desktop`
 * out from under a live server. Stale replacement is serialized against the
 * exact bytes observed so contenders cannot remove a newer claim.
 */
export function claimLeanDesktopLease({
  repoRoot,
  pid = process.pid,
  now = new Date(),
  claimId = randomUUID(),
  isAlive = processIsAlive,
  readFile = (file) => fs.readFileSync(file, "utf8"),
  createExclusive = (file, contents) =>
    fs.writeFileSync(file, contents, { encoding: "utf8", flag: "wx" }),
  removeFile = (file) => fs.rmSync(file, { force: true }),
}) {
  const lockPath = leanDesktopLeasePath(repoRoot);
  const record = {
    pid,
    startedAt: now.toISOString(),
    checkout: path.resolve(repoRoot),
    claimId,
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;

  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch (error) {
    throw strictLeaseFailure(error);
  }

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const snapshot = readSnapshot(lockPath, readFile);
    if (snapshot === null) {
      try {
        createExclusive(lockPath, serialized);
        return { acquired: true, existing: null, record, staleReplaced: false };
      } catch (error) {
        if (errorCode(error) === "EEXIST") continue;
        throw strictLeaseFailure(error);
      }
    }

    const existing = snapshot.record;
    const belongsHere =
      existing !== null && sameCheckout(existing.checkout, repoRoot);
    if (belongsHere && existing.pid === pid) {
      return {
        acquired: true,
        existing,
        record: existing,
        staleReplaced: false,
      };
    }
    if (belongsHere && isAlive(existing.pid)) {
      return { acquired: false, existing, record: null, staleReplaced: false };
    }

    const markerPath = markerPathFor(lockPath, snapshot.raw);
    let ownsMarker = false;
    try {
      try {
        createExclusive(
          markerPath,
          `${JSON.stringify({ pid, claimId, observedAt: now.toISOString() })}\n`,
        );
        ownsMarker = true;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw strictLeaseFailure(error);
        const marker = readSnapshot(markerPath, readFile);
        const markerPid = marker === null ? null : markerOwnerPid(marker.raw);
        if (markerPid !== null && markerPid !== pid && isAlive(markerPid)) {
          throw strictLeaseFailure(
            new Error("another lean launch is replacing an abandoned lease"),
          );
        }
        try {
          removeFile(markerPath);
        } catch (removeError) {
          throw strictLeaseFailure(removeError);
        }
        continue;
      }

      const current = readSnapshot(lockPath, readFile);
      if (current === null || current.raw !== snapshot.raw) continue;
      try {
        removeFile(lockPath);
        createExclusive(lockPath, serialized);
        return {
          acquired: true,
          existing,
          record,
          staleReplaced: existing !== null && belongsHere,
        };
      } catch (error) {
        if (errorCode(error) === "EEXIST") continue;
        throw strictLeaseFailure(error);
      }
    } finally {
      if (ownsMarker) {
        try {
          removeFile(markerPath);
        } catch {
          // A future claimant can reap a marker after this owner exits.
        }
      }
    }
  }

  throw strictLeaseFailure(new Error("the lease changed too many times"));
}

export function releaseLeanDesktopLease(
  repoRoot,
  { pid = process.pid, claimId },
  readFile = (file) => fs.readFileSync(file, "utf8"),
  removeFile = (file) => fs.rmSync(file, { force: true }),
) {
  const lockPath = leanDesktopLeasePath(repoRoot);
  const existing = readLeanDesktopLease(lockPath, readFile);
  if (existing?.pid !== pid || existing.claimId !== claimId) return;
  try {
    removeFile(lockPath);
  } catch {
    // Best effort. The next launch reaps a lease whose PID is no longer live.
  }
}

export function duplicateLeanDesktopWarning(existing) {
  return (
    `Another Breadboard lean desktop command is already running ` +
    `(pid=${existing.pid}, started=${existing.startedAt}). ` +
    `Close that Breadboard instance or stop its command before rebuilding.`
  );
}
