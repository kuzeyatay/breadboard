// Locating and health-checking the cloned Agent Reach installation.
//
// Agent Reach is deliberately NOT a wrapper: it installs, routes, and
// health-checks upstream tools (yt-dlp, gh, mcporter, twitter-cli, bili-cli,
// opencli, rdt-cli, …) and then agents call those tools directly. So the only
// thing Breadboard asks the Python package for is `doctor --json` — the
// authoritative map of which platform is live right now and which backend is
// serving it. Everything else is upstream commands, executed by the run manager.

import { spawn } from "node:child_process";
import path from "node:path";
import {
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

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
  /** Immutable source copied into the Runtime-managed toolchain root. */
  root: string;
  /** argv[0] used to invoke the CLI. */
  command: string;
  /** Fixed leading arguments (e.g. ["-m", "agent_reach.cli"]). */
  baseArgs: string[];
  /** Closed mutable Runtime paths; never inferred from the staged source. */
  venvBin: string;
  toolsBin: string;
  npmBin: string;
  npmPrefix: string;
  home: string;
  appData: string;
  localAppData: string;
  cache: string;
  /** How the CLI was found — surfaced in health so setup problems are obvious. */
  source: "managed_venv" | "qa_configured";
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
const MAX_CLI_STDOUT_BYTES = 512 * 1024;
const MAX_CLI_STDERR_BYTES = 64 * 1024;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function sameResolvedPath(left: string, right: string): boolean {
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
      !sameResolvedPath(externalRuntimeRealpath(resolved), resolved)
    ) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function resolveAgentReachRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = configured(env.AGENT_REACH_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && externalRuntimePathExists(path.join(explicit, "agent_reach", "cli.py"))
      ? explicit
      : null;
  }
  const dataRoot = configured(env.BREADBOARD_DATA_DIR) ?? dashboardDataDir();
  const managed = path.join(dataRoot, "runtime-v2", "toolchains", "agent-reach", "source");
  return directPath(managed, "directory") &&
    directPath(path.join(managed, "agent_reach", "cli.py"), "file")
    ? managed
    : null;
}

function runtimePaths(root: string, env: NodeJS.ProcessEnv): {
  venv: string;
  venvBin: string;
  toolsBin: string;
  npmBin: string;
  npmPrefix: string;
  home: string;
  appData: string;
  localAppData: string;
  cache: string;
} {
  if (env.BREADBOARD_QA_MODE === "1") {
    const venv = path.join(root, ".venv");
    const home = path.join(root, ".home");
    const npmPrefix = path.join(root, ".npm");
    return {
      venv,
      venvBin: path.join(venv, process.platform === "win32" ? "Scripts" : "bin"),
      toolsBin: path.join(root, ".tools", "bin"),
      npmBin: process.platform === "win32" ? npmPrefix : path.join(npmPrefix, "bin"),
      npmPrefix,
      home,
      appData: path.join(home, "AppData", "Roaming"),
      localAppData: path.join(home, "AppData", "Local"),
      cache: path.join(root, ".cache"),
    };
  }
  const dataRoot = configured(env.BREADBOARD_DATA_DIR) ?? dashboardDataDir();
  const serviceRoot = path.join(dataRoot, "runtime-v2", "services", "agent-reach");
  const toolchainRoot = path.join(dataRoot, "runtime-v2", "toolchains", "agent-reach");
  const venv = path.join(serviceRoot, ".venv");
  const npmRoot = path.join(toolchainRoot, "npm");
  const home = path.join(serviceRoot, "home");
  return {
    venv,
    venvBin: path.join(venv, process.platform === "win32" ? "Scripts" : "bin"),
    toolsBin: path.join(toolchainRoot, "tools", "bin"),
    npmBin: process.platform === "win32" ? npmRoot : path.join(npmRoot, "bin"),
    npmPrefix: npmRoot,
    home,
    appData: path.join(home, "AppData", "Roaming"),
    localAppData: path.join(home, "AppData", "Local"),
    cache: path.join(toolchainRoot, "cache"),
  };
}

/**
 * Resolve how to invoke the CLI. The dedicated service venv and immutable
 * toolchain source both live below Runtime data, so Agent Reach's dependency
 * tree never lands in packaged source or the user's global interpreter.
 */
export function resolveAgentReachRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AgentReachRuntime | null {
  const root = resolveAgentReachRoot(env);
  if (!root) return null;
  const paths = runtimePaths(root, env);
  const venvPython = path.join(
    paths.venvBin,
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (directPath(venvPython, "file")) {
    return {
      root,
      command: venvPython,
      baseArgs: ["-m", "agent_reach.cli"],
      venvBin: paths.venvBin,
      toolsBin: paths.toolsBin,
      npmBin: paths.npmBin,
      npmPrefix: paths.npmPrefix,
      home: paths.home,
      appData: paths.appData,
      localAppData: paths.localAppData,
      cache: paths.cache,
      source: env.BREADBOARD_QA_MODE === "1" ? "qa_configured" : "managed_venv",
    };
  }

  return null;
}

export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
  const root = resolveAgentReachRoot(env);
  if (!root) {
    const appSource = path.join(repositoryRoot(), "agent-reach", "agent_reach", "cli.py");
    return {
      available: false,
      cloned: externalRuntimePathExists(appSource),
      runtime: null,
      reason: externalRuntimePathExists(appSource)
        ? "Agent Reach is present but its managed Runtime environment has not been prepared."
        : "The Agent Reach source is unavailable in this Breadboard installation.",
    };
  }
  const runtime = resolveAgentReachRuntime(env);
  if (!runtime) {
    return {
      available: false,
      cloned: true,
      runtime: null,
      reason:
        "Agent Reach is staged but its managed Runtime environment is not prepared.",
    };
  }
  return { available: true, cloned: true, runtime };
}

/**
 * Portable tools Breadboard installed itself (gh, ffmpeg — things with no pip or
 * npm package). Kept inside Runtime data so installation never mutates packaged
 * application source or needs administrator rights.
 */
export function toolsBinDir(root: string): string {
  return runtimePaths(root, process.env).toolsBin;
}

/**
 * Environment for anything Agent Reach drives. Three Breadboard-managed
 * directories go first on PATH:
 *   - the service's `.venv` bin dir, because several upstream tools (yt-dlp above
 *     all) are declared dependencies of the package, so they exist there but are
 *     invisible to a non-activated shell;
 *   - the Runtime tool and npm bins, for the fixed portable dependencies.
 * That is what lets those channels work without a second, global installation.
 */
export function agentReachEnv(
  runtime: AgentReachRuntime,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const prefixes = [runtime.venvBin, runtime.toolsBin, runtime.npmBin].filter((dir) =>
    externalRuntimePathExists(dir),
  );
  const existing = env[pathKey] ?? "";
  return {
    ...env,
    // The dashboard may run under Electron; make spawned Node behave as Node.
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    HOME: runtime.home,
    USERPROFILE: runtime.home,
    APPDATA: runtime.appData,
    LOCALAPPDATA: runtime.localAppData,
    XDG_CONFIG_HOME: path.join(runtime.home, ".config"),
    XDG_CACHE_HOME: runtime.cache,
    XDG_DATA_HOME: path.join(runtime.home, ".local", "share"),
    npm_config_prefix: runtime.npmPrefix,
    npm_config_cache: path.join(runtime.cache, "npm"),
    AGENT_REACH_CONFIG_PATH: path.join(runtime.home, ".agent-reach", "config.yaml"),
    [pathKey]: [...prefixes, existing].filter(Boolean).join(path.delimiter),
  };
}

/** Run the CLI and capture stdout. Never throws; failures come back as text. */
export function runCli(
  runtime: AgentReachRuntime,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: null, stdout: "", stderr: "Agent Reach command was cancelled." });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(runtime.command, [...runtime.baseArgs, ...args], {
        cwd: runtime.root,
        windowsHide: true,
        env: agentReachEnv(runtime),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Agent Reach command could not start.",
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopReason: "cancelled" | "timed out" | null = null;
    let timer: NodeJS.Timeout | null = null;
    let stopTimer: NodeJS.Timeout | null = null;
    const appendBounded = (current: string, chunk: string, limit: number) => {
      const remaining = limit - Buffer.byteLength(current, "utf8");
      if (remaining <= 0) return current;
      const bytes = Buffer.from(chunk, "utf8");
      return current + bytes.subarray(0, remaining).toString("utf8");
    };
    const finish = (result: { code: number | null; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (stopTimer) clearTimeout(stopTimer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const stop = (reason: "cancelled" | "timed out") => {
      if (stopReason) return;
      stopReason = reason;
      try {
        child.kill();
      } catch {
        // Native Runtime remains the final process-tree reaper.
      }
      stopTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref?.();
        finish({ code: null, stdout, stderr: `Agent Reach command ${reason}.` });
      }, 5_000);
      stopTimer.unref?.();
    };
    const abort = () => stop("cancelled");
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk, MAX_CLI_STDOUT_BYTES);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk, MAX_CLI_STDERR_BYTES);
    });
    timer = setTimeout(() => stop("timed out"), timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      finish({ code: null, stdout, stderr: error.message.slice(0, MAX_CLI_STDERR_BYTES) });
    });
    child.on("close", (code) => {
      finish({
        code,
        stdout,
        stderr: stopReason ? `Agent Reach command ${stopReason}.` : stderr,
      });
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
  options: { force?: boolean; signal?: AbortSignal } = {},
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
  const request = runCli(runtime, ["doctor", "--json"], DOCTOR_TIMEOUT_MS, options.signal)
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
