import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type CoordinatorState = {
  child?: ChildProcess;
  restartTimer?: ReturnType<typeof setTimeout>;
  stopping: boolean;
  consecutiveFailures: number;
  exitHookInstalled: boolean;
};

const globalState = globalThis as typeof globalThis & {
  __breadboardBackgroundCoordinator?: CoordinatorState;
};

function state(): CoordinatorState {
  if (!globalState.__breadboardBackgroundCoordinator) {
    globalState.__breadboardBackgroundCoordinator = {
      stopping: false,
      consecutiveFailures: 0,
      exitHookInstalled: false,
    };
  }
  return globalState.__breadboardBackgroundCoordinator;
}

function dashboardRoot(): string {
  return process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT?.trim() || process.cwd();
}

function sourceRoot(root: string): string {
  const configured = process.env.BREADBOARD_LEARN_SOURCE_ROOT?.trim();
  if (configured) return configured;
  const packaged = path.join(root, "worker-src");
  return fs.existsSync(packaged) ? packaged : path.join(root, "src");
}

function coordinatorNodeOptions(): string {
  const configured = process.env.BREADBOARD_BACKGROUND_COORDINATOR_HEAP_MB?.trim();
  const requested = configured && /^\d+$/.test(configured) ? Number(configured) : 1024;
  const heapMb = Math.min(2048, Math.max(256, requested));
  const inherited = (process.env.NODE_OPTIONS ?? "")
    .replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+/g, " ")
    .replace(/(?:^|\s)--max_old_space_size(?:=|\s+)\d+/g, " ")
    .trim();
  return [inherited, `--max-old-space-size=${heapMb}`].filter(Boolean).join(" ");
}

function launch(): void {
  const current = state();
  if (current.stopping || current.child) return;
  const root = dashboardRoot();
  const script = path.join(root, "scripts", "background-coordinator.mjs");
  const hook = path.join(root, "scripts", "learn-worker-import-hook.mjs");
  if (!fs.existsSync(script) || !fs.existsSync(hook)) {
    console.warn(
      `[background-coordinator] disabled: worker entry or import hook is missing below ${root}`,
    );
    return;
  }

  const startedAt = Date.now();
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--import", hook, script],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: {
        ...process.env,
        NODE_OPTIONS: coordinatorNodeOptions(),
        BREADBOARD_BACKGROUND_COORDINATOR_PROCESS: "1",
        BREADBOARD_LEARN_SOURCE_ROOT: sourceRoot(root),
      },
    },
  );
  current.child = child;
  child.once("error", (error) => {
    console.error(`[background-coordinator] could not start: ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    if (current.child === child) current.child = undefined;
    if (current.stopping) return;
    current.consecutiveFailures = Date.now() - startedAt > 5 * 60_000
      ? 0
      : current.consecutiveFailures + 1;
    const backoffMs = Math.min(60_000, 2_000 * 2 ** current.consecutiveFailures);
    console.error(
      `[background-coordinator] exited code=${code ?? "null"} signal=${signal ?? "none"}; ` +
        `retrying in ${backoffMs}ms`,
    );
    current.restartTimer = setTimeout(() => {
      current.restartTimer = undefined;
      launch();
    }, backoffMs);
    current.restartTimer.unref();
  });
}

export function startBackgroundCoordinator(): void {
  if (
    process.env.BREADBOARD_BACKGROUND_COORDINATOR_DISABLED === "1" ||
    process.env.BREADBOARD_DESKTOP_BUILD === "1" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    return;
  }
  const current = state();
  if (!current.exitHookInstalled) {
    current.exitHookInstalled = true;
    process.once("exit", () => {
      current.stopping = true;
      if (current.restartTimer) clearTimeout(current.restartTimer);
    });
  }
  launch();
}
