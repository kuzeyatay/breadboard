import { spawn } from "node:child_process";

/**
 * Windows-safe process-tree termination.
 *
 * `ChildProcess.kill()` only signals the direct child on Windows; Bun, Python
 * and npm wrappers leave descendants (workers, ffmpeg, yt-dlp) running. We
 * always terminate the whole tree with `taskkill /T`. On POSIX we signal the
 * process group.
 */
export function killProcessTree(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const args = ["/pid", String(pid), "/T"];
      if (force) args.push("/F");
      const killer = spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => resolve());
      killer.on("exit", () => resolve());
      return;
    }
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      try {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    resolve();
  });
}

/** True while the OS still knows the pid (zombie-safe best effort). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
