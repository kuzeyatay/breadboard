import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { killProcessTree } from "./process-tree";

function ownedWorkerPid(runtimeDir: string): number | null {
  const root = path.resolve(runtimeDir, "learn-workers");
  const markerPath = path.join(root, "learn-worker.active.json");
  if (path.dirname(markerPath) !== root) return null;
  try {
    const stat = fs.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      protocolVersion?: unknown;
      state?: unknown;
      pid?: unknown;
      nonce?: unknown;
    };
    return value.protocolVersion === 1 &&
      value.state === "running" &&
      typeof value.nonce === "string" &&
      value.nonce.length > 0 &&
      Number.isSafeInteger(value.pid) &&
      Number(value.pid) > 0
      ? Number(value.pid)
      : null;
  } catch {
    return null;
  }
}

/** Stop only the PID fenced by the exact durable Learn ownership marker. */
export async function stopDetachedLearnWorker(runtimeDir: string): Promise<number | null> {
  const pid = ownedWorkerPid(runtimeDir);
  if (pid === null) return null;
  await killProcessTree(pid, true);
  return pid;
}

/** Crash/exit fallback; the exact marker validation is identical to the async path. */
export function stopDetachedLearnWorkerNow(runtimeDir: string): number | null {
  const pid = ownedWorkerPid(runtimeDir);
  if (pid === null) return null;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
  return pid;
}
