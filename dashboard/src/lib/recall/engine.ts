// Lifecycle of the Breadboard-launched Recall capture engine.
//
// In the packaged desktop app the supervisor owns this process; in a dev
// checkout the dashboard starts it on request. Either way the contract is the
// same: one pid recorded in the Recall home, a log file next to it, and a
// health probe as the only claim that capture is actually happening. The pid
// file alone is never treated as proof — a live pid whose API does not answer
// is reported as starting, not as recording.

import { spawn } from "child_process";
import fs from "fs";

import { ensureRecallApiKey } from "./api-key.ts";
import {
  getRecallConfig,
  recallEngineLogPath,
  recallProcessStatePath,
  type RecallConfig,
} from "./config.ts";
import { RecallError } from "./errors.ts";
import { processAlive, resolveBinaryPath } from "./install.ts";
import type { RecallSettings } from "./policy.ts";

export interface RecallProcessState {
  /** A pid Breadboard launched and that is still alive. */
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  /** Arguments the running engine was launched with, for drift detection. */
  launchedWith: string[] | null;
  /** True when Breadboard has no pid file — the engine may still run elsewhere. */
  managed: boolean;
}

function readProcessState(config: RecallConfig): {
  pid: number | null;
  startedAt: string | null;
  args: string[] | null;
} {
  try {
    const raw = JSON.parse(fs.readFileSync(recallProcessStatePath(config), "utf8")) as Record<
      string,
      unknown
    >;
    const pid =
      typeof raw.pid === "number" && Number.isFinite(raw.pid) && raw.pid > 0 ? raw.pid : null;
    return {
      pid,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
      args: Array.isArray(raw.args)
        ? raw.args.filter((item): item is string => typeof item === "string")
        : null,
    };
  } catch {
    return { pid: null, startedAt: null, args: null };
  }
}

function writeProcessState(
  config: RecallConfig,
  state: { pid: number; startedAt: string; args: string[] },
): void {
  fs.mkdirSync(config.home, { recursive: true });
  fs.writeFileSync(recallProcessStatePath(config), `${JSON.stringify(state)}\n`, "utf8");
}

function clearProcessState(config: RecallConfig): void {
  try {
    fs.rmSync(recallProcessStatePath(config), { force: true });
  } catch {
    // A stale state file is recovered from on the next read anyway.
  }
}

export function engineProcessState(
  config: RecallConfig = getRecallConfig(),
): RecallProcessState {
  const state = readProcessState(config);
  const running = state.pid !== null && processAlive(state.pid);
  return {
    running,
    pid: running ? state.pid : null,
    startedAt: running ? state.startedAt : null,
    launchedWith: running ? state.args : null,
    managed: state.pid !== null,
  };
}

/** Port the configured base URL points at; the engine defaults to 3030. */
export function enginePort(config: RecallConfig = getRecallConfig()): number {
  try {
    const url = new URL(config.baseUrl);
    return url.port ? Number.parseInt(url.port, 10) : 3030;
  } catch {
    return 3030;
  }
}

/**
 * The argv the user's settings translate into. Kept pure and exported so the
 * mapping from a privacy control to a real engine flag is directly testable —
 * an exclusion that silently fails to reach the recorder is the one bug in
 * this feature that matters most.
 */
export function buildEngineArgs(
  settings: RecallSettings,
  config: RecallConfig = getRecallConfig(),
): string[] {
  const args = [
    "record",
    "--port",
    String(enginePort(config)),
    "--data-dir",
    config.dataDir,
  ];
  if (!settings.captureAudio) args.push("--disable-audio");
  for (const window of settings.excludedWindows) {
    args.push("--ignored-windows", window);
  }
  return args;
}

export function startEngine(
  settings: RecallSettings,
  config: RecallConfig = getRecallConfig(),
): RecallProcessState {
  if (!config.enabled) throw new RecallError("feature_disabled");
  if (!settings.captureEnabled) throw new RecallError("capture_disabled");

  const existing = engineProcessState(config);
  if (existing.running) throw new RecallError("engine_already_running");

  const binary = resolveBinaryPath(config);
  if (!binary) throw new RecallError("not_installed");

  const args = buildEngineArgs(settings, config);
  let log: number;
  let apiKey: string;
  try {
    fs.mkdirSync(config.home, { recursive: true });
    fs.mkdirSync(config.dataDir, { recursive: true });
    // Minted before launch rather than discovered afterwards. A recorder
    // started without one still records, but nothing can read what it records,
    // so this belongs with the other preconditions and not in the read path.
    apiKey = ensureRecallApiKey(config);
    // Truncating on each start keeps the log to one run — the only run whose
    // failure the settings tab is ever asked to explain.
    log = fs.openSync(recallEngineLogPath(config), "w");
  } catch (error) {
    throw new RecallError("engine_start_failed", {
      detail: "could not prepare the Recall home",
      cause: error,
    });
  }

  try {
    const child = spawn(binary, args, {
      cwd: config.home,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        SCREENPIPE_DISTRIBUTION: "breadboard",
        // First in the engine's own key resolution order, and mirrored by it
        // into its secret store — so this one value is what every later reader
        // agrees on.
        SCREENPIPE_API_KEY: apiKey,
      },
    });
    if (!child.pid) throw new Error("no pid");
    const startedAt = new Date().toISOString();
    writeProcessState(config, { pid: child.pid, startedAt, args });
    child.unref();
    return { running: true, pid: child.pid, startedAt, launchedWith: args, managed: true };
  } catch (error) {
    throw new RecallError("engine_start_failed", { cause: error });
  } finally {
    try {
      fs.closeSync(log);
    } catch {
      // The child holds its own duplicated descriptors.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopEngine(
  config: RecallConfig = getRecallConfig(),
): Promise<void> {
  const state = engineProcessState(config);
  if (!state.running || state.pid === null) {
    clearProcessState(config);
    throw new RecallError("engine_not_running");
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw new RecallError("engine_stop_failed", { cause: error });
    }
  }

  const deadline = Date.now() + config.shutdownGraceMs;
  while (Date.now() < deadline) {
    if (!processAlive(state.pid)) {
      clearProcessState(config);
      return;
    }
    await sleep(200);
  }
  // SIGTERM is advisory on Windows and the recorder can be mid-flush; a
  // deliberate hard kill after the grace window is better than a settings tab
  // that says "stopping" forever.
  try {
    process.kill(state.pid, "SIGKILL");
  } catch {
    // Gone between the check and the kill.
  }
  clearProcessState(config);
}

/** Tail of the engine log, for the settings tab's failure detail. */
export function readEngineLogTail(
  config: RecallConfig = getRecallConfig(),
  maxLines = 20,
): string[] {
  try {
    const raw = fs.readFileSync(recallEngineLogPath(config), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}
