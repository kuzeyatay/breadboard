import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

const MAX_ARGUMENTS = 40;
const MAX_ARGUMENT_LENGTH = 8_192;
const MAX_ARGUMENT_BYTES = 32 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const ALLOWED_COMMANDS: Readonly<Record<string, ReadonlySet<string> | null>> = {
  "agent-start": null,
  "agent-end": null,
  status: null,
  init: null,
  project: new Set(["update"]),
  persona: new Set(["add", "list", "show", "edit", "rename"]),
  reason: new Set(["add", "list", "show", "edit"]),
  graph: new Set(["add-node", "add-edge", "list", "show", "export"]),
  score: new Set(["set", "list", "show"]),
  mitigate: new Set(["add", "list", "show", "edit"]),
  workflow: new Set([
    "validate",
    "checklist",
    "guide",
    "phase",
    "next",
    "artifacts",
  ]),
  report: new Set(["context", "generate", "html"]),
};

const DENIED_FLAGS = new Set([
  "--force",
  "--confirm",
  "--project-dir",
  "--output",
  "-o",
  "--from",
  "--human",
  "--quiet",
  "--replace",
]);

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

export class PremortemServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PremortemServiceError";
    this.code = code;
  }
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

export function validatePremortemArguments(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > MAX_ARGUMENTS
  ) {
    throw new PremortemServiceError(
      "premortem_invalid_arguments",
      `Premortem requires between 1 and ${MAX_ARGUMENTS} command arguments.`,
    );
  }
  const args = input.map((value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_ARGUMENT_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      /[\r\n]/.test(value)
    ) {
      throw new PremortemServiceError(
        "premortem_invalid_arguments",
        "Premortem arguments must be non-empty, bounded, single-line strings.",
      );
    }
    return value;
  });
  if (Buffer.byteLength(args.join("\u0000"), "utf8") > MAX_ARGUMENT_BYTES) {
    throw new PremortemServiceError(
      "premortem_invalid_arguments",
      "Premortem command arguments exceed the size limit.",
    );
  }

  const subcommands = ALLOWED_COMMANDS[args[0]];
  if (subcommands === undefined) {
    throw new PremortemServiceError(
      "premortem_command_denied",
      "That Premortem command is not available in Breadboard.",
    );
  }
  if (subcommands && (args.length < 2 || !subcommands.has(args[1]))) {
    throw new PremortemServiceError(
      "premortem_command_denied",
      "That Premortem subcommand is not available in Breadboard.",
    );
  }
  const deniedFlag = args.find((value) =>
    [...DENIED_FLAGS].some((flag) =>
      value === flag ||
      (flag.startsWith("--") && value.startsWith(`${flag}=`)) ||
      (flag === "-o" && value.startsWith("-o="))
    )
  );
  if (deniedFlag) {
    throw new PremortemServiceError(
      "premortem_flag_denied",
      `${deniedFlag} is not available through Breadboard's Premortem skill.`,
    );
  }
  return args;
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
  if (runtime.packageRoot) env.PYTHONPATH = runtime.packageRoot;
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
