// Starting the vendored ComfyUI, and being honest when Breadboard cannot.
//
// The order this tries things in is the whole design:
//
//   1. Something already answers at the configured URL → use it, whatever it
//      is. A user who runs their own ComfyUI (with their own models, custom
//      nodes and launch flags) should never have a second one started behind
//      their back.
//   2. Otherwise, if the vendored clone has an environment built for it, start
//      that and wait for it to answer.
//   3. Otherwise, say what is missing. Setup is a separate, explicit action,
//      because it downloads gigabytes and nobody should discover that by
//      clicking "Generate".
//
// Server-only: it spawns processes and reads the filesystem.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
// The setup-status reader is shared with the local speech service; both engines
// write the same heartbeat-and-pid file for the same reason.
import { parseStartupStatus, type VoiceboxStartupStatus } from "../speech/startup-status.ts";
import { comfyUiPython, type ComfyUiConfig } from "./config.ts";
import { comfyUiReachable } from "./client.ts";

export type ComfyUiSetupStatus = VoiceboxStartupStatus;

/** A ComfyUI checkout is a checkout when it has the thing we would run. */
export function cloneInstalled(config: ComfyUiConfig): boolean {
  return fs.existsSync(path.join(config.cloneRoot, "main.py"));
}

/** The interpreter exists and the installer got all the way through. */
export function environmentReady(config: ComfyUiConfig): boolean {
  return (
    fs.existsSync(comfyUiPython(config)) &&
    fs.existsSync(path.join(config.envDir, ".breadboard-comfyui-ready"))
  );
}

export function readSetupStatus(config: ComfyUiConfig): ComfyUiSetupStatus | null {
  try {
    return parseStartupStatus(fs.readFileSync(config.statusFile, "utf8"));
  } catch {
    return null;
  }
}

function appendLog(config: ComfyUiConfig, line: string): void {
  try {
    fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
    fs.appendFileSync(config.logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // A log write is never worth failing a render over.
  }
}

interface Globals {
  __breadboardComfyUiStart?: Promise<boolean> | null;
  __breadboardComfyUiSetup?: number | null;
}

const globals = globalThis as unknown as Globals;

/**
 * Kick off the environment install, unless one is already running.
 *
 * Detached on purpose: this outlives the request that asked for it, and a
 * dashboard restart mid-download must not orphan a half-installed environment
 * with nothing reporting on it. The status file is the only channel back.
 */
export function beginSetup(config: ComfyUiConfig): { started: boolean; reason?: string } {
  if (!config.managed) {
    return { started: false, reason: "Breadboard is not allowed to manage this ComfyUI." };
  }
  if (!cloneInstalled(config)) {
    return { started: false, reason: `No ComfyUI checkout at ${config.cloneRoot}.` };
  }
  const status = readSetupStatus(config);
  if (status && !status.stalled && !["error", "installed", "ready", "stopped", "interrupted"].includes(status.phase)) {
    return { started: false, reason: "Setup is already running." };
  }

  const script = path.join(repositoryRoot(), "scripts", "setup-comfyui.mjs");
  if (!fs.existsSync(script)) {
    return { started: false, reason: "The ComfyUI setup script is missing from this install." };
  }

  try {
    fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
    const output = fs.openSync(config.logFile, "a");
    const child = spawn(process.execPath, [script], {
      cwd: repositoryRoot(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, output],
      env: {
        ...process.env,
        COMFYUI_ROOT: config.cloneRoot,
        COMFYUI_ENV_DIR: config.envDir,
        COMFYUI_STATUS_PATH: config.statusFile,
      },
    });
    child.unref();
    globals.__breadboardComfyUiSetup = child.pid ?? null;
    return { started: true };
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : "The setup process could not be started.",
    };
  }
}

async function waitForServer(config: ComfyUiConfig): Promise<boolean> {
  const deadline = Date.now() + config.startTimeoutMs;
  while (Date.now() < deadline) {
    if (await comfyUiReachable(config.baseUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

function launch(config: ComfyUiConfig): void {
  const output = fs.openSync(config.logFile, "a");
  const child = spawn(
    comfyUiPython(config),
    [
      "-s",
      "main.py",
      "--port",
      String(config.port),
      "--listen",
      "127.0.0.1",
      // Breadboard is the only client here; a browser tab opening itself on a
      // background render would be a genuine surprise.
      "--disable-auto-launch",
      "--dont-print-server",
    ],
    {
      cwd: config.cloneRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, output],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    },
  );
  child.unref();
  appendLog(config, `[breadboard] started ComfyUI (pid ${child.pid ?? "unknown"})`);
}

/**
 * Make sure a ComfyUI is answering, starting the vendored one if that is the
 * only way and it is allowed.
 *
 * The in-flight promise is kept on a global because two studios asking at once
 * is normal, and two ComfyUI servers fighting over one port is not.
 */
export async function ensureComfyUiRunning(config: ComfyUiConfig): Promise<boolean> {
  if (await comfyUiReachable(config.baseUrl)) return true;
  if (!config.managed || !cloneInstalled(config) || !environmentReady(config)) return false;
  if (globals.__breadboardComfyUiStart) return globals.__breadboardComfyUiStart;

  const attempt = (async () => {
    try {
      fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
      launch(config);
      return await waitForServer(config);
    } catch (error) {
      appendLog(
        config,
        `[breadboard] could not start ComfyUI: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    } finally {
      globals.__breadboardComfyUiStart = null;
    }
  })();

  globals.__breadboardComfyUiStart = attempt;
  return attempt;
}
