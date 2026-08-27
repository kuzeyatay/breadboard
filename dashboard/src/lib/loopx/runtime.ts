// The contained bridge to the cloned LoopX control plane.
//
// LoopX (github.com/huangruiteng/loopx, cloned at <repo>/loopx) is a local
// control plane for long-running agent work: it keeps a goal's objective,
// gates, todos, evidence, and quota stable while some other runtime executes
// bounded turns. Breadboard runs it as the real CLI, never a reimplementation,
// because LoopX owns the state transitions.
//
// Two properties matter more than anything else here.
//
// Containment. Upstream LoopX writes a project's state next to the project and
// a shared registry under `~/.codex/loopx`. Breadboard never does either: every
// invocation passes `--registry`, `--runtime-root`, and `--project` inside a
// Breadboard-owned root, and every mutating command passes `--no-global-sync`,
// so a Hermes conversation cannot deposit control-plane state in the user's
// repository, Garden, or home directory. `loopxPaths()` is the only place those
// locations are decided.
//
// Latency. A LoopX command costs roughly 2.5 seconds off OneDrive and closer to
// ten on it, which is far too slow to sit in front of a turn. Nothing in this
// module is ever awaited on the read path: the CLI runs after a turn completes
// and writes a snapshot, and the read path reads that snapshot synchronously.
// See snapshot.ts.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { LoopxError, loopxText } from "./request.ts";
import {
  loopxEnabled,
  loopxPaths,
} from "./state.ts";

export { LoopxError, loopxText } from "./request.ts";
export {
  conversationGoalId,
  loopxEnabled,
  loopxGoalExists,
  loopxHome,
  loopxPaths,
  type LoopxPaths,
} from "./state.ts";

const MAX_ARGUMENT_LENGTH = 4_096;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Every LoopX command Breadboard is allowed to run. The list is deliberately
 * the read and tick surface only: nothing here installs, publishes, syncs to a
 * shared registry, projects into Lark, or launches another agent.
 */
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "bootstrap",
  "status",
  "quota",
  "todo",
  "refresh-state",
  "diagnose",
  "evidence-log",
  "version",
]);

export interface LoopxRuntime {
  pythonExecutable: string;
  packageRoot: string;
}

function configuredPath(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? path.resolve(configured) : null;
}

/**
 * LoopX declares no runtime dependencies outside the standard library, so any
 * Python 3.11+ on the machine can run it. Preferring an interpreter Breadboard
 * already ships avoids adding a new install step.
 */
export function resolveLoopxRuntime(
  env: NodeJS.ProcessEnv = process.env,
): LoopxRuntime | null {
  const packageRoot =
    configuredPath(env.BREADBOARD_LOOPX_ROOT) ??
    path.join(repositoryRoot(), "loopx");
  if (!fs.existsSync(path.join(packageRoot, "loopx", "entrypoint.py"))) {
    return null;
  }
  const binary = process.platform === "win32" ? "Scripts" : "bin";
  const executable = process.platform === "win32" ? "python.exe" : "python";
  const candidates = [
    configuredPath(env.BREADBOARD_LOOPX_PYTHON),
    path.join(repositoryRoot(), "hermes-agent", ".venv", binary, executable),
    path.join(repositoryRoot(), "chatmock", ".venv", binary, executable),
    path.join(packageRoot, ".venv", binary, executable),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { pythonExecutable: candidate, packageRoot };
    }
  }
  return null;
}

function childEnvironment(runtime: LoopxRuntime): NodeJS.ProcessEnv {
  const keys = process.platform === "win32"
    ? [
        "SystemRoot",
        "SystemDrive",
        "windir",
        "ComSpec",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "PATHEXT",
      ]
    : ["HOME", "USER", "TMPDIR", "LANG"];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const key of keys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUTF8 = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.PYTHONPATH = runtime.packageRoot;
  return env;
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export interface LoopxCommandResult {
  arguments: string[];
  exitCode: number | null;
  durationMs: number;
  payload: Record<string, unknown>;
}

/**
 * Runs one LoopX command against a conversation's contained state and returns
 * its JSON payload. The global `--registry` / `--runtime-root` options come
 * first because LoopX parses them before the subcommand.
 */
export async function runLoopx(input: {
  conversationPublicId: string;
  command: string[];
  timeoutMs?: number;
  runtime?: LoopxRuntime | null;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<LoopxCommandResult> {
  const env = input.env ?? process.env;
  if (!loopxEnabled(env)) {
    throw new LoopxError("loopx_disabled", "LoopX is disabled.");
  }
  const runtime = input.runtime ?? resolveLoopxRuntime(env);
  if (!runtime) {
    throw new LoopxError(
      "loopx_runtime_unavailable",
      "The LoopX clone or a Python 3.11+ interpreter is missing.",
    );
  }
  const command = input.command.map((value) => {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length > MAX_ARGUMENT_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new LoopxError(
        "loopx_invalid_arguments",
        "LoopX arguments must be non-empty, bounded, single-line strings.",
      );
    }
    return value;
  });
  if (!command.length || !ALLOWED_COMMANDS.has(command[0])) {
    throw new LoopxError(
      "loopx_command_denied",
      `LoopX command "${command[0] ?? ""}" is not available to Breadboard.`,
    );
  }

  const paths = loopxPaths(input.conversationPublicId, env);
  fs.mkdirSync(paths.project, { recursive: true });
  fs.mkdirSync(paths.runtimeRoot, { recursive: true });

  const args = [
    "-c",
    "import sys; from loopx.entrypoint import main; sys.exit(main())",
    "--registry",
    paths.registry,
    "--runtime-root",
    paths.runtimeRoot,
    "--format",
    "json",
    ...command,
  ];
  const started = Date.now();

  return await new Promise<LoopxCommandResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(runtime.pythonExecutable, args, {
        cwd: paths.project,
        env: childEnvironment(runtime),
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new LoopxError("loopx_launch_failed", "LoopX could not start."));
      return;
    }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let cancelled = false;

    const finish = (error: Error | null, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      let payload: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        reject(
          new LoopxError(
            "loopx_invalid_response",
            `LoopX returned no JSON payload (exit ${exitCode ?? "unknown"}): ${
              loopxText(stderr || stdout, 300) || "no output"
            }`,
          ),
        );
        return;
      }
      resolve({
        arguments: command,
        exitCode,
        durationMs: Date.now() - started,
        payload,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      void terminate(child);
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const onAbort = () => {
      cancelled = true;
      void terminate(child).finally(() =>
        finish(
          new LoopxError("loopx_cancelled", "LoopX was cancelled."),
          child.exitCode,
        )
      );
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    const capture = (chunk: Buffer, target: "out" | "err") => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        void terminate(child);
        finish(
          new LoopxError("loopx_output_too_large", "LoopX produced too much output."),
          null,
        );
        return;
      }
      if (target === "out") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };

    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, "err"));
    child.once("error", () =>
      finish(new LoopxError("loopx_launch_failed", "LoopX could not start."), null),
    );
    child.once("close", (code) => {
      if (cancelled) return;
      if (timedOut) {
        finish(
          new LoopxError("loopx_timeout", "LoopX did not finish in time."),
          code,
        );
        return;
      }
      finish(null, code);
    });
    if (input.signal?.aborted) onAbort();
  });
}
