// The cloned daily_stock_analysis backend, supervised as one long-lived service.
//
// The clone is a FastAPI app around its own agent, tool set, data-source
// fallback chain and SQLite store, so Breadboard drives the real thing rather
// than reimplementing it. The process is slow to start — importing litellm,
// pandas, akshare, tushare, baostock, yfinance and the rest is most of a minute
// on a cold filesystem — so it is started once, lazily, on the first run and
// then reused.
//
// Four decisions worth stating.
//
// **The clone's own `.env` is never read.** `setup_env()` loads whatever
// `ENV_FILE` points at, defaulting to `<clone>/.env`. That file is the user's
// personal deployment: their API keys, their watchlist, their WeCom and
// Telegram webhooks, and possibly `SCHEDULE_ENABLED=true`. Inheriting it would
// make the agent behave differently on every machine and could push messages
// nobody asked for. `ENV_FILE` is therefore always pointed at Breadboard's own
// generated file, which holds exactly one key (see ./settings.ts).
//
// **The scheduler is suppressed explicitly.** The app's lifespan starts a
// runtime scheduler that can run the daily pipeline and fire notifications.
// `SCHEDULE_ENABLED` already defaults to false, but a supervised backend must
// not depend on a default for something that sends messages, so
// `DSA_RUNTIME_SCHEDULER_SUPPRESS_START` says so directly.
//
// **State lives outside the clone.** `DATABASE_PATH` and `LOG_DIR` default to
// `./data` and `./logs` inside the checkout. They are gitignored, but they are
// also where the user's own runs write, and an agent should not share a
// database with them.
//
// **Configuration is baked in at boot.** The clone caches its `Config` in a
// process-wide singleton, so the model, depth, language and vendor keys are
// fixed for the life of the process. Rather than pretend otherwise,
// `ensureService` fingerprints all of that and restarts when it changes.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { credentialEnv, credentialFingerprint } from "./credentials.ts";
import {
  invalidateHealth,
  resolveStockAnalystRoot,
  setCurrentServiceUrl,
  stateHome,
  stockAnalystEnv,
  venvPython,
} from "./runtime.ts";
import { settingsEnv, settingsEnvFile, type StockAnalystSettings } from "./settings.ts";

export interface StockAnalystService {
  /** Where the supervised backend listens, e.g. `http://127.0.0.1:52413`. */
  url: string;
  /** The model the running process is pinned to. */
  model: string;
  startedAt: number;
}

interface ServiceState extends StockAnalystService {
  child: ChildProcess;
  /** Everything a restart would have to happen for, as one comparable string. */
  fingerprint: string;
  /** The tail of the process's own output, so a crash can be explained. */
  log: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardStockAnalystService?: ServiceState | null;
  __breadboardStockAnalystStarting?: Promise<StockAnalystService> | null;
};

// Cold-importing this dependency tree really is this slow the first time.
const READY_TIMEOUT_MS = 240_000;
const READY_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 8_000;
const STOP_GRACE_MS = 5_000;

/**
 * How the backend is started, and why it is not `uvicorn server:app`.
 *
 * `server.py` is the project's own entrypoint and does exactly this — read the
 * environment, start logging, serve `api.app:app` — with one difference that
 * matters here: it calls `setup_logging()` without a directory, so the log files
 * land in `./logs` *inside the checkout* regardless of `LOG_DIR`, which only
 * `main.py` honours. This launcher is that same sequence with the directory
 * passed, so a Breadboard run leaves nothing behind in the user's clone. The
 * working directory is still the clone root, because the app and its templates,
 * strategies and assets are all read relative to it.
 *
 * Arguments arrive as `sys.argv[1]` and `[2]`; with `-c`, argv[0] is `-c`.
 */
const SERVE_ARGV = [
  "-c",
  [
    "import os, sys, uvicorn",
    "from src.config import setup_env",
    "from src.logging_config import setup_logging",
    "setup_env()",
    "setup_logging(log_prefix='api_server', log_dir=os.environ['LOG_DIR'], extra_quiet_loggers=['uvicorn', 'fastapi'])",
    "uvicorn.run('api.app:app', host=sys.argv[1], port=int(sys.argv[2]), log_level='warning')",
  ].join("; "),
];

export interface StartOptions {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  baseUrl: string;
  apiKey: string;
  /** The chat's model, used unless the settings pin one. */
  model: string;
  settings: StockAnalystSettings;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
        return;
      }
      server.close(() => reject(new Error("could not reserve a port")));
    });
  });
}

/** The model the service will be pinned to: a pinned setting, else the chat's. */
export function effectiveModel(options: StartOptions): string {
  return options.settings.model.trim() || options.model.trim();
}

/**
 * Everything the running process baked in at boot. Compared on every run so a
 * changed model, a changed setting or a newly added vendor key restarts the
 * service instead of being silently ignored.
 */
function fingerprintOf(options: StartOptions): string {
  const environment = settingsEnv(options.settings);
  return [
    options.baseUrl,
    options.apiKey,
    effectiveModel(options),
    options.settings.watchlist,
    credentialFingerprint(),
    ...Object.entries(environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
  ].join("|");
}

/** Breadboard's own env file — the only file the clone is told to read. */
function envFilePath(): string {
  return path.join(stateHome(), "breadboard.env");
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/v1/health", url), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Poll the health endpoint until the server answers. Polling rather than
 * watching stdout for uvicorn's banner: the banner is printed when the socket
 * opens, which is before the app's own startup hook has finished.
 */
async function waitForReady(
  child: ChildProcess,
  url: string,
  readLog: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The Stock Analyst service exited before it was ready (code ${child.exitCode ?? child.signalCode}). ${lastLines(readLog())}`.trim(),
      );
    }
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The Stock Analyst service did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s. ${lastLines(readLog())}`.trim(),
  );
}

function lastLines(text: string, lines = 6): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

function kill(child: ChildProcess | null | undefined): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  // uvicorn handles SIGTERM, but a wedged worker would otherwise hold the port.
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }, STOP_GRACE_MS);
  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
}

async function start(options: StartOptions): Promise<StockAnalystService> {
  const runtime = resolveStockAnalystRoot();
  if (!runtime) {
    throw new Error("The daily_stock_analysis clone was not found next to the dashboard.");
  }
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "Stock Analyst has no Python environment yet. Build its environment from its settings first.",
    );
  }

  const model = effectiveModel(options);
  if (!model) throw new Error("Stock Analyst has no model to run on.");

  const home = stateHome();
  fs.mkdirSync(path.join(home, "data"), { recursive: true });
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  const envFile = envFilePath();
  fs.writeFileSync(envFile, settingsEnvFile(options.settings), "utf8");

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(
    python,
    [...SERVE_ARGV, "127.0.0.1", String(port)],
    {
      cwd: runtime.root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: stockAnalystEnv({
        ENV_FILE: envFile,
        DATABASE_PATH: path.join(home, "data", "stock_analysis.db"),
        LOG_DIR: path.join(home, "logs"),

        // ChatMock is an OpenAI-compatible relay, which is what litellm's
        // `openai/` prefix speaks once the base URL is overridden. The model id
        // is set explicitly rather than inferred: the clone would otherwise
        // guess a provider from whichever key happens to be present.
        LITELLM_MODEL: model.includes("/") ? model : `openai/${model}`,
        OPENAI_BASE_URL: options.baseUrl,
        OPENAI_API_KEY: options.apiKey,
        GENERATION_BACKEND: "litellm",
        GENERATION_FALLBACK_BACKEND: "litellm",
        // `auto` can resolve to the clone's experimental local-Codex backend
        // when one is configured on this machine. Breadboard supplies the model,
        // so the backend is stated rather than discovered.
        AGENT_BACKEND: "litellm",
        AGENT_GENERATION_BACKEND: "litellm",

        // Nothing here may run the daily pipeline or send a notification: this
        // process exists to answer one question asked in a chat.
        DSA_RUNTIME_SCHEDULER_SUPPRESS_START: "1",
        SCHEDULE_ENABLED: "false",
        RUN_IMMEDIATELY: "false",
        SCHEDULE_RUN_IMMEDIATELY: "false",
        // The backend is loopback-only and headless; there is no frontend bundle
        // to build and no login page to protect.
        WEBUI_AUTO_BUILD: "false",
        ADMIN_AUTH_ENABLED: "false",

        ...settingsEnv(options.settings),
        ...credentialEnv(),
      }),
    },
  );

  let log = "";
  const append = (chunk: Buffer | string) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  try {
    await waitForReady(child, url, () => log);
  } catch (error) {
    kill(child);
    throw error;
  }

  const state: ServiceState = {
    child,
    url,
    model,
    fingerprint: fingerprintOf(options),
    startedAt: Date.now(),
    get log() {
      return log;
    },
  };
  // A process that dies later must not leave a service record the next run
  // trusts. The health check would catch it, but clearing here means the next
  // run starts clean instead of paying a failed probe first.
  child.once("exit", () => {
    if (runtimeGlobal.__breadboardStockAnalystService === state) {
      runtimeGlobal.__breadboardStockAnalystService = null;
      setCurrentServiceUrl(null);
      invalidateHealth();
    }
  });
  runtimeGlobal.__breadboardStockAnalystService = state;
  setCurrentServiceUrl(url);
  invalidateHealth();
  return state;
}

/**
 * The running service, started if necessary. Restarts when the process died or
 * when anything it baked in at boot has changed.
 */
export async function ensureService(options: StartOptions): Promise<StockAnalystService> {
  const wanted = fingerprintOf(options);
  const existing = runtimeGlobal.__breadboardStockAnalystService;
  if (existing) {
    if (
      existing.fingerprint === wanted &&
      existing.child.exitCode === null &&
      (await reachable(existing.url))
    ) {
      return existing;
    }
    kill(existing.child);
    runtimeGlobal.__breadboardStockAnalystService = null;
    setCurrentServiceUrl(null);
  }

  runtimeGlobal.__breadboardStockAnalystStarting ??= start(options).finally(() => {
    runtimeGlobal.__breadboardStockAnalystStarting = null;
  });
  return runtimeGlobal.__breadboardStockAnalystStarting;
}

/** The service if it is already running, without starting one. */
export function currentService(): StockAnalystService | null {
  return runtimeGlobal.__breadboardStockAnalystService ?? null;
}

/**
 * Stop the service and wait for the process to go, so a caller about to delete
 * the environment it is running from does not race its open file handles.
 */
export async function stopService(): Promise<void> {
  const state = runtimeGlobal.__breadboardStockAnalystService;
  runtimeGlobal.__breadboardStockAnalystService = null;
  setCurrentServiceUrl(null);
  invalidateHealth();
  if (!state || state.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    state.child.once("exit", () => resolve());
    const timer = setTimeout(resolve, STOP_GRACE_MS + 1_000);
    timer.unref?.();
  });
  kill(state.child);
  await exited;
}

/** The tail of the running process's output, for a failure report. */
export function serviceLog(): string {
  return lastLines(runtimeGlobal.__breadboardStockAnalystService?.log ?? "", 8);
}
