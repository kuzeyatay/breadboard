// Locating the cloned TradingAgents framework and the Python that can run it.
//
// Unlike the Node-based agents, this clone is a real Python package with a heavy
// dependency tree (LangGraph, pandas, yfinance, stockstats). Breadboard never
// installs it behind a run: the Agents tab asks, the user agrees, and everything
// lands in `tradingagents/.venv` — inside the clone, covered by its own
// .gitignore, and removable by deleting one directory.
//
// The bridge script that actually drives the graph lives in the repository's
// scripts/ directory rather than in the clone, so the checkout stays pristine
// and a `git pull` in the clone never conflicts with Breadboard's own file.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface TradingAgentsRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface TradingAgentsHealth {
  /** Ready to run an analysis right now. */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** `import tradingagents` succeeds inside that environment. */
  packageInstalled: boolean;
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the fast path for building the environment. */
  uvAvailable: boolean;
  /** The version string the clone reports, when it can be read. */
  version: string | null;
  /** The bridge script Breadboard drives the graph with. */
  bridgeFound: boolean;
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 60_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** A directory is a TradingAgents clone when the package and its CLI are there. */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "tradingagents", "graph", "trading_graph.py")) &&
    fs.existsSync(path.join(candidate, "tradingagents", "default_config.py")) &&
    fs.existsSync(path.join(candidate, "pyproject.toml"))
  );
}

export function resolveTradingAgentsRoot(
  env: NodeJS.ProcessEnv = process.env,
): TradingAgentsRuntime | null {
  const candidates: Array<{ root: string; source: TradingAgentsRuntime["source"] }> = [];
  const explicit = configured(env.TRADINGAGENTS_ROOT);
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "tradingagents"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "tradingagents"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "tradingagents"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The bridge script, which is Breadboard's own file and not part of the clone. */
export function bridgeScriptPath(): string | null {
  const candidates = [
    path.join(repositoryRoot(), "scripts", "tradingagents-bridge.py"),
    path.resolve(process.cwd(), "scripts", "tradingagents-bridge.py"),
    path.resolve(process.cwd(), "..", "scripts", "tradingagents-bridge.py"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function venvDirectory(root: string): string {
  return path.join(root, ".venv");
}

/** The Python inside the clone's virtual environment, if it has been built. */
export function venvPython(root: string): string | null {
  const candidate =
    process.platform === "win32"
      ? path.join(venvDirectory(root), "Scripts", "python.exe")
      : path.join(venvDirectory(root), "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

/** Find an executable on PATH, honouring PATHEXT on Windows. */
export function resolveOnPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (path.isAbsolute(executable)) return fs.existsSync(executable) ? executable : null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * A Python that could build the environment. The clone needs 3.10+, and the
 * Windows launcher (`py`) is skipped because it is a shim that resolves to the
 * same interpreters `python` already finds.
 */
export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.TRADINGAGENTS_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    // The Windows Store alias is a zero-byte reparse point that opens the Store
    // instead of running anything.
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

/**
 * Environment for anything the clone runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where the bridge's JSON would otherwise be mangled by cp1252.
 */
export function tradingAgentsEnv(
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one command for the clone. Never throws: every caller either reports the
 * failure to the user or turns it into a health reason.
 */
export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: Record<string, string | undefined>;
    maxOutputChars?: number;
    onChild?: (kill: () => void) => void;
    onStdout?: (chunk: string) => void;
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: tradingAgentsEnv(options.env ?? {}),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "spawn failed",
        timedOut: false,
      });
      return;
    }
    options.onChild?.(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      options.onStdout?.(chunk);
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 32_000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message, timedOut });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export function cloneVersion(root: string): string | null {
  try {
    const manifest = fs.readFileSync(path.join(root, "pyproject.toml"), "utf8");
    return /^version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? null;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: TradingAgentsHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardTradingAgentsHealth?: HealthCache;
  __breadboardTradingAgentsHealthInFlight?: Promise<TradingAgentsHealth>;
};

async function probe(): Promise<TradingAgentsHealth> {
  const runtime = resolveTradingAgentsRoot();
  const bridgeFound = Boolean(bridgeScriptPath());
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady: false,
      packageInstalled: false,
      systemPython: findSystemPython(),
      uvAvailable: Boolean(uvPath()),
      version: null,
      bridgeFound,
      reason: "The tradingagents clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    version: cloneVersion(runtime.root),
    uvAvailable: Boolean(uvPath()),
    bridgeFound,
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      packageInstalled: false,
      systemPython: findSystemPython(),
      reason:
        "Trading Agent is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  // Importing the package is the only check that means anything: the venv can
  // exist with a half-finished install behind it.
  const probeResult = await runCommand(
    python,
    ["-c", "import tradingagents, langgraph; print('ok')"],
    { cwd: runtime.root, timeoutMs: PROBE_TIMEOUT_MS },
  );
  const packageInstalled = probeResult.code === 0 && probeResult.stdout.includes("ok");

  if (!packageInstalled) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: false,
      systemPython: python,
      reason: probeResult.timedOut
        ? "The Trading Agent environment did not answer in time."
        : `The Trading Agent environment exists but the package does not import. ${
            probeResult.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? ""
          }`.trim(),
    };
  }

  if (!bridgeFound) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: true,
      systemPython: python,
      reason: "Breadboard's Trading Agent bridge script is missing from scripts/.",
    };
  }

  return {
    ...base,
    available: true,
    environmentReady: true,
    packageInstalled: true,
    systemPython: python,
    reason: null,
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<TradingAgentsHealth> {
  const cached = globalCache.__breadboardTradingAgentsHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardTradingAgentsHealthInFlight) {
    return globalCache.__breadboardTradingAgentsHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardTradingAgentsHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardTradingAgentsHealthInFlight = undefined;
    });
  globalCache.__breadboardTradingAgentsHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardTradingAgentsHealth = undefined;
}
