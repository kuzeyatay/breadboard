// Start the desktop app outside the launching terminal's process tree.
//
// Task Manager files a process under the app whose tree it belongs to, so a
// dev run started from a terminal showed all ~70 Breadboard processes inside
// "Windows Terminal". A short-lived PowerShell starts the app and exits, which
// leaves Breadboard as its own top-level app, the way an installed app started
// from the Start menu is. It also outlives a closed terminal, which used to
// kill dev runs silently; Ctrl+C still stops it (dev.mjs kills the pid).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Quote one argument the way CommandLineToArgvW reads it back. */
export function quoteWindowsArgument(value) {
  if (value !== "" && !/[\s"]/.test(value)) return value;
  let quoted = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") { slashes += 1; continue; }
    if (char === '"') { quoted += "\\".repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    quoted += "\\".repeat(slashes) + char;
    slashes = 0;
  }
  return quoted + "\\".repeat(slashes * 2) + '"';
}

const START = "$p = Start-Process -FilePath $env:BREADBOARD_LAUNCH_EXE -ArgumentList $env:BREADBOARD_LAUNCH_ARGS " +
  "-WorkingDirectory $env:BREADBOARD_LAUNCH_CWD -NoNewWindow -PassThru; " +
  "[IO.File]::WriteAllText($env:BREADBOARD_LAUNCH_PID_FILE, [string]$p.Id)";
// Holding the handle before the exit is what makes ExitCode readable.
const WAIT = "$p = Get-Process -Id ([int]$env:BREADBOARD_LAUNCH_PID) -ErrorAction Stop; $null = $p.Handle; " +
  "$p.WaitForExit(); exit $p.ExitCode";

function powershell(script, env) {
  return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true, shell: false,
  });
}

function exitOf(child) {
  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Start `executable` outside this process tree. Resolves `{ pid, exited }`,
 * where `exited` resolves to its exit code; null when the start itself failed.
 */
export async function launchOutsideTree(executable, args, { cwd, env }) {
  const pidFile = path.join(os.tmpdir(), `breadboard-launch-${process.pid}-${Date.now()}.pid`);
  const launchEnv = {
    ...env,
    BREADBOARD_LAUNCH_EXE: executable,
    BREADBOARD_LAUNCH_ARGS: args.map(quoteWindowsArgument).join(" "),
    BREADBOARD_LAUNCH_CWD: cwd,
    BREADBOARD_LAUNCH_PID_FILE: pidFile,
  };
  try {
    if (await exitOf(powershell(START, launchEnv)) !== 0) return null;
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const waiter = powershell(WAIT, { ...process.env, BREADBOARD_LAUNCH_PID: String(pid) });
    return { pid, exited: exitOf(waiter) };
  } catch {
    return null;
  } finally {
    fs.rmSync(pidFile, { force: true });
  }
}
