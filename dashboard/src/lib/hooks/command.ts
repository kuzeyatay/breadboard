// Running a hook's shell command. Follows Codex's command hook handler
// (codex-rs/hooks/src/engine/command_runner.rs): the command is a fixed string
// the hook's owner wrote, the event arrives as JSON on stdin, and a timeout
// bounds the run. The event is never interpolated into the command line, so an
// outside party who can trigger a webhook chooses what the command reads, never
// what the shell executes.
//
// Unlike Codex, the command's output is recorded and nothing more: Breadboard's
// triggers fire after the fact, so a hook cannot block a tool or add context.

import { spawn, spawnSync } from "node:child_process";
import os from "node:os";

export const MAX_HOOK_COMMAND_LENGTH = 2_000;
export const DEFAULT_HOOK_COMMAND_TIMEOUT_MS = 60_000;
export const MAX_HOOK_COMMAND_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 2_000;

export interface HookCommandResult {
  /** Null when the command never produced an exit code (spawn failure, kill). */
  exitCode: number | null;
  timedOut: boolean;
  /** The tail of stdout and stderr, interleaved as they arrived. */
  output: string;
}

/** One line for the Hooks list: "Exit 0", "Exit 1: <last output>", "Timed out…". */
export function describeHookCommandResult(result: HookCommandResult): string {
  const tail = result.output.trim().split(/\r?\n/).pop()?.trim().slice(0, 200) ?? "";
  const status = result.timedOut
    ? "Timed out"
    : result.exitCode === null
      ? "Could not run"
      : `Exit ${result.exitCode}`;
  return tail && (result.timedOut || result.exitCode !== 0) ? `${status}: ${tail}` : status;
}

export function runHookCommand(
  command: string,
  payload: unknown,
  options: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<HookCommandResult> {
  const timeoutMs = Math.min(
    MAX_HOOK_COMMAND_TIMEOUT_MS,
    Math.max(1_000, options.timeoutMs ?? DEFAULT_HOOK_COMMAND_TIMEOUT_MS),
  );
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, output });
    };

    const child = spawn(command, {
      shell: true,
      cwd: os.homedir(),
      windowsHide: true,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT_CHARS);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      output = `${output}${error.message}`.slice(-MAX_OUTPUT_CHARS);
      finish(null);
    });
    child.on("close", (code) => finish(timedOut ? null : code));

    const timer = setTimeout(() => {
      timedOut = true;
      // The shell is the direct child; on Windows killing it alone leaves the
      // command it started running, so take the whole tree.
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    // A command that never reads stdin closes the pipe early; that is its
    // choice, not a failure of the hook.
    child.stdin.on("error", () => {});
    let json: string;
    try {
      json = JSON.stringify(payload) ?? "null";
    } catch {
      json = "null";
    }
    child.stdin.end(json);
  });
}
