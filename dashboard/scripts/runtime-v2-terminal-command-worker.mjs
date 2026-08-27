import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const MAX_COMMAND_BYTES = 2_000;
const MAX_PATH_BYTES = 32 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MIN_RUNTIME_MS = 1_000;
const MAX_RUNTIME_MS = 3_600_000;
const CHECKPOINT_INTERVAL_MS = 250;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function validateTerminalCommandRequest(value) {
  if (
    !exactRecord(value, ["command", "workspaceRoot", "maxRuntimeMs"]) ||
    typeof value.command !== "string" ||
    !value.command.trim() ||
    value.command !== value.command.trim() ||
    Buffer.byteLength(value.command, "utf8") > MAX_COMMAND_BYTES ||
    /\u0000/u.test(value.command) ||
    typeof value.workspaceRoot !== "string" ||
    !path.isAbsolute(value.workspaceRoot) ||
    Buffer.byteLength(value.workspaceRoot, "utf8") > MAX_PATH_BYTES ||
    /[\u0000\r\n]/u.test(value.workspaceRoot) ||
    !Number.isSafeInteger(value.maxRuntimeMs) ||
    value.maxRuntimeMs < MIN_RUNTIME_MS ||
    value.maxRuntimeMs > MAX_RUNTIME_MS
  ) throw new Error("The canonical Terminal command request is invalid.");
  return value;
}

function directDirectory(directory) {
  const resolved = path.resolve(directory);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isDirectory()) {
    throw new Error("The authorized Terminal working directory is unavailable.");
  }
  return fs.realpathSync.native(resolved);
}

function systemRoot() {
  const value = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!value || !path.isAbsolute(value) || /[\u0000\r\n]/u.test(value)) {
    throw new Error("The Runtime-owned system environment is unavailable.");
  }
  return path.resolve(value);
}

export function resolveRuntimeTerminalShell() {
  if (process.platform !== "win32") return "/bin/sh";
  const shell = path.join(
    systemRoot(),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const metadata = fs.lstatSync(shell);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The Runtime-owned Terminal shell is unavailable.");
  }
  return fs.realpathSync.native(shell);
}

function sealedEnvironment() {
  const allowed = new Set([
    "APPDATA",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LOCALAPPDATA",
    "NODE",
    "NODE_ENV",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => allowed.has(name.toUpperCase()) && value !== undefined,
    ),
  );
}

async function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const taskkill = path.join(systemRoot(), "System32", "taskkill.exe");
    await new Promise((resolve) => {
      let killer;
      try {
        killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          env: sealedEnvironment(),
        });
      } catch {
        try { child.kill(); } catch {}
        resolve();
        return;
      }
      killer.once("error", () => {
        try { child.kill(); } catch {}
        resolve();
      });
      killer.once("close", resolve);
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch {}
  }
}

function appendBounded(current, chunk, state) {
  if (current.length >= MAX_OUTPUT_BYTES) {
    state.truncated = true;
    return current;
  }
  const remaining = MAX_OUTPUT_BYTES - current.length;
  if (chunk.length > remaining) state.truncated = true;
  return Buffer.concat([current, chunk.subarray(0, remaining)]);
}

function snapshot(launch, state, running) {
  return {
    command: launch.request.command,
    cwd: ".",
    exitCode: running ? null : state.exitCode,
    stdout: state.stdout.toString("utf8"),
    stderr: state.stderr.toString("utf8"),
    timedOut: state.timedOut,
    truncated: state.truncated,
    running,
    commandId: running ? launch.identity.jobId : null,
    elapsedMs: Math.max(0, Date.now() - state.startedAt),
    maxRuntimeMs: launch.request.maxRuntimeMs,
  };
}

export async function executeTerminalCommand(launch, signal, progress) {
  const request = validateTerminalCommandRequest(launch.request);
  const workspaceRoot = directDirectory(request.workspaceRoot);
  const executable = resolveRuntimeTerminalShell();
  const args = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", request.command]
    : ["-lc", request.command];
  const child = spawn(executable, args, {
    cwd: workspaceRoot,
    windowsHide: true,
    detached: process.platform !== "win32",
    env: sealedEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    startedAt: Date.now(),
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    timedOut: false,
    truncated: false,
    exitCode: null,
  };
  let lastCheckpointAt = 0;
  let checkpointFault = null;
  const publish = (force = false) => {
    if (checkpointFault) return;
    const now = Date.now();
    if (!force && now - lastCheckpointAt < CHECKPOINT_INTERVAL_MS) return;
    lastCheckpointAt = now;
    try {
      progress.checkpoint(snapshot(launch, state, true));
    } catch (error) {
      checkpointFault = error;
      void terminateProcessTree(child);
    }
  };
  publish(true);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      state.exitCode = exitCode;
      if (checkpointFault) {
        reject(checkpointFault);
        return;
      }
      resolve(snapshot(launch, state, false));
    };
    const onAbort = () => {
      void terminateProcessTree(child);
    };
    const timeout = setTimeout(() => {
      state.timedOut = true;
      void terminateProcessTree(child);
    }, request.maxRuntimeMs);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      state.stdout = appendBounded(state.stdout, chunk, state);
      publish();
    });
    child.stderr.on("data", (chunk) => {
      state.stderr = appendBounded(state.stderr, chunk, state);
      publish();
    });
    child.once("error", (error) => {
      state.stderr = appendBounded(
        state.stderr,
        Buffer.from(error instanceof Error ? error.message : String(error)),
        state,
      );
      finish(-1);
    });
    child.once("close", (exitCode) => finish(exitCode));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

const launchedAsEntry = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (launchedAsEntry) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-terminal-command-worker",
    validateRequest: validateTerminalCommandRequest,
    expectedInputCount: () => 0,
    execute: executeTerminalCommand,
  });
}
