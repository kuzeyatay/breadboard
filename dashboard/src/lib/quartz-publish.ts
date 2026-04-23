import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_BUILD_CONCURRENCY = 1;
const DEFAULT_BUILD_TIMEOUT_MS = 15 * 60 * 1000;

let pendingReasons = new Set<string>();
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
  return quartzRoot;
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

function normalizeReason(reason: string): string {
  const trimmed = reason.trim();
  return trimmed || "Breadboard content update";
}

function consumePendingReasons(): string[] {
  const reasons = [...pendingReasons];
  pendingReasons.clear();
  return reasons;
}

async function runQuartzBuild(reasons: string[]): Promise<void> {
  const quartzRoot = quartzRootPath();
  if (!quartzRoot) {
    console.warn(
      "[quartz] Auto-publish skipped because QUARTZ_CONTENT_PATH does not resolve to a Quartz checkout.",
    );
    return;
  }

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

export async function publishQuartzAfterMutation(reason: string): Promise<void> {
  if (!shouldAutoPublish()) return;

  const publishPromise = queueQuartzPublish(reason);

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
