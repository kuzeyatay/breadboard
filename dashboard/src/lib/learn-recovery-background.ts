import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const globalState = globalThis as typeof globalThis & {
  __breadboardLearnRecoveryWorker?: Promise<void>;
};

function dashboardRecoveryWorkerRoot(): string {
  const configured = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  const candidates = [
    configured,
    process.cwd(),
    path.join(process.cwd(), "dashboard"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (
      fs.existsSync(path.join(root, "scripts", "learn-recovery-worker.mjs")) &&
      fs.existsSync(path.join(root, "scripts", "learn-worker-import-hook.mjs")) &&
      fs.existsSync(path.join(root, "src", "lib", "learn.ts"))
    ) {
      return root;
    }
  }

  throw new Error("The detached Learn recovery worker is not installed.");
}

function recoveryRuntimeRoot(dashboardRoot: string): string {
  const dataRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  return dataRoot
    ? path.join(path.resolve(dataRoot), "learn-recovery")
    : path.join(path.dirname(dashboardRoot), ".runtime", "learn-recovery");
}

function runRecoveryWorker(contentPath: string): Promise<void> {
  const dashboardRoot = dashboardRecoveryWorkerRoot();
  const runtimeRoot = recoveryRuntimeRoot(dashboardRoot);
  const logPath = path.join(runtimeRoot, "learn-recovery.log");
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const logFd = fs.openSync(logPath, "a");
  let child: ChildProcess;
  try {
    child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        pathToFileURL(
          path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
        ).href,
        path.join(dashboardRoot, "scripts", "learn-recovery-worker.mjs"),
      ],
      {
        cwd: dashboardRoot,
        detached: true,
        windowsHide: true,
        env: {
          ...process.env,
          BREADBOARD_LEARN_RECOVERY_RUNTIME_DIR: runtimeRoot,
          QUARTZ_CONTENT_PATH: contentPath,
        },
        stdio: ["ignore", logFd, logFd],
      },
    );
  } finally {
    fs.closeSync(logFd);
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `Detached Learn recovery exited with code ${code ?? "none"} ` +
            `and signal ${signal ?? "none"}. See ${logPath}.`,
        ),
      );
    });
    child.unref();
  });
}

/**
 * Run at most one detached recovery worker from this Next process. The worker
 * also owns a process-level lock, so a replacement Next server cannot overlap
 * the still-running recovery process it just outlived.
 */
export function launchAbandonedLearnRecoveryWorker(): Promise<void> {
  const configuredContentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!configuredContentPath) return Promise.resolve();
  if (globalState.__breadboardLearnRecoveryWorker) {
    return globalState.__breadboardLearnRecoveryWorker;
  }

  const contentPath = path.resolve(configuredContentPath);
  const active = runRecoveryWorker(contentPath);
  globalState.__breadboardLearnRecoveryWorker = active;
  void active.then(
    () => {
      if (globalState.__breadboardLearnRecoveryWorker === active) {
        delete globalState.__breadboardLearnRecoveryWorker;
      }
    },
    () => {
      if (globalState.__breadboardLearnRecoveryWorker === active) {
        delete globalState.__breadboardLearnRecoveryWorker;
      }
    },
  );
  return active;
}
