// Locating the cloned Vibe-Trading project and the Python that can run it.
//
// The clone is a real service, not a library: a FastAPI app (agent/api_server.py)
// wrapping its own agent loop, its own tool set (market data, factors,
// backtests, hypotheses, shadow accounts) and its own session store. Breadboard
// therefore drives the real thing over HTTP rather than reimplementing any of
// it — the same shape as the Socials Manager and Trading Agent integrations.
//
// Nothing here installs anything behind a run. The dependency tree is heavy
// (LangChain, pandas, numba, ccxt), so the Agents tab asks, the user agrees, and
// everything lands in `Vibe-Trading/.venv`, which the clone's own .gitignore
// already covers and which `Remove environment` deletes again.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface VibeTradingRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface VibeTradingHealth {
  /** Ready to answer a prompt right now (possibly after starting the service). */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** `import api_server` succeeds inside that environment. */
  packageInstalled: boolean;
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the fast path for building the environment. */
  uvAvailable: boolean;
  /** The version string the clone reports, when it can be read. */
  version: string | null;
  /** The supervised API service is up and answering /health. */
  serviceRunning: boolean;
  /** Where that service listens, once it has been started. */
  serviceUrl: string | null;
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 90_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/**
 * A directory is a Vibe-Trading clone when the API server and the agent loop are
 * both there. `pyproject.toml` alone would match half the Python trees on disk.
 */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "agent", "api_server.py")) &&
    fs.existsSync(path.join(candidate, "agent", "src", "agent", "loop.py")) &&
    fs.existsSync(path.join(candidate, "pyproject.toml"))
  );
}

export function resolveVibeTradingRoot(
  env: NodeJS.ProcessEnv = process.env,
): VibeTradingRuntime | null {
  const candidates: Array<{ root: string; source: VibeTradingRuntime["source"] }> = [];
  const explicit = configured(env.VIBE_TRADING_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "Vibe-Trading"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "Vibe-Trading"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "Vibe-Trading"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The clone's `agent/` directory — the cwd and import root of the service. */
export function agentDirectory(root: string): string {
  return path.join(root, "agent");
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

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * A Python that could build the environment. The Windows launcher (`py`) is
 * skipped because it is a shim resolving to the same interpreters `python`
 * already finds, and the Store alias is a zero-byte reparse point.
 */
export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.VIBE_TRADING_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

/**
 * Environment for anything the clone runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where a report full of currency symbols would otherwise be mangled by cp1252.
 */
export function vibeTradingEnv(
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
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: vibeTradingEnv(options.env ?? {}),
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
  health: VibeTradingHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardVibeTradingHealth?: HealthCache;
  __breadboardVibeTradingHealthInFlight?: Promise<VibeTradingHealth>;
};

/**
 * Read the live service state without importing ./service.ts, which imports this
 * module. Set by `startService`; absent means nothing has been started yet.
 */
const globalService = globalThis as typeof globalThis & {
  __breadboardVibeTradingServiceUrl?: string | null;
};

export function currentServiceUrl(): string | null {
  return globalService.__breadboardVibeTradingServiceUrl ?? null;
}

export function setCurrentServiceUrl(url: string | null): void {
  globalService.__breadboardVibeTradingServiceUrl = url;
}

async function probe(): Promise<VibeTradingHealth> {
  const runtime = resolveVibeTradingRoot();
  const serviceUrl = currentServiceUrl();
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
      serviceRunning: false,
      serviceUrl: null,
      reason: "The Vibe-Trading clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    version: cloneVersion(runtime.root),
    uvAvailable: Boolean(uvPath()),
    serviceUrl,
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      packageInstalled: false,
      systemPython: findSystemPython(),
      serviceRunning: false,
      reason:
        "Vibe Trading is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  // Importing the app is the only check that means anything: the venv can exist
  // with a half-finished install behind it, and this tree's heaviest
  // dependencies (numba, ccxt) are exactly the ones that fail to build.
  const probeResult = await runCommand(
    python,
    ["-c", "import api_server, uvicorn; print('ok')"],
    { cwd: agentDirectory(runtime.root), timeoutMs: PROBE_TIMEOUT_MS },
  );
  const packageInstalled = probeResult.code === 0 && probeResult.stdout.includes("ok");

  if (!packageInstalled) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: false,
      systemPython: python,
      serviceRunning: false,
      reason: probeResult.timedOut
        ? "The Vibe Trading environment did not answer in time."
        : `The Vibe Trading environment exists but its API server does not import. ${
            probeResult.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? ""
          }`.trim(),
    };
  }

  return {
    ...base,
    // The service is started on demand by the first run, so a stopped service is
    // not a reason to refuse the agent.
    available: true,
    environmentReady: true,
    packageInstalled: true,
    systemPython: python,
    serviceRunning: Boolean(serviceUrl),
    reason: null,
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<VibeTradingHealth> {
  const cached = globalCache.__breadboardVibeTradingHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    // The service can come up or die between probes, and that is cheap to read.
    return { ...cached.health, serviceRunning: Boolean(currentServiceUrl()), serviceUrl: currentServiceUrl() };
  }
  if (globalCache.__breadboardVibeTradingHealthInFlight) {
    return globalCache.__breadboardVibeTradingHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardVibeTradingHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardVibeTradingHealthInFlight = undefined;
    });
  globalCache.__breadboardVibeTradingHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardVibeTradingHealth = undefined;
}
