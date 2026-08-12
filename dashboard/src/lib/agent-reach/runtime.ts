// Locating and health-checking the cloned Agent Reach installation.
//
// Agent Reach is deliberately NOT a wrapper: it installs, routes, and
// health-checks upstream tools (yt-dlp, gh, mcporter, twitter-cli, bili-cli,
// opencli, rdt-cli, …) and then agents call those tools directly. So the only
// thing Breadboard asks the Python package for is `doctor --json` — the
// authoritative map of which platform is live right now and which backend is
// serving it. Everything else is upstream commands, executed by the run manager.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface ChannelHealth {
  /** Channel key, e.g. "youtube", "twitter". */
  channel: string;
  /** Human label from the package (may be Chinese — the UI shows the key). */
  name: string;
  status: "ok" | "warn" | "off" | "error";
  message: string;
  /** 0 = zero-config, 1 = needs a free key, 2 = needs login/setup. */
  tier: number;
  backends: string[];
  activeBackend: string | null;
}

export interface AgentReachRuntime {
  /** Directory of the cloned repository. */
  root: string;
  /** argv[0] used to invoke the CLI. */
  command: string;
  /** Fixed leading arguments (e.g. ["-m", "agent_reach.cli"]). */
  baseArgs: string[];
  /** How the CLI was found — surfaced in health so setup problems are obvious. */
  source: "configured" | "venv_script" | "venv_python" | "path";
}

export interface RuntimeAvailability {
  available: boolean;
  /** The clone exists, even when its Python environment is not prepared. */
  cloned: boolean;
  runtime: AgentReachRuntime | null;
  reason?: string;
}

const DOCTOR_TIMEOUT_MS = 60_000;
const DOCTOR_CACHE_MS = 60_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function resolveAgentReachRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidates = [
    configured(env.AGENT_REACH_ROOT),
    path.join(repositoryRoot(), "agent-reach"),
    path.resolve(process.cwd(), "agent-reach"),
    path.resolve(process.cwd(), "..", "agent-reach"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "agent_reach", "cli.py")),
    ) ?? null
  );
}

function venvBinDir(root: string): string {
  return path.join(root, ".venv", process.platform === "win32" ? "Scripts" : "bin");
}

/**
 * Resolve how to invoke the CLI. A dedicated `.venv` inside the clone is the
 * supported layout (same convention as the Premortem runtime) so Agent Reach's
 * dependency tree never has to land in the user's global interpreter.
 */
export function resolveAgentReachRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AgentReachRuntime | null {
  const root = resolveAgentReachRoot(env);
  if (!root) return null;

  const explicit = configured(env.AGENT_REACH_BIN);
  if (explicit && fs.existsSync(explicit)) {
    return { root, command: explicit, baseArgs: [], source: "configured" };
  }

  const binDir = venvBinDir(root);
  const script = path.join(
    binDir,
    process.platform === "win32" ? "agent-reach.exe" : "agent-reach",
  );
  if (fs.existsSync(script)) {
    return { root, command: script, baseArgs: [], source: "venv_script" };
  }

  const venvPython = path.join(
    binDir,
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (fs.existsSync(venvPython)) {
    return {
      root,
      command: venvPython,
      baseArgs: ["-m", "agent_reach.cli"],
      source: "venv_python",
    };
  }

  return null;
}

export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
  const root = resolveAgentReachRoot(env);
  if (!root) {
    return {
      available: false,
      cloned: false,
      runtime: null,
      reason: "The Agent Reach clone was not found next to the dashboard.",
    };
  }
  const runtime = resolveAgentReachRuntime(env);
  if (!runtime) {
    return {
      available: false,
      cloned: true,
      runtime: null,
      reason:
        "Agent Reach is cloned but its Python environment is not prepared. Create it with: python -m venv agent-reach/.venv && agent-reach/.venv/bin/pip install -e agent-reach",
    };
  }
  return { available: true, cloned: true, runtime };
}

/**
 * Portable tools Breadboard installed itself (gh, ffmpeg — things with no pip or
 * npm package). Kept inside the clone so they are as removable as the clone, and
 * so installing them needs neither admin rights nor a package manager.
 */
export function toolsBinDir(root: string): string {
  return path.join(root, ".tools", "bin");
}

/**
 * Environment for anything Agent Reach drives. Two Breadboard-managed
 * directories go first on PATH:
 *   - the clone's `.venv` bin dir, because several upstream tools (yt-dlp above
 *     all) are declared dependencies of the package, so they exist there but are
 *     invisible to a non-activated shell;
 *   - `.tools/bin`, for portable binaries with no pip/npm distribution.
 * That is what lets those channels work without a second, global installation.
 */
export function agentReachEnv(
  runtime: AgentReachRuntime,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const prefixes = [venvBinDir(runtime.root), toolsBinDir(runtime.root)].filter((dir) =>
    fs.existsSync(dir),
  );
  const existing = env[pathKey] ?? "";
  return {
    ...env,
    // The dashboard may run under Electron; make spawned Node behave as Node.
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    [pathKey]: [...prefixes, existing].filter(Boolean).join(path.delimiter),
  };
}

/** Run the CLI and capture stdout. Never throws; failures come back as text. */
export function runCli(
  runtime: AgentReachRuntime,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(runtime.command, [...runtime.baseArgs, ...args], {
      cwd: runtime.root,
      windowsHide: true,
      env: agentReachEnv(runtime),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseDoctor(stdout: string): ChannelHealth[] | null {
  // The CLI prints the JSON report on stdout; dependency banners can precede it,
  // so start from the first object brace rather than assuming a clean stream.
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const channels: ChannelHealth[] = [];
  for (const [channel, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const status = record.status;
    channels.push({
      channel,
      name: typeof record.name === "string" ? record.name : channel,
      status:
        status === "ok" || status === "warn" || status === "off" || status === "error"
          ? status
          : "error",
      message: typeof record.message === "string" ? record.message : "",
      tier: typeof record.tier === "number" ? record.tier : 0,
      backends: Array.isArray(record.backends)
        ? record.backends.filter((backend): backend is string => typeof backend === "string")
        : [],
      activeBackend:
        typeof record.active_backend === "string" ? record.active_backend : null,
    });
  }
  return channels;
}

interface DoctorCache {
  at: number;
  channels: ChannelHealth[];
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardAgentReachDoctor?: DoctorCache;
  __breadboardAgentReachDoctorInFlight?: Promise<ChannelHealth[]>;
};

/**
 * Channel availability, as Agent Reach itself reports it. Probing really executes
 * upstream tools, so it is slow enough to be worth a short cache and worth
 * sharing between concurrent callers.
 */
export async function doctor(
  options: { force?: boolean } = {},
): Promise<ChannelHealth[]> {
  const cached = globalCache.__breadboardAgentReachDoctor;
  if (!options.force && cached && Date.now() - cached.at < DOCTOR_CACHE_MS) {
    return cached.channels;
  }
  if (globalCache.__breadboardAgentReachDoctorInFlight) {
    return globalCache.__breadboardAgentReachDoctorInFlight;
  }
  const runtime = resolveAgentReachRuntime();
  if (!runtime) return [];
  const request = runCli(runtime, ["doctor", "--json"], DOCTOR_TIMEOUT_MS)
    .then(({ stdout }) => {
      const channels = parseDoctor(stdout) ?? [];
      if (channels.length) {
        globalCache.__breadboardAgentReachDoctor = { at: Date.now(), channels };
      }
      return channels;
    })
    .catch(() => [] as ChannelHealth[])
    .finally(() => {
      globalCache.__breadboardAgentReachDoctorInFlight = undefined;
    });
  globalCache.__breadboardAgentReachDoctorInFlight = request;
  return request;
}

/** Channels a run can actually use right now. */
export function liveChannels(channels: ChannelHealth[]): ChannelHealth[] {
  return channels.filter((channel) => channel.status === "ok");
}
