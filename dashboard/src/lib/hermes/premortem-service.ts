import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  PremortemServiceError,
  validatePremortemArguments,
} from "./premortem-request.ts";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export { PremortemServiceError, validatePremortemArguments } from "./premortem-request.ts";

export interface PremortemEnvelope {
  schema_version?: unknown;
  ok?: unknown;
  command?: unknown;
  data?: unknown;
  error?: unknown;
  warnings?: unknown;
  next_actions?: unknown;
  [key: string]: unknown;
}

export interface PremortemRunResult {
  arguments: string[];
  exitCode: number | null;
  durationMs: number;
  envelope: PremortemEnvelope;
}

export interface PremortemRuntime {
  pythonExecutable: string;
  packageRoot: string | null;
}

function configuredValue(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? path.resolve(configured) : null;
}

export function resolvePremortemRuntime(
  env: NodeJS.ProcessEnv = process.env,
): PremortemRuntime | null {
  const packageRoot =
    configuredValue(env.BREADBOARD_PREMORTEM_ROOT) ??
    path.join(repositoryRoot(), "premortem");
  const configuredPython = configuredValue(env.BREADBOARD_PREMORTEM_PYTHON);
  const venvPython = path.join(
    packageRoot,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  const pythonExecutable = configuredPython ??
    (fs.existsSync(venvPython) ? venvPython : null);
  if (!pythonExecutable || !fs.existsSync(pythonExecutable)) return null;
  return {
    pythonExecutable,
    packageRoot: fs.existsSync(path.join(packageRoot, "premortem"))
      ? packageRoot
      : null,
  };
}

function childEnvironment(runtime: PremortemRuntime): NodeJS.ProcessEnv {
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
  const pythonPaths = [
    process.env.BREADBOARD_PREMORTEM_SITE_PACKAGES,
    runtime.packageRoot,
  ].filter((value): value is string => Boolean(value?.trim()));
  if (pythonPaths.length) env.PYTHONPATH = pythonPaths.join(path.delimiter);
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

function parseEnvelope(stdout: string): PremortemEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new PremortemServiceError(
      "premortem_invalid_response",
      "Premortem returned an invalid JSON response.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PremortemServiceError(
      "premortem_invalid_response",
      "Premortem returned an invalid response envelope.",
    );
  }
  return parsed as PremortemEnvelope;
}

export async function runPremortem(input: {
  arguments: unknown;
  workspaceDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runtime?: PremortemRuntime;
}): Promise<PremortemRunResult> {
  const args = validatePremortemArguments(input.arguments);
  const runtime = input.runtime ?? resolvePremortemRuntime();
  if (!runtime) {
    throw new PremortemServiceError(
      "premortem_runtime_unavailable",
      "The Premortem runtime is not prepared. Install the cloned repository into premortem/.venv.",
    );
  }
  const workspaceDirectory = path.resolve(input.workspaceDirectory);
  try {
    fs.mkdirSync(workspaceDirectory, { recursive: true });
  } catch {
    throw new PremortemServiceError(
      "premortem_workspace_unavailable",
      "Premortem could not prepare this conversation's workspace.",
    );
  }
  const started = Date.now();

  return await new Promise<PremortemRunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(
        runtime.pythonExecutable,
        ["-m", "premortem", ...args],
        {
          cwd: workspaceDirectory,
          env: childEnvironment(runtime),
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      reject(
        new PremortemServiceError(
          "premortem_launch_failed",
          "Premortem could not start.",
        ),
      );
      return;
    }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (
      error: Error | null,
      exitCode: number | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve({
          arguments: args,
          exitCode,
          durationMs: Date.now() - started,
          envelope: parseEnvelope(stdout.trim()),
        });
      } catch (parseError) {
        reject(
          stderr.trim()
            ? new PremortemServiceError(
                "premortem_invalid_response",
                "Premortem failed before returning a valid response.",
              )
            : parseError,
        );
      }
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        void terminate(child).finally(() =>
          finish(
            new PremortemServiceError(
              "premortem_output_too_large",
              "Premortem exceeded the response size limit.",
            ),
            child.exitCode,
          )
        );
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    const onAbort = () => {
      void terminate(child).finally(() =>
        finish(
          new PremortemServiceError(
            "premortem_cancelled",
            "Premortem was cancelled with the current chat turn.",
          ),
          child.exitCode,
        )
      );
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminate(child).finally(() =>
        finish(
          new PremortemServiceError(
            "premortem_timeout",
            "Premortem did not finish within the time limit.",
          ),
          child.exitCode,
        )
      );
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.once("error", () =>
      finish(
        new PremortemServiceError(
          "premortem_launch_failed",
          "Premortem could not start.",
        ),
        null,
      )
    );
    child.once("close", (code) => {
      if (timedOut || input.signal?.aborted) return;
      finish(null, code);
    });
    if (input.signal?.aborted) onAbort();
  });
}
