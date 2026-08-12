// Bounded runner for the cloned Agent Loop Engineering Kit
// (https://github.com/AlekseiUL/agent-loop-engineering-kit).
//
// The kit is a design/validation/dry-run toolkit: it never executes an agent
// task and never creates a cron, webhook or Kanban job. Breadboard keeps it
// that way by construction — only the contract subcommands are reachable, and
// every path argument is resolved inside the conversation's own workspace, so
// a model cannot point `validate` or `privacy-scan` at the user's home
// directory and read the output back into chat.
//
// `smoke` is deliberately unreachable: upstream implements it by shelling out
// to `bash scripts/smoke.sh` and `pytest` in the current directory.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

const MAX_ARGUMENTS = 12;
const MAX_ARGUMENT_LENGTH = 512;
const MAX_PATH_ARGUMENTS = 6;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Per-subcommand contract. `paths` bounds how many workspace-relative path
 * arguments the command accepts; `flags` is the exact set of switches the
 * upstream parser understands for it.
 */
interface CommandContract {
  paths: { min: number; max: number };
  booleanFlags?: readonly string[];
  /** Flag -> value kind. Path values are contained like positional paths. */
  valueFlags?: Readonly<Record<string, "path" | "score">>;
  requiredFlags?: readonly string[];
}

const ALLOWED_COMMANDS: Readonly<Record<string, CommandContract>> = {
  init: { paths: { min: 1, max: 1 }, booleanFlags: ["--force"] },
  validate: { paths: { min: 1, max: MAX_PATH_ARGUMENTS }, booleanFlags: ["--json"] },
  score: { paths: { min: 1, max: MAX_PATH_ARGUMENTS }, booleanFlags: ["--json"] },
  evaluate: { paths: { min: 1, max: MAX_PATH_ARGUMENTS }, booleanFlags: ["--json"] },
  "dry-run": {
    paths: { min: 1, max: 1 },
    booleanFlags: ["--json"],
    valueFlags: { "--out": "path", "--min-score": "score" },
    requiredFlags: ["--out"],
  },
  "render-receipt": { paths: { min: 1, max: 1 } },
  "privacy-scan": { paths: { min: 0, max: 1 }, booleanFlags: ["--json"] },
};

export const AGENT_LOOP_COMMANDS = Object.freeze(Object.keys(ALLOWED_COMMANDS));

export interface AgentLoopRunResult {
  arguments: string[];
  command: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface AgentLoopRuntime {
  pythonExecutable: string;
  packageRoot: string;
}

export class AgentLoopServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentLoopServiceError";
    this.code = code;
  }
}

function configuredValue(value: string | undefined): string | null {
  const configured = value?.trim();
  return configured ? path.resolve(configured) : null;
}

export function resolveAgentLoopRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AgentLoopRuntime | null {
  const packageRoot =
    configuredValue(env.BREADBOARD_AGENT_LOOP_ROOT) ??
    path.join(repositoryRoot(), "agent-loop-engineering-kit");
  if (!fs.existsSync(path.join(packageRoot, "hermes_loop", "cli.py"))) return null;
  const configuredPython = configuredValue(env.BREADBOARD_AGENT_LOOP_PYTHON);
  const venvPython = path.join(
    packageRoot,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  const pythonExecutable =
    configuredPython ?? (fs.existsSync(venvPython) ? venvPython : null);
  if (!pythonExecutable || !fs.existsSync(pythonExecutable)) return null;
  return { pythonExecutable, packageRoot };
}

function assertPlainArgument(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_ARGUMENT_LENGTH ||
    value.split("").some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)
  ) {
    throw new AgentLoopServiceError(
      "agent_loop_invalid_arguments",
      "Loop kit arguments must be non-empty, bounded, single-line strings.",
    );
  }
  return value;
}

/**
 * Resolve a path argument inside the workspace, rejecting absolute paths,
 * drive letters, UNC prefixes, traversal, and symlinked escapes. The returned
 * value is relative so the child process only ever sees workspace-local paths.
 */
export function containedWorkspacePath(
  workspaceDirectory: string,
  value: string,
): string {
  const candidate = value.replace(/\\/g, "/").trim();
  if (
    !candidate ||
    candidate.startsWith("/") ||
    candidate.startsWith("~") ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.split("/").some((segment) => segment === "..")
  ) {
    throw new AgentLoopServiceError(
      "agent_loop_path_denied",
      `Loop kit paths must stay inside this conversation's workspace: ${value}`,
    );
  }
  const root = path.resolve(workspaceDirectory);
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AgentLoopServiceError(
      "agent_loop_path_denied",
      `Loop kit paths must stay inside this conversation's workspace: ${value}`,
    );
  }
  // A symlink planted at any existing ancestor would otherwise let a contained
  // relative path resolve outside the workspace once the child process opens it.
  let existing = resolved;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    existing = path.dirname(existing);
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realExisting = fs.realpathSync(existing);
    const realRelative = path.relative(realRoot, realExisting);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new AgentLoopServiceError(
        "agent_loop_path_denied",
        `Loop kit paths must stay inside this conversation's workspace: ${value}`,
      );
    }
  } catch (error) {
    if (error instanceof AgentLoopServiceError) throw error;
    throw new AgentLoopServiceError(
      "agent_loop_path_denied",
      "Loop kit could not verify that the path stays inside the workspace.",
    );
  }
  // The workspace root itself is contained, not an escape: `privacy-scan .`
  // is the natural way to scan everything this conversation produced.
  return relative ? relative.replace(/\\/g, "/") : ".";
}

/**
 * Validate the model-supplied argv against the subcommand contract and rewrite
 * every path into a workspace-relative form.
 */
export function validateAgentLoopArguments(
  input: unknown,
  workspaceDirectory: string,
): { command: string; args: string[] } {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ARGUMENTS) {
    throw new AgentLoopServiceError(
      "agent_loop_invalid_arguments",
      `The loop kit accepts between 1 and ${MAX_ARGUMENTS} arguments.`,
    );
  }
  const raw = input.map(assertPlainArgument);
  const command = raw[0];
  const contract = ALLOWED_COMMANDS[command];
  if (!contract) {
    throw new AgentLoopServiceError(
      "agent_loop_command_denied",
      `"${command}" is not available. Use one of: ${AGENT_LOOP_COMMANDS.join(", ")}.`,
    );
  }

  const args: string[] = [command];
  const seenFlags = new Set<string>();
  const paths: string[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const token = raw[index];
    if (!token.startsWith("-")) {
      paths.push(containedWorkspacePath(workspaceDirectory, token));
      continue;
    }
    // `--flag=value` is normalized so one code path validates every value.
    const separator = token.indexOf("=");
    const name = separator > 0 ? token.slice(0, separator) : token;
    const inlineValue = separator > 0 ? token.slice(separator + 1) : null;
    if (contract.booleanFlags?.includes(name)) {
      if (inlineValue !== null) {
        throw new AgentLoopServiceError(
          "agent_loop_flag_denied",
          `${name} does not take a value.`,
        );
      }
      if (!seenFlags.has(name)) {
        seenFlags.add(name);
        args.push(name);
      }
      continue;
    }
    const valueKind = contract.valueFlags?.[name];
    if (!valueKind) {
      throw new AgentLoopServiceError(
        "agent_loop_flag_denied",
        `${name} is not available through Breadboard's loop kit tool.`,
      );
    }
    if (seenFlags.has(name)) {
      throw new AgentLoopServiceError(
        "agent_loop_flag_denied",
        `${name} was supplied more than once.`,
      );
    }
    const value = inlineValue ?? raw[index + 1];
    if (inlineValue === null) index += 1;
    if (typeof value !== "string" || !value.trim()) {
      throw new AgentLoopServiceError(
        "agent_loop_flag_denied",
        `${name} requires a value.`,
      );
    }
    seenFlags.add(name);
    if (valueKind === "score") {
      if (!/^\d{1,3}$/.test(value) || Number(value) > 100) {
        throw new AgentLoopServiceError(
          "agent_loop_flag_denied",
          "--min-score must be an integer between 0 and 100.",
        );
      }
      args.push(name, value);
      continue;
    }
    args.push(name, containedWorkspacePath(workspaceDirectory, value));
  }

  for (const required of contract.requiredFlags ?? []) {
    if (!seenFlags.has(required)) {
      throw new AgentLoopServiceError(
        "agent_loop_invalid_arguments",
        `${command} requires ${required}.`,
      );
    }
  }
  if (paths.length < contract.paths.min || paths.length > contract.paths.max) {
    throw new AgentLoopServiceError(
      "agent_loop_invalid_arguments",
      contract.paths.max === contract.paths.min
        ? `${command} takes exactly ${contract.paths.min} workspace path(s).`
        : `${command} takes between ${contract.paths.min} and ${contract.paths.max} workspace paths.`,
    );
  }
  // Positionals go last so a value that starts with `-` can never be parsed as
  // a switch by argparse.
  return { command, args: [...args, ...paths] };
}

function childEnvironment(runtime: AgentLoopRuntime): NodeJS.ProcessEnv {
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

export async function runAgentLoopKit(input: {
  arguments: unknown;
  workspaceDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runtime?: AgentLoopRuntime;
}): Promise<AgentLoopRunResult> {
  const workspaceDirectory = path.resolve(input.workspaceDirectory);
  try {
    fs.mkdirSync(workspaceDirectory, { recursive: true });
  } catch {
    throw new AgentLoopServiceError(
      "agent_loop_workspace_unavailable",
      "The loop kit could not prepare this conversation's workspace.",
    );
  }
  const { command, args } = validateAgentLoopArguments(
    input.arguments,
    workspaceDirectory,
  );
  const runtime = input.runtime ?? resolveAgentLoopRuntime();
  if (!runtime) {
    throw new AgentLoopServiceError(
      "agent_loop_runtime_unavailable",
      "The Agent Loop Engineering Kit runtime is not prepared. Install the cloned repository into agent-loop-engineering-kit/.venv.",
    );
  }
  const started = Date.now();

  return await new Promise<AgentLoopRunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(
        runtime.pythonExecutable,
        ["-m", "hermes_loop.cli", ...args],
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
        new AgentLoopServiceError(
          "agent_loop_launch_failed",
          "The loop kit could not start.",
        ),
      );
      return;
    }
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let truncated = false;
    let settled = false;
    let stopped = false;

    const finish = (error: Error | null, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        arguments: args,
        command,
        exitCode,
        durationMs: Date.now() - started,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        truncated,
      });
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (outputBytes >= MAX_OUTPUT_BYTES) return;
      outputBytes += chunk.byteLength;
      const text = chunk.toString("utf8");
      if (outputBytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        void terminate(child);
      }
      if (target === "stdout") stdout += text;
      else stderr += text;
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    const onAbort = () => {
      stopped = true;
      void terminate(child).finally(() =>
        finish(
          new AgentLoopServiceError(
            "agent_loop_cancelled",
            "The loop kit was cancelled with the current chat turn.",
          ),
          child.exitCode,
        )
      );
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      stopped = true;
      void terminate(child).finally(() =>
        finish(
          new AgentLoopServiceError(
            "agent_loop_timeout",
            "The loop kit did not finish within the time limit.",
          ),
          child.exitCode,
        )
      );
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.once("error", () =>
      finish(
        new AgentLoopServiceError(
          "agent_loop_launch_failed",
          "The loop kit could not start.",
        ),
        null,
      )
    );
    child.once("close", (code) => {
      if (stopped) return;
      finish(null, code);
    });
    if (input.signal?.aborted) onAbort();
  });
}
