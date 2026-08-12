// oh-my-hermes (OMH) as a bounded, read-only advisory surface.
//
// Upstream's own install path — `omh setup` writing `~/.omh/skills` and adding
// that directory to `~/.hermes/config.yaml`'s `skills.external_dirs` — does not
// apply here: Breadboard regenerates HERMES_HOME/config.yaml on every launch
// (scripts/start-hermes.mjs) and gates skills through its own review store, so
// a home-directory install would be silently overwritten and never reviewed.
//
// What is integrated instead is the part that cannot be expressed as a skill
// file: OMH's deterministic local router and its catalogs. Core `omh` makes no
// LLM, API, or network calls, so the whole surface below is local computation
// over the clone's own data. Every command that mutates an install, spawns an
// executor CLI (`omh coding fanout dispatch`), or writes outside the session is
// absent from the allowlist rather than flag-guarded.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

const MAX_ARGUMENTS = 24;
const MAX_ARGUMENT_LENGTH = 8_192;
const MAX_ARGUMENT_BYTES = 32 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Read-only OMH commands. `null` means the command takes no subcommand; a set
 * means the first positional after it must be one of those members.
 *
 * Deliberately absent: setup / install / update / apply / convert / uninstall
 * (they mutate an install), coding (`fanout dispatch` spawns local agent CLIs
 * that make their own network calls), memory / goal / loop / state / runtime /
 * worktree (they write durable OMH records), plugin / release / menubar / mcp /
 * ecosystem (host-level operations Breadboard owns itself).
 */
const ALLOWED_COMMANDS: Readonly<Record<string, ReadonlySet<string> | null>> = {
  chat: new Set(["route", "route-hint", "interact"]),
  recommend: null,
  quickstart: null,
  doctor: null,
  probe: null,
  list: null,
  snippet: null,
  harness: new Set(["list", "inspect", "validate"]),
  cases: new Set(["list", "inspect", "recommend", "readiness", "validate"]),
  profile: new Set(["list", "inspect"]),
  playbook: new Set(["list", "inspect", "recommend"]),
  docs: new Set(["workflows", "roles", "capability-families", "skill-context-cost"]),
  "skill-profile": new Set(["status"]),
  "capability-policy": new Set(["status"]),
};

/**
 * `--omh-home` / `--hermes-home` are pinned by this service to the session's
 * own workspace; letting the model pass them would aim OMH's local store at the
 * operator's real home. The rest either write files (`--output`), turn a check
 * into a mutation (`--apply`, `--reconcile`), or opt into upstream's live
 * install smoke, which shells out to a real `hermes` CLI.
 */
const DENIED_FLAGS = new Set([
  "--omh-home",
  "--hermes-home",
  "--scope",
  "--output",
  "-o",
  "--write",
  "--apply",
  "--reconcile",
  "--force",
  "--yes",
  "--live",
  "--install-path",
  "--target-confirmed",
]);

export interface OmhRunResult {
  arguments: string[];
  exitCode: number | null;
  durationMs: number;
  /** Raw stdout: OMH's own text card, or its JSON payload when `--json` was passed. */
  output: string;
  /** Parsed payload when the command was asked for `--json` and produced one. */
  payload: unknown;
}

export interface OmhRuntime {
  pythonExecutable: string;
  packageRoot: string;
}

export class OmhServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OmhServiceError";
    this.code = code;
  }
}

function configuredValue(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? path.resolve(configured) : null;
}

function venvPython(root: string): string {
  return path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
}

/**
 * OMH declares zero runtime dependencies, so any Python 3.11+ runs it. The
 * clone's own venv is preferred when present; otherwise the Hermes checkout's
 * interpreter is reused rather than requiring a second environment.
 */
export function resolveOmhRuntime(
  env: NodeJS.ProcessEnv = process.env,
): OmhRuntime | null {
  const clone = configuredValue(env.BREADBOARD_OMH_ROOT) ??
    path.join(repositoryRoot(), "oh-my-hermes");
  const packageRoot = path.join(clone, "src");
  if (!fs.existsSync(path.join(packageRoot, "omh", "cli"))) return null;
  const candidates = [
    configuredValue(env.BREADBOARD_OMH_PYTHON),
    venvPython(clone),
    configuredValue(env.HERMES_PYTHON),
    venvPython(path.join(repositoryRoot(), "hermes-agent")),
  ];
  const pythonExecutable = candidates.find(
    (candidate): candidate is string => Boolean(candidate) && fs.existsSync(candidate!),
  );
  if (!pythonExecutable) return null;
  return { pythonExecutable, packageRoot };
}

/**
 * Arguments become argv for a spawned process, so anything below U+0020 (and
 * DEL) is rejected outright — that covers newlines, so every argument is also
 * guaranteed single-line.
 */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateOmhArguments(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ARGUMENTS) {
    throw new OmhServiceError(
      "omh_invalid_arguments",
      `OMH requires between 1 and ${MAX_ARGUMENTS} command arguments.`,
    );
  }
  const args = input.map((value) => {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_ARGUMENT_LENGTH ||
      hasControlCharacters(value)
    ) {
      throw new OmhServiceError(
        "omh_invalid_arguments",
        "OMH arguments must be non-empty, bounded, single-line strings.",
      );
    }
    return value;
  });
  const totalBytes = args.reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0);
  if (totalBytes > MAX_ARGUMENT_BYTES) {
    throw new OmhServiceError(
      "omh_invalid_arguments",
      "OMH command arguments exceed the size limit.",
    );
  }

  const subcommands = ALLOWED_COMMANDS[args[0]];
  if (subcommands === undefined) {
    throw new OmhServiceError(
      "omh_command_denied",
      "That OMH command is not available in Breadboard. Only read-only routing, recommendation, catalog and health commands are offered.",
    );
  }
  if (subcommands && (args.length < 2 || !subcommands.has(args[1]))) {
    throw new OmhServiceError(
      "omh_command_denied",
      "That OMH subcommand is not available in Breadboard.",
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
    throw new OmhServiceError(
      "omh_flag_denied",
      `${deniedFlag} is not available through Breadboard's oh-my-hermes skill.`,
    );
  }
  return args;
}

function childEnvironment(runtime: OmhRuntime): NodeJS.ProcessEnv {
  const keys = process.platform === "win32"
    ? [
        "SystemRoot",
        "SystemDrive",
        "windir",
        "ComSpec",
        "TEMP",
        "TMP",
        "PATHEXT",
      ]
    : ["TMPDIR", "LANG"];
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
  // Upstream localizes only on explicit opt-in; keep the default English so the
  // card text matches the rest of the conversation.
  env.OMH_LANG = "en";
  return env;
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
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

/**
 * OMH exits non-zero to report a finding — `doctor` returns 1 when a check is
 * blocking — so a non-zero code is a result, not a failure. Only an empty
 * response is treated as one.
 */
function parseOutput(stdout: string): { output: string; payload: unknown } {
  const output = stdout.trim();
  if (!output) {
    throw new OmhServiceError(
      "omh_empty_response",
      "OMH returned no output for that command.",
    );
  }
  let payload: unknown = null;
  if (output.startsWith("{") || output.startsWith("[")) {
    try {
      payload = JSON.parse(output);
    } catch {
      payload = null;
    }
  }
  return { output, payload };
}

export async function runOmh(input: {
  arguments: unknown;
  workspaceDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runtime?: OmhRuntime;
}): Promise<OmhRunResult> {
  const args = validateOmhArguments(input.arguments);
  const runtime = input.runtime ?? resolveOmhRuntime();
  if (!runtime) {
    throw new OmhServiceError(
      "omh_runtime_unavailable",
      "The oh-my-hermes runtime is not prepared. Clone rlaope/oh-my-hermes into oh-my-hermes/ and make a Python 3.11+ interpreter available.",
    );
  }
  const workspaceDirectory = path.resolve(input.workspaceDirectory);
  // OMH's local store, runtime records and any Hermes-profile probing are all
  // redirected into this conversation's own workspace, so a routing call can
  // never read or write the operator's real ~/.omh or ~/.hermes.
  const omhHome = path.join(workspaceDirectory, ".omh");
  const hermesHome = path.join(workspaceDirectory, ".omh-hermes");
  try {
    fs.mkdirSync(omhHome, { recursive: true });
    fs.mkdirSync(hermesHome, { recursive: true });
  } catch {
    throw new OmhServiceError(
      "omh_workspace_unavailable",
      "OMH could not prepare this conversation's workspace.",
    );
  }
  const argv = [
    "-m",
    "omh.cli",
    "--omh-home",
    omhHome,
    "--hermes-home",
    hermesHome,
    ...args,
  ];
  const started = Date.now();

  return await new Promise<OmhRunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(runtime.pythonExecutable, argv, {
        cwd: workspaceDirectory,
        env: childEnvironment(runtime),
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new OmhServiceError("omh_launch_failed", "OMH could not start."));
      return;
    }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (error: Error | null, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      try {
        const { output, payload } = parseOutput(stdout);
        resolve({
          arguments: args,
          exitCode,
          durationMs: Date.now() - started,
          output,
          payload,
        });
      } catch (parseError) {
        reject(
          stderr.trim()
            ? new OmhServiceError(
                "omh_command_failed",
                `OMH failed before returning a result: ${stderr.trim().slice(0, 400)}`,
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
            new OmhServiceError(
              "omh_output_too_large",
              "OMH exceeded the response size limit. Ask for a narrower command or drop --json.",
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
          new OmhServiceError("omh_cancelled", "OMH was cancelled with the current chat turn."),
          child.exitCode,
        )
      );
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminate(child).finally(() =>
        finish(
          new OmhServiceError("omh_timeout", "OMH did not finish within the time limit."),
          child.exitCode,
        )
      );
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.once("error", () =>
      finish(new OmhServiceError("omh_launch_failed", "OMH could not start."), null)
    );
    child.once("close", (code) => {
      if (timedOut || input.signal?.aborted) return;
      finish(null, code);
    });
    if (input.signal?.aborted) onAbort();
  });
}
