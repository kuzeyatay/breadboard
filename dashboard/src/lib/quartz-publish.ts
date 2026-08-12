import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_BUILD_CONCURRENCY = 1;
const DEFAULT_BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_POLL_MS = 100;
const DEFAULT_LOCK_STALE_MS = 30_000;
const LOCK_DIRECTORY_NAME = ".breadboard-quartz-publish.lock";
const LOCK_OWNER_FILE_NAME = "owner.json";

interface QuartzPublishLockOwner {
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
}

interface QuartzPublishLease {
  release: () => void;
}

const pendingReasons = new Set<string>();
let activePublish: Promise<void> | null = null;

function envValue(rawValue: string | undefined): string {
  return rawValue?.trim().toLowerCase() ?? "";
}

function isDisabled(rawValue: string | undefined): boolean {
  return DISABLED_ENV_VALUES.has(envValue(rawValue));
}

function shouldAutoPublish(): boolean {
  const configured = process.env.QUARTZ_AUTO_PUBLISH;
  if (configured) return !isDisabled(configured);
  return process.env.NODE_ENV === "production";
}

function publishMode(): "await" | "background" {
  return envValue(process.env.QUARTZ_PUBLISH_MODE) === "background"
    ? "background"
    : "await";
}

function quartzRootPath(): string | null {
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!contentPath) return null;

  const quartzRoot = path.dirname(path.resolve(contentPath));
  const cliPath = path.join(quartzRoot, "quartz", "bootstrap-cli.mjs");
  const packageJsonPath = path.join(quartzRoot, "package.json");

  if (!fs.existsSync(cliPath) || !fs.existsSync(packageJsonPath)) return null;
  return fs.realpathSync.native(quartzRoot);
}

function quartzBuildConcurrency(): number {
  const parsed = Number.parseInt(
    process.env.QUARTZ_BUILD_CONCURRENCY ?? "",
    10,
  );
  if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  return DEFAULT_BUILD_CONCURRENCY;
}

function quartzBuildTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.QUARTZ_BUILD_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 10_000) return parsed;
  return DEFAULT_BUILD_TIMEOUT_MS;
}

function positiveIntegerEnvironmentValue(
  name: string,
  minimum: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= minimum) return Math.floor(parsed);
  return fallback;
}

function quartzPublishLockPollMs(): number {
  return positiveIntegerEnvironmentValue(
    "QUARTZ_PUBLISH_LOCK_POLL_MS",
    10,
    DEFAULT_LOCK_POLL_MS,
  );
}

function quartzPublishLockStaleMs(): number {
  return positiveIntegerEnvironmentValue(
    "QUARTZ_PUBLISH_LOCK_STALE_MS",
    1_000,
    DEFAULT_LOCK_STALE_MS,
  );
}

function quartzPublishLockWaitMs(): number {
  return positiveIntegerEnvironmentValue(
    "QUARTZ_PUBLISH_LOCK_TIMEOUT_MS",
    10_000,
    quartzBuildTimeoutMs() + quartzPublishLockStaleMs() + 60_000,
  );
}

function normalizeReason(reason: string): string {
  const trimmed = reason.trim();
  return trimmed || "Breadboard content update";
}

function consumePendingReasons(): string[] {
  const reasons = [...pendingReasons];
  pendingReasons.clear();
  return reasons;
}

function readQuartzPublishLockOwner(
  lockDirectory: string,
): QuartzPublishLockOwner | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(lockDirectory, LOCK_OWNER_FILE_NAME), "utf8"),
    ) as Partial<QuartzPublishLockOwner>;
    if (
      parsed.version !== 1 ||
      typeof parsed.token !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.acquiredAt !== "string" ||
      typeof parsed.heartbeatAt !== "string"
    ) {
      return null;
    }
    return parsed as QuartzPublishLockOwner;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockHeartbeatAgeMs(lockDirectory: string): number {
  try {
    return Date.now() - fs.statSync(
      path.join(lockDirectory, LOCK_OWNER_FILE_NAME),
    ).mtimeMs;
  } catch {
    try {
      return Date.now() - fs.statSync(lockDirectory).mtimeMs;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
}

function staleLockIdentity(
  lockDirectory: string,
  owner: QuartzPublishLockOwner | null,
): string {
  if (owner?.token) return owner.token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  try {
    return `orphan-${Math.floor(fs.statSync(lockDirectory).mtimeMs)}`;
  } catch {
    return `orphan-${randomUUID()}`;
  }
}

function retireStaleQuartzPublishLock(
  lockDirectory: string,
  staleAfterMs: number,
): boolean {
  const owner = readQuartzPublishLockOwner(lockDirectory);
  if (
    owner?.hostname === os.hostname() &&
    processIsAlive(owner.pid)
  ) {
    return false;
  }
  if (owner && lockHeartbeatAgeMs(lockDirectory) <= staleAfterMs) return false;
  if (!owner && lockHeartbeatAgeMs(lockDirectory) <= staleAfterMs) return false;

  // The token-derived destination is intentionally retained as a tombstone.
  // If two waiters observed the same stale owner, only one can perform this
  // rename; the other cannot accidentally rename the first waiter's new lock.
  const retiredDirectory = `${lockDirectory}.stale-${staleLockIdentity(
    lockDirectory,
    owner,
  )}`;
  try {
    fs.renameSync(lockDirectory, retiredDirectory);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EEXIST" || code === "ENOTEMPTY") {
      return false;
    }
    throw error;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireQuartzPublishLease(
  quartzRoot: string,
): Promise<QuartzPublishLease> {
  const lockDirectory = path.join(quartzRoot, LOCK_DIRECTORY_NAME);
  const staleAfterMs = quartzPublishLockStaleMs();
  const deadline = Date.now() + quartzPublishLockWaitMs();
  let loggedWait = false;

  while (true) {
    const token = randomUUID();
    const timestamp = new Date().toISOString();
    const owner: QuartzPublishLockOwner = {
      version: 1,
      token,
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    };

    try {
      fs.mkdirSync(lockDirectory);
      try {
        fs.writeFileSync(
          path.join(lockDirectory, LOCK_OWNER_FILE_NAME),
          `${JSON.stringify(owner)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        fs.rmSync(lockDirectory, { recursive: true, force: true });
        throw error;
      }

      let released = false;
      const ownerPath = path.join(lockDirectory, LOCK_OWNER_FILE_NAME);
      const heartbeatIntervalMs = Math.max(
        1_000,
        Math.min(5_000, Math.floor(staleAfterMs / 3)),
      );
      const heartbeat = setInterval(() => {
        if (released) return;
        const currentOwner = readQuartzPublishLockOwner(lockDirectory);
        if (currentOwner?.token !== token) return;
        try {
          const now = new Date();
          fs.utimesSync(ownerPath, now, now);
        } catch {
          // A failed heartbeat makes the lock eligible for conservative stale
          // recovery. Release is fenced by the token below.
        }
      }, heartbeatIntervalMs);
      heartbeat.unref();

      return {
        release: () => {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          if (readQuartzPublishLockOwner(lockDirectory)?.token !== token) return;

          const releasedDirectory = `${lockDirectory}.released-${token}`;
          try {
            fs.renameSync(lockDirectory, releasedDirectory);
            if (
              readQuartzPublishLockOwner(releasedDirectory)?.token !== token
            ) {
              if (!fs.existsSync(lockDirectory)) {
                fs.renameSync(releasedDirectory, lockDirectory);
              }
              return;
            }
            fs.rmSync(releasedDirectory, { recursive: true, force: true });
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
              console.warn(
                `[quartz] Could not release publication lock: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (retireStaleQuartzPublishLock(lockDirectory, staleAfterMs)) continue;
    if (Date.now() >= deadline) {
      const owner = readQuartzPublishLockOwner(lockDirectory);
      const ownerLabel = owner
        ? `process ${owner.pid} on ${owner.hostname}`
        : "an unknown process";
      throw new Error(
        `Timed out waiting for the Quartz publication lock held by ${ownerLabel}.`,
      );
    }
    if (!loggedWait) {
      console.info("[quartz] Waiting for another process to finish publishing");
      loggedWait = true;
    }
    await sleep(quartzPublishLockPollMs());
  }
}

async function runQuartzBuild(reasons: string[]): Promise<void> {
  const quartzRoot = quartzRootPath();
  if (!quartzRoot) {
    throw new Error(
      "Quartz auto-publish is enabled, but QUARTZ_CONTENT_PATH does not resolve to a Quartz checkout.",
    );
  }

  const lease = await acquireQuartzPublishLease(quartzRoot);
  try {
    const cliPath = path.join(quartzRoot, "quartz", "bootstrap-cli.mjs");
    const args = [
      cliPath,
      "build",
      `--concurrency=${quartzBuildConcurrency()}`,
    ];
    const reasonLabel = [...new Set(reasons.map(normalizeReason))].join(", ");
    const startedAt = Date.now();

    console.info(`[quartz] Publishing static garden (${reasonLabel})`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: quartzRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, quartzBuildTimeoutMs());

      child.stdout.on("data", (chunk) => {
        stdout = `${stdout}${chunk.toString()}`.slice(-8_000);
      });

      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);

        if (timedOut) {
          reject(
            new Error(
              `Quartz build timed out after ${quartzBuildTimeoutMs()} ms.`,
            ),
          );
          return;
        }

        if (code === 0) {
          const durationMs = Date.now() - startedAt;
          console.info(
            `[quartz] Publish complete in ${(durationMs / 1000).toFixed(1)}s`,
          );
          resolve();
          return;
        }

        const details = (stderr || stdout).trim();
        reject(
          new Error(
            details
              ? `Quartz build exited with code ${code}: ${details}`
              : `Quartz build exited with code ${code}.`,
          ),
        );
      });
    });
  } finally {
    lease.release();
  }
}

async function drainQuartzPublishQueue(): Promise<void> {
  try {
    while (pendingReasons.size > 0) {
      await runQuartzBuild(consumePendingReasons());
    }
  } finally {
    activePublish = null;
  }
}

function queueQuartzPublish(reason: string): Promise<void> {
  pendingReasons.add(normalizeReason(reason));
  if (!activePublish) {
    activePublish = drainQuartzPublishQueue();
  }
  return activePublish;
}

function logPublishError(reason: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[quartz] Auto-publish failed after ${normalizeReason(reason)}: ${message}`,
  );
}

export async function publishQuartzAfterMutation(
  reason: string,
  options: { requireSuccess?: boolean } = {},
): Promise<void> {
  if (!shouldAutoPublish()) return;

  const publishPromise = queueQuartzPublish(reason);

  if (options.requireSuccess) {
    try {
      await publishPromise;
      return;
    } catch (error) {
      logPublishError(reason, error);
      throw error;
    }
  }

  if (publishMode() === "background") {
    void publishPromise.catch((error) => logPublishError(reason, error));
    return;
  }

  try {
    await publishPromise;
  } catch (error) {
    logPublishError(reason, error);
  }
}
