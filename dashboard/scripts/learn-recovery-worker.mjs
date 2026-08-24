import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const INVALID_LOCK_GRACE_MS = 60_000;

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function existingLockIsActive(lockPath) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return Number.isSafeInteger(owner?.pid) && owner.pid > 0
      ? processIsAlive(owner.pid)
      : Date.now() - fs.statSync(lockPath).mtimeMs < INVALID_LOCK_GRACE_MS;
  } catch {
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs < INVALID_LOCK_GRACE_MS;
    } catch {
      return false;
    }
  }
}

function acquireRecoveryLock(runtimeRoot) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const lockPath = path.join(runtimeRoot, "active.lock");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ownerId = randomUUID();
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify({ ownerId, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      return { fd, lockPath, ownerId };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (existingLockIsActive(lockPath)) return null;

      const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(lockPath, stalePath);
        fs.rmSync(stalePath, { force: true });
      } catch (reclaimError) {
        if (reclaimError?.code !== "ENOENT") return null;
      }
    }
  }

  return null;
}

function releaseRecoveryLock(lock) {
  fs.closeSync(lock.fd);
  try {
    const owner = JSON.parse(fs.readFileSync(lock.lockPath, "utf8"));
    if (owner?.ownerId === lock.ownerId) {
      fs.rmSync(lock.lockPath, { force: true });
    }
  } catch {
    // A replacement owner is authoritative; never remove an unreadable lock.
  }
}

async function main() {
  const configuredContentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!configuredContentPath) {
    throw new Error("QUARTZ_CONTENT_PATH is required for Learn recovery.");
  }
  const configuredRuntimeRoot = process.env.BREADBOARD_LEARN_RECOVERY_RUNTIME_DIR?.trim();
  if (!configuredRuntimeRoot) {
    throw new Error("The Learn recovery runtime directory is not configured.");
  }

  const lock = acquireRecoveryLock(path.resolve(configuredRuntimeRoot));
  if (!lock) {
    console.info("[learn-recovery-worker] Another recovery worker is active; skipping this sweep.");
    return;
  }

  try {
    const learn = await import("../src/lib/learn.ts");
    if (typeof learn.recoverAbandonedLearnJobs !== "function") {
      throw new Error("The Learn recovery operation is unavailable.");
    }
    await learn.recoverAbandonedLearnJobs({
      contentPath: path.resolve(configuredContentPath),
    });
    console.info("[learn-recovery-worker] Recovery sweep completed.");
  } finally {
    releaseRecoveryLock(lock);
  }
}

try {
  await main();
} catch (error) {
  console.error("[learn-recovery-worker] Recovery failed:", error);
  process.exitCode = 1;
}
