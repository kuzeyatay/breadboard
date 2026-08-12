// The cloned Vibe-Trading API server, supervised as one long-lived service.
//
// The clone is a FastAPI app around its own agent loop, tool set and session
// store, so Breadboard drives the real thing rather than reimplementing it. The
// process is slow to start — importing pandas, scipy, scikit-learn, ccxt and
// LangChain is most of a minute on a cold filesystem — so it is started once,
// lazily, on the first run and then reused. That is the difference between a
// minute-long and a two-second second run.
//
// Two decisions worth stating.
//
// The service is configured entirely through its environment, never by writing
// `agent/.env`. The clone has a settings API that would persist there, but that
// file is the user's own configuration inside their checkout; Breadboard leaves
// it alone so a `git pull` never conflicts and a user's own keys are never
// overwritten.
//
// The clone caches its EnvConfig in a process-wide singleton, so the model,
// temperature and vendor keys are fixed for the life of the process. Rather than
// pretend otherwise, `ensureService` fingerprints that configuration and
// restarts when it changes — switching the chat's model restarts the service
// once, and every subsequent turn on that model reuses it.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { repositoryRoot } from "../runtime-paths.ts";
import { credentialEnv, credentialFingerprint } from "./credentials.ts";
import {
  agentDirectory,
  invalidateHealth,
  resolveVibeTradingRoot,
  setCurrentServiceUrl,
  venvPython,
  vibeTradingEnv,
} from "./runtime.ts";
import { settingsEnv, type VibeTradingSettings } from "./settings.ts";

export interface VibeTradingService {
  /** Where the supervised API server listens, e.g. `http://127.0.0.1:52413`. */
  url: string;
  /** The bearer this process was started with. Never leaves the server. */
  apiKey: string;
  /** The model the running process is pinned to. */
  model: string;
  startedAt: number;
}

interface ServiceState extends VibeTradingService {
  child: ChildProcess;
  /** Everything a restart would have to happen for, as one comparable string. */
  fingerprint: string;
  /** The tail of the process's own output, so a crash can be explained. */
  log: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardVibeTradingService?: ServiceState | null;
  __breadboardVibeTradingStarting?: Promise<VibeTradingService> | null;
};

// Cold-importing this dependency tree really is this slow the first time.
const READY_TIMEOUT_MS = 240_000;
const READY_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 8_000;
const STOP_GRACE_MS = 5_000;

export interface StartOptions {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  baseUrl: string;
  apiKey: string;
  /** The chat's model, used unless the settings pin one. */
  model: string;
  /** The reasoning effort selected for this chat turn. */
  reasoningEffort: string;
  settings: VibeTradingSettings;
}

/**
 * `import api_server`, not `python api_server.py`.
 *
 * The clone's route modules reach back to the app through
 * `sys.modules["api_server"]` — see `register_runs_routes` — so running the file
 * as a script registers it as `__main__` instead and the server dies on startup
 * with "api_server module not in sys.modules". Importing it is what the
 * project's own CLI does (`from api_server import serve_main`), and it is the
 * only launch that works.
 */
const SERVE_ARGV = [
  "-c",
  "import sys; from api_server import serve_main; raise SystemExit(serve_main(sys.argv[1:]))",
];

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
 * The Python process imports the agent loop once at boot. Include the exact
 * loop source in the restart contract so a hot-reloaded Breadboard does not
 * keep serving an older, already-imported implementation after a bug fix.
 */
function agentLoopFingerprint(): string {
  const runtime = resolveVibeTradingRoot();
  if (!runtime) return "agent-loop=missing";
  const loop = path.join(agentDirectory(runtime.root), "src", "agent", "loop.py");
  try {
    const stat = fs.statSync(loop);
    return `agent-loop=${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "agent-loop=missing";
  }
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
    options.reasoningEffort,
    credentialFingerprint(),
    agentLoopFingerprint(),
    ...Object.entries(environment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
  ].join("|");
}

/**
 * Where the clone keeps sessions, run artifacts and its search index.
 *
 * Breadboard's own runtime directory, next to this agent's credentials —
 * neither `~/.vibe-trading`, which would be shared with a separate install of
 * the upstream project, nor anywhere inside the checkout, which the clone's
 * .gitignore does not cover and which would leave the user's `git status`
 * dirty after the first run.
 */
function stateHome(): string {
  const configured = process.env.VIBE_TRADING_HOME?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(repositoryRoot(), ".runtime", "vibe-trading", "home");
}

async function reachable(url: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url), {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Poll /health until the server answers. Polling rather than watching stdout for
 * uvicorn's banner: the banner is printed when the socket opens, which is before
 * the app's own startup hook has built the session runtime.
 */
async function waitForReady(
  child: ChildProcess,
  url: string,
  apiKey: string,
  readLog: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The Vibe Trading service exited before it was ready (code ${child.exitCode ?? child.signalCode}). ${lastLines(readLog())}`.trim(),
      );
    }
    if (await reachable(url, apiKey)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The Vibe Trading service did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s. ${lastLines(readLog())}`.trim(),
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

async function start(options: StartOptions): Promise<VibeTradingService> {
  const runtime = resolveVibeTradingRoot();
  if (!runtime) throw new Error("The Vibe-Trading clone was not found next to the dashboard.");
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "Vibe Trading has no Python environment yet. Build its environment from its settings first.",
    );
  }

  const model = effectiveModel(options);
  if (!model) throw new Error("Vibe Trading has no model to run on.");

  const home = stateHome();
  fs.mkdirSync(home, { recursive: true });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  // A per-process bearer. Without it the clone falls back to trusting every
  // loopback peer, which on a shared machine is every local process.
  const apiKey = randomBytes(24).toString("hex");

  const child = spawn(python, [...SERVE_ARGV, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: agentDirectory(runtime.root),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: vibeTradingEnv({
      // ChatMock is an OpenAI-compatible relay, which is exactly what the
      // clone's `openai` provider speaks once its base URL is overridden.
      LANGCHAIN_PROVIDER: "openai",
      LANGCHAIN_MODEL_NAME: model,
      LANGCHAIN_REASONING_EFFORT: options.reasoningEffort,
      OPENAI_BASE_URL: options.baseUrl,
      OPENAI_API_BASE: options.baseUrl,
      OPENAI_API_KEY: options.apiKey,
      API_AUTH_KEY: apiKey,
      ENABLE_SESSION_RUNTIME: "true",
      VIBE_TRADING_HOME: home,
      // The agent is driven over HTTP with nobody watching for a shell prompt,
      // and the clone's own default is off. Stated rather than assumed.
      VIBE_TRADING_ENABLE_SHELL_TOOLS: "0",
      ...settingsEnv(options.settings),
      ...credentialEnv(),
    }),
  });

  let log = "";
  const append = (chunk: Buffer | string) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  try {
    await waitForReady(child, url, apiKey, () => log);
  } catch (error) {
    kill(child);
    throw error;
  }

  const state: ServiceState = {
    child,
    url,
    apiKey,
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
    if (runtimeGlobal.__breadboardVibeTradingService === state) {
      runtimeGlobal.__breadboardVibeTradingService = null;
      setCurrentServiceUrl(null);
      invalidateHealth();
    }
  });
  runtimeGlobal.__breadboardVibeTradingService = state;
  setCurrentServiceUrl(url);
  invalidateHealth();
  return state;
}

/**
 * The running service, started if necessary. Restarts when the process died or
 * when anything it baked in at boot has changed.
 */
export async function ensureService(options: StartOptions): Promise<VibeTradingService> {
  const wanted = fingerprintOf(options);
  const existing = runtimeGlobal.__breadboardVibeTradingService;
  if (existing) {
    if (
      existing.fingerprint === wanted &&
      existing.child.exitCode === null &&
      (await reachable(existing.url, existing.apiKey))
    ) {
      return existing;
    }
    kill(existing.child);
    runtimeGlobal.__breadboardVibeTradingService = null;
    setCurrentServiceUrl(null);
  }

  runtimeGlobal.__breadboardVibeTradingStarting ??= start(options).finally(() => {
    runtimeGlobal.__breadboardVibeTradingStarting = null;
  });
  return runtimeGlobal.__breadboardVibeTradingStarting;
}

/** The service if it is already running, without starting one. */
export function currentService(): VibeTradingService | null {
  return runtimeGlobal.__breadboardVibeTradingService ?? null;
}

/**
 * Stop the service and wait for the process to go, so a caller about to delete
 * the environment it is running from does not race its open file handles.
 */
export async function stopService(): Promise<void> {
  const state = runtimeGlobal.__breadboardVibeTradingService;
  runtimeGlobal.__breadboardVibeTradingService = null;
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
  return lastLines(runtimeGlobal.__breadboardVibeTradingService?.log ?? "", 8);
}
