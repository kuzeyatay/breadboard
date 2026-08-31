import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";
import { repositoryRoot } from "../runtime-paths.ts";

export interface PraxistRuntime {
  root: string;
  command: string;
  baseArgs: string[];
}

export interface PraxistReadiness {
  available: boolean;
  cloned: boolean;
  runtime: PraxistRuntime | null;
  agreementAccepted: boolean;
  codexInstalled: boolean;
  reason?: string;
  setupCommand: string;
}

const CLI_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 512 * 1024;
const MAX_STDERR_BYTES = 128 * 1024;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function directPath(candidate: string, kind: "file" | "directory"): string | null {
  const resolved = path.resolve(candidate);
  try {
    const metadata = externalRuntimeLstat(resolved);
    if (
      metadata.isSymbolicLink() ||
      (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
      !samePath(externalRuntimeRealpath(resolved), resolved)
    ) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function resolvePraxistRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [configured(env.PRAXIST_ROOT), path.join(repositoryRoot(), "PRAXIST")]
    .filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (
      directPath(candidate, "directory") &&
      directPath(path.join(candidate, "pyproject.toml"), "file") &&
      directPath(path.join(candidate, "praxist", "__init__.py"), "file")
    ) return path.resolve(candidate);
  }
  return null;
}

export function resolvePraxistRuntime(env: NodeJS.ProcessEnv = process.env): PraxistRuntime | null {
  const root = resolvePraxistRoot(env);
  if (!root) return null;
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!directPath(python, "file")) return null;
  return { root, command: python, baseArgs: ["-m", "praxist"] };
}

export function praxistEnv(
  runtime: PraxistRuntime,
  additions: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const configHome = configured(additions.PRAXIST_CONFIG_HOME ?? process.env.PRAXIST_CONFIG_HOME)
    ?? path.join(os.homedir(), ".config");
  return {
    ...process.env,
    ...additions,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PRAXIST_ROOT: runtime.root,
    // The operator accepts the agreement outside the disposable Runtime job.
    // Reuse that one legal record; never synthesize or copy an acceptance.
    XDG_CONFIG_HOME: configHome,
  };
}

function parseJsonObject(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const value = JSON.parse(stdout.slice(start)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function runtimeReadiness(env: NodeJS.ProcessEnv = process.env): PraxistReadiness {
  const root = resolvePraxistRoot(env);
  const setupCommand = root
    ? `cd "${root}" && uv sync --extra codex && uv run praxist user-agreement accept`
    : "Clone PRAXIST into the Breadboard repository, then run its setup.";
  if (!root) {
    return {
      available: false,
      cloned: false,
      runtime: null,
      agreementAccepted: false,
      codexInstalled: false,
      reason: "The PRAXIST source clone is unavailable.",
      setupCommand,
    };
  }
  const runtime = resolvePraxistRuntime(env);
  if (!runtime) {
    return {
      available: false,
      cloned: true,
      runtime: null,
      agreementAccepted: false,
      codexInstalled: false,
      reason: "PRAXIST is cloned but its .venv has not been prepared.",
      setupCommand,
    };
  }
  const probeEnv = praxistEnv(runtime, env);
  const codex = spawnSync(runtime.command, ["-c", "import openai_codex"], {
    cwd: runtime.root,
    windowsHide: true,
    env: probeEnv,
    encoding: "utf8",
    timeout: 15_000,
  });
  const agreement = spawnSync(
    runtime.command,
    [...runtime.baseArgs, "user-agreement", "status", "--json"],
    { cwd: runtime.root, windowsHide: true, env: probeEnv, encoding: "utf8", timeout: 15_000 },
  );
  const agreementPayload = parseJsonObject(agreement.stdout ?? "");
  const agreementAccepted = agreement.status === 0 && agreementPayload?.accepted === true;
  const codexInstalled = codex.status === 0;
  const reason = !codexInstalled
    ? "PRAXIST needs its codex optional dependency before Breadboard can run it."
    : !agreementAccepted
      ? "PRAXIST requires the operator to review and accept its current legal terms in a local terminal."
      : undefined;
  return {
    available: Boolean(codexInstalled && agreementAccepted),
    cloned: true,
    runtime,
    agreementAccepted,
    codexInstalled,
    reason,
    setupCommand,
  };
}

export function resolvePraxistTaskProject(value: string): string {
  if (!value || !path.isAbsolute(value) || value.length > 4_096 || /[\u0000\r\n]/u.test(value)) {
    throw new Error("Praxist needs an absolute task-project directory.");
  }
  const resolved = path.resolve(value);
  const directory = directPath(resolved, "directory");
  if (!directory || !directPath(path.join(directory, "task.yaml"), "file")) {
    throw new Error("The Praxist task project must be a direct directory containing task.yaml.");
  }
  return directory;
}

export function configuredMaxResearchTaskPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configuredPath = configured(env.PRAXIST_MAX_RESEARCH_TASK_PATH);
  if (!configuredPath) return null;
  try {
    return resolvePraxistTaskProject(configuredPath);
  } catch {
    return null;
  }
}

export function runPraxistCli(
  runtime: PraxistRuntime,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: "", stderr: "Praxist command was cancelled." });
      return;
    }
    const child = spawn(runtime.command, [...runtime.baseArgs, ...args], {
      cwd: options.cwd ?? runtime.root,
      windowsHide: true,
      env: praxistEnv(runtime, options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
      limit: number,
    ): Buffer<ArrayBufferLike> => {
      if (current.length >= limit) return current;
      const remaining = limit - current.length;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };
    const finish = (code: number | null, forced?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        code,
        stdout: stdout.toString("utf8"),
        stderr: forced ?? stderr.toString("utf8"),
      });
    };
    const abort = () => {
      try { child.kill(); } catch { /* already exited */ }
      finish(null, "Praxist command was cancelled.");
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish(null, "Praxist command timed out.");
    }, options.timeoutMs ?? CLI_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on("data", (chunk: Buffer<ArrayBufferLike>) => {
      stdout = append(stdout, chunk, MAX_STDOUT_BYTES);
    });
    child.stderr.on("data", (chunk: Buffer<ArrayBufferLike>) => {
      stderr = append(stderr, chunk, MAX_STDERR_BYTES);
    });
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
    options.signal?.addEventListener("abort", abort, { once: true });
  });
}

export function praxistClonePresent(): boolean {
  const root = resolvePraxistRoot();
  return Boolean(root && externalRuntimePathExists(path.join(root, "praxist", "__init__.py")));
}
