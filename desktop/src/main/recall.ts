import * as fs from "node:fs";
import * as path from "node:path";

import type { ResolvedPaths } from "./path-resolver";

/**
 * Recall (the screen + audio capture engine) on the desktop.
 *
 * Unlike every other sidecar, this one is deliberately NOT a supervised service
 * definition. A supervised entry is built at launch, before anyone has signed
 * in, so it would start recording the screen on every app start regardless of
 * whether the signed-in user has opted in — and capture opt-in lives per user
 * in the dashboard's database, which the supervisor cannot read. Two owners of
 * one recorder is also how screenpipe's own CLI documents getting duplicate
 * recorder processes.
 *
 * So the dashboard owns the process: it installs the engine, starts it when the
 * user switches capture on, and writes its pid into the Recall home. The
 * desktop's remaining responsibility is the one the dashboard cannot discharge
 * — making sure a detached recorder never outlives Breadboard itself.
 */

/** Breadboard-owned home for the engine binary, its data, and its pid file. */
export function recallHome(paths: ResolvedPaths): string {
  return path.join(paths.dataRoot, "recall");
}

export function recallDataDir(paths: ResolvedPaths): string {
  return path.join(recallHome(paths), "data");
}

function processStatePath(home: string): string {
  return path.join(home, "engine.json");
}

function readPid(home: string): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(processStatePath(home), "utf8")) as {
      pid?: unknown;
    };
    return typeof raw.pid === "number" && Number.isFinite(raw.pid) && raw.pid > 0
      ? raw.pid
      : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Terminate a Breadboard-launched capture engine, if one is running. Safe to
 * call when Recall was never used: a missing pid file is the common case.
 * Returns true when a process was actually stopped.
 */
export async function stopRecallEngine(
  paths: ResolvedPaths,
  { graceMs = 8_000 }: { graceMs?: number } = {},
): Promise<boolean> {
  const home = recallHome(paths);
  const pid = readPid(home);
  if (pid === null || !alive(pid)) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) break;
    await sleep(200);
  }
  if (alive(pid)) {
    // A recorder that ignores SIGTERM must still not survive the app that
    // started it; capture continuing after quit is the failure that matters.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone between the check and the kill.
    }
  }
  try {
    fs.rmSync(processStatePath(home), { force: true });
  } catch {
    // A stale pid file is recovered from on the next read anyway.
  }
  return true;
}
