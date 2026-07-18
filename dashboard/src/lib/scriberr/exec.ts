// Safe subprocess execution for external tools (yt-dlp, ffprobe, ffmpeg).
// Always argument arrays with `shell: false` — no command strings, no shell
// interpolation, no untrusted input concatenation. Output is size-capped and
// execution is bounded by a timeout.

import { spawn } from "child_process";

export class CommandNotFoundError extends Error {
  command: string;
  constructor(command: string) {
    super(`Command not found: ${command}`);
    this.name = "CommandNotFoundError";
    this.command = command;
  }
}

export interface RunCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export function runCommand(
  command: string,
  args: string[],
  {
    timeoutMs,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    cwd,
  }: { timeoutMs: number; maxOutputBytes?: number; cwd?: string },
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;

    const append = (current: Buffer, chunk: Buffer): Buffer => {
      if (current.length >= maxOutputBytes) return current;
      const next: Buffer = Buffer.concat([current, chunk]);
      return next.length > maxOutputBytes ? next.subarray(0, maxOutputBytes) : next;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate if the process ignores SIGTERM.
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5_000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(new CommandNotFoundError(command));
      } else {
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
      });
    });
  });
}

/** `tool --version` probe used by health checks. */
export async function probeCommandVersion(
  command: string,
  versionArgs: string[] = ["--version"],
  timeoutMs = 10_000,
): Promise<{ ok: boolean; version?: string; detail?: string }> {
  try {
    const result = await runCommand(command, versionArgs, { timeoutMs });
    if (result.timedOut) return { ok: false, detail: "timed out" };
    if (result.code !== 0) return { ok: false, detail: `exit code ${result.code}` };
    const firstLine = result.stdout.split(/\r?\n/, 1)[0]?.trim();
    return { ok: true, version: firstLine || undefined };
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      return { ok: false, detail: "not found" };
    }
    return { ok: false, detail: "failed to run" };
  }
}
