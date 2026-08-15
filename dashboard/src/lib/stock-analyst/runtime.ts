// Locating the cloned daily_stock_analysis project and the Python that runs it.
//
// The clone is a whole product, not a library: a FastAPI backend, a scheduled
// daily-analysis pipeline, six notification channels, a React workspace and a
// desktop shell. Breadboard drives one part of it — the "ask about a stock"
// agent at `POST /api/v1/agent/chat/stream` — by supervising the real backend
// and translating its progress stream, the same shape as the Vibe Trading and
// Socials Manager integrations rather than a port.
//
// Nothing here installs anything behind a run. The dependency tree is heavy
// (litellm, pandas, akshare, tushare, baostock, yfinance, futu, FastAPI), so the
// settings dialog asks, the user agrees, and everything lands in
// `daily_stock_analysis/.venv`, which the clone's own .gitignore already covers
// and which `Remove environment` deletes again.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface StockAnalystRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface StockAnalystHealth {
  /** Ready to answer a question right now (possibly after starting the service). */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** `import api.app` succeeds inside that environment. */
  packageInstalled: boolean;
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the fast path for building the environment. */
  uvAvailable: boolean;
  /** The version string the clone reports, when it can be read. */
  version: string | null;
  /** The supervised API service is up and answering /api/v1/health. */
  serviceRunning: boolean;
  /** Where that service listens, once it has been started. */
  serviceUrl: string | null;
  reason: string | null;
}

// Importing this tree means importing litellm, pandas and every data-source SDK
// the clone falls back through, which really is minutes on a cold filesystem.
const PROBE_TIMEOUT_MS = 240_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/**
 * A directory is a daily_stock_analysis clone when the CLI entrypoint, the
 * FastAPI app and the agent's own chat endpoint are all there. `main.py` alone
 * would match most Python trees on disk.
 */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "main.py")) &&
    fs.existsSync(path.join(candidate, "server.py")) &&
    fs.existsSync(path.join(candidate, "api", "app.py")) &&
    fs.existsSync(path.join(candidate, "api", "v1", "endpoints", "agent.py"))
  );
}

export function resolveStockAnalystRoot(
  env: NodeJS.ProcessEnv = process.env,
): StockAnalystRuntime | null {
  const candidates: Array<{ root: string; source: StockAnalystRuntime["source"] }> = [];
  const explicit = configured(env.STOCK_ANALYST_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({
    root: path.join(repositoryRoot(), "daily_stock_analysis"),
    source: "repository",
  });
  candidates.push({ root: path.resolve(process.cwd(), "daily_stock_analysis"), source: "cwd" });
  candidates.push({
    root: path.resolve(process.cwd(), "..", "daily_stock_analysis"),
    source: "cwd",
  });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
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
  const explicit = configured(env.STOCK_ANALYST_PYTHON);
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
 * Where the clone keeps its database, logs and cached stock index.
 *
 * Breadboard's own runtime directory, next to this agent's credentials. The
 * clone's defaults are `./data` and `./logs` *inside the checkout* — covered by
 * its .gitignore, but shared with a user's own `python main.py` runs, which is
 * the wrong thing for an agent that is supposed to leave no trace in a tree the
 * user pulls.
 */
export function stateHome(): string {
  const configuredHome = process.env.STOCK_ANALYST_HOME?.trim();
  return configuredHome
    ? path.resolve(configuredHome)
    : path.join(repositoryRoot(), ".runtime", "stock-analyst");
}

/**
 * Environment for anything the clone runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where a Chinese-language report would otherwise be mangled by cp1252.
 */
export function stockAnalystEnv(
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
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: stockAnalystEnv(options.env ?? {}),
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

/**
 * The clone's release version. It has no Python package metadata — the only
 * version in the tree is the one its desktop shell ships under.
 */
export function cloneVersion(root: string): string | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "apps", "dsa-desktop", "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: StockAnalystHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardStockAnalystHealth?: HealthCache;
  __breadboardStockAnalystHealthInFlight?: Promise<StockAnalystHealth>;
};

/**
 * Read the live service state without importing ./service.ts, which imports this
 * module. Set by the service supervisor; absent means nothing is running.
 */
const globalService = globalThis as typeof globalThis & {
  __breadboardStockAnalystServiceUrl?: string | null;
};

export function currentServiceUrl(): string | null {
  return globalService.__breadboardStockAnalystServiceUrl ?? null;
}

export function setCurrentServiceUrl(url: string | null): void {
  globalService.__breadboardStockAnalystServiceUrl = url;
}

async function probe(): Promise<StockAnalystHealth> {
  const runtime = resolveStockAnalystRoot();
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
      reason: "The daily_stock_analysis clone was not found next to the dashboard.",
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
        "Stock Analyst is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  // Building the app is the only check that means anything: the venv can exist
  // with a half-finished install behind it, and this tree's most fragile
  // dependencies (futu-api, longbridge, pytdx, lxml) are exactly the ones that
  // fail to build. `api.app` rather than `server`, for the reason the launcher
  // in ./service.ts explains: importing `server` starts logging into the
  // checkout, which a health read has no business doing.
  const probeResult = await runCommand(
    python,
    ["-c", "import uvicorn, api.app; print('ok')"],
    {
      cwd: runtime.root,
      timeoutMs: PROBE_TIMEOUT_MS,
      env: probeEnv(),
    },
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
        ? "The Stock Analyst environment did not answer in time."
        : `The Stock Analyst environment exists but its API server does not import. ${
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

/**
 * The state the import probe runs against. `ENV_FILE` is pointed at a path that
 * does not exist on purpose: without it `setup_env()` loads the user's own
 * `.env` from inside the checkout, and a health check has no business reading
 * their API keys, watchlist or notification webhooks.
 */
function probeEnv(): Record<string, string> {
  const home = stateHome();
  return {
    ENV_FILE: path.join(home, "probe.env"),
    DATABASE_PATH: path.join(home, "data", "stock_analysis.db"),
    LOG_DIR: path.join(home, "logs"),
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<StockAnalystHealth> {
  const cached = globalCache.__breadboardStockAnalystHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    // The service can come up or die between probes, and that is cheap to read.
    return {
      ...cached.health,
      serviceRunning: Boolean(currentServiceUrl()),
      serviceUrl: currentServiceUrl(),
    };
  }
  if (globalCache.__breadboardStockAnalystHealthInFlight) {
    return globalCache.__breadboardStockAnalystHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardStockAnalystHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardStockAnalystHealthInFlight = undefined;
    });
  globalCache.__breadboardStockAnalystHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardStockAnalystHealth = undefined;
}
