// Development-only recovery for the browser dashboard.
//
// The desktop app owns Hermes through its supervisor. `npm run dev` and the
// older start.bat workflow do not have that control plane: if their separately
// launched Hermes process exits, a UI "Reconnect" request otherwise has no
// process to reconnect to. This bounded fallback launches the same checked-in
// development entry point those workflows use, then waits for the authenticated
// runtime probe supplied by the caller.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

const START_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 750;

interface Globals {
  __breadboardHermesDevelopmentStart?: Promise<boolean> | null;
}

const globals = globalThis as unknown as Globals;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeSafely(probe: () => Promise<boolean>): Promise<boolean> {
  try {
    return await probe();
  } catch {
    return false;
  }
}

async function startAndWait(probe: () => Promise<boolean>): Promise<boolean> {
  if (await probeSafely(probe)) return true;

  const root = repositoryRoot();
  const launcher = path.join(root, "scripts", "start-hermes.mjs");
  if (!fs.existsSync(launcher)) return false;

  const logPath = path.join(root, ".runtime", "hermes-reconnect.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const output = fs.openSync(logPath, "a");
  let child: ReturnType<typeof spawn>;
  let spawnFailed = false;
  try {
    child = spawn(process.execPath, [launcher], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, output],
      env: process.env,
    });
    child.once("error", () => {
      spawnFailed = true;
    });
    child.unref();
  } catch {
    return false;
  } finally {
    fs.closeSync(output);
  }

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeSafely(probe)) return true;
    if (spawnFailed || child.exitCode !== null) return false;
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Start the repo's Hermes runtime only when there is no desktop supervisor.
 * The global single-flight survives Next development module reloads and keeps
 * repeated status retries from racing two launchers for the same port.
 */
export async function ensureDevelopmentHermesRuntime(
  probe: () => Promise<boolean>,
): Promise<boolean> {
  if (process.env.NODE_ENV !== "development") return false;
  if (globals.__breadboardHermesDevelopmentStart) {
    return globals.__breadboardHermesDevelopmentStart;
  }

  const attempt = startAndWait(probe).finally(() => {
    globals.__breadboardHermesDevelopmentStart = null;
  });
  globals.__breadboardHermesDevelopmentStart = attempt;
  return attempt;
}
