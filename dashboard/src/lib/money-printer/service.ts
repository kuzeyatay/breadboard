// The cloned MoneyPrinterTurbo API server, supervised as one long-lived service.
//
// The clone is a FastAPI app around its own task pipeline, task queue and state
// store, so Breadboard drives the real thing rather than reimplementing it. The
// process is slow to start — moviepy, faster-whisper, litellm and streamlit are
// tens of seconds of imports on a cold filesystem — so it is started once,
// lazily, on the first run and then reused. That is the difference between a
// minute-long and a two-second second run.
//
// Two decisions worth stating.
//
// The clone reads its config.toml exactly once, at import, and caches it in a
// process-wide singleton. Rather than pretend otherwise, `ensureService`
// fingerprints everything Breadboard writes into that file and restarts when it
// changes: switching the chat's model or adding a footage key restarts the
// service once, and every subsequent run reuses it.
//
// The server has no authentication of any kind — the project assumes a trusted
// network — so containment is the socket. It is bound to 127.0.0.1 on an
// ephemeral port that never leaves this process, rather than the `0.0.0.0:8080`
// its own config defaults to.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { credentialFingerprint } from "./credentials.ts";
import { ownedSettings, writeMoneyPrinterConfig } from "./config-file.ts";
import {
  invalidateHealth,
  moneyPrinterEnv,
  resolveMoneyPrinterRoot,
  setCurrentServiceUrl,
  tasksDirectory,
  venvPython,
} from "./runtime.ts";

export interface MoneyPrinterService {
  /** Where the supervised API server listens, e.g. `http://127.0.0.1:52413`. */
  url: string;
  /** The clone's checkout, which is also where its storage lives. */
  root: string;
  /** The model the running process is pinned to. */
  model: string;
  startedAt: number;
}

interface ServiceState extends MoneyPrinterService {
  child: ChildProcess;
  /** Everything a restart would have to happen for, as one comparable string. */
  fingerprint: string;
  /** The tail of the process's own output, so a crash can be explained. */
  log: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardMoneyPrinterService?: ServiceState | null;
  __breadboardMoneyPrinterStarting?: Promise<MoneyPrinterService> | null;
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
  /** The model the clone writes scripts and search terms with. */
  model: string;
}

/**
 * Start uvicorn in-process rather than running `main.py`.
 *
 * The project's own entry point reads `listen_host` out of config.toml, which
 * defaults to `0.0.0.0` — every interface on the machine, for a server with no
 * authentication. Calling `uvicorn.run` directly is the same app on the same
 * ASGI callable with the bind under Breadboard's control instead.
 */
function serveArgv(port: number): string[] {
  return [
    "-c",
    "import sys, uvicorn; uvicorn.run('app.asgi:app', host='127.0.0.1', port=int(sys.argv[1]), log_level='warning')",
    String(port),
  ];
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

/**
 * Everything the running process baked in at boot. Compared on every run so a
 * changed model, a newly added footage key or a moved ffmpeg restarts the
 * service instead of being silently ignored.
 */
function fingerprintOf(options: StartOptions, root: string): string {
  const settings = ownedSettings({ root, ...options });
  return [
    root,
    credentialFingerprint(),
    ...Object.entries(settings)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
  ].join("|");
}

/**
 * Ask the API for the first page of its task list. There is no health endpoint —
 * the project's `/ping` router is never included in the app — and this is the
 * cheapest route that proves both the HTTP stack and the state store are up.
 */
async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/v1/tasks?page=1&page_size=1", url), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Poll until the server answers. Polling rather than watching stdout for
 * uvicorn's banner: the banner is printed when the socket opens, which is before
 * the app's own startup hook has finished.
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
        `The MoneyPrinter service exited before it was ready (code ${
          child.exitCode ?? child.signalCode
        }). ${lastLines(readLog())}`.trim(),
      );
    }
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The MoneyPrinter service did not become ready within ${Math.round(
      READY_TIMEOUT_MS / 1000,
    )}s. ${lastLines(readLog())}`.trim(),
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
  // uvicorn handles SIGTERM, but a worker wedged inside an ffmpeg call would
  // otherwise hold the port.
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

async function start(options: StartOptions): Promise<MoneyPrinterService> {
  const runtime = resolveMoneyPrinterRoot();
  if (!runtime) {
    throw new Error("The MoneyPrinterTurbo clone was not found next to the dashboard.");
  }
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "MoneyPrinter has no Python environment yet. Build its environment from its settings first.",
    );
  }
  if (!options.model.trim()) throw new Error("MoneyPrinter has no model to write with.");

  // The configuration has to be on disk before the process imports it, and the
  // fingerprint below is taken from the same settings this writes.
  writeMoneyPrinterConfig({ root: runtime.root, ...options });
  // The clone creates this itself on first use, but a task directory that does
  // not exist yet makes the app's own static mount fail at import.
  fs.mkdirSync(tasksDirectory(runtime.root), { recursive: true });

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(python, serveArgv(port), {
    cwd: runtime.root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: moneyPrinterEnv({
      // Redis is optional in the clone and off by default; naming localhost
      // explicitly keeps a stray REDIS_HOST in the environment from pointing
      // the task queue at someone else's server.
      REDIS_HOST: "localhost",
    }),
  });

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
    root: runtime.root,
    model: options.model,
    fingerprint: fingerprintOf(options, runtime.root),
    startedAt: Date.now(),
    get log() {
      return log;
    },
  };
  // A process that dies later must not leave a service record the next run
  // trusts. The reachability check would catch it, but clearing here means the
  // next run starts clean instead of paying a failed probe first.
  child.once("exit", () => {
    if (runtimeGlobal.__breadboardMoneyPrinterService === state) {
      runtimeGlobal.__breadboardMoneyPrinterService = null;
      setCurrentServiceUrl(null);
      invalidateHealth();
    }
  });
  runtimeGlobal.__breadboardMoneyPrinterService = state;
  setCurrentServiceUrl(url);
  invalidateHealth();
  return state;
}

/**
 * The running service, started if necessary. Restarts when the process died or
 * when anything it baked in at boot has changed.
 */
export async function ensureService(options: StartOptions): Promise<MoneyPrinterService> {
  const runtime = resolveMoneyPrinterRoot();
  const wanted = runtime ? fingerprintOf(options, runtime.root) : "";
  const existing = runtimeGlobal.__breadboardMoneyPrinterService;
  if (existing) {
    if (
      existing.fingerprint === wanted &&
      existing.child.exitCode === null &&
      (await reachable(existing.url))
    ) {
      return existing;
    }
    kill(existing.child);
    runtimeGlobal.__breadboardMoneyPrinterService = null;
    setCurrentServiceUrl(null);
  }

  runtimeGlobal.__breadboardMoneyPrinterStarting ??= start(options).finally(() => {
    runtimeGlobal.__breadboardMoneyPrinterStarting = null;
  });
  return runtimeGlobal.__breadboardMoneyPrinterStarting;
}

/** The service if it is already running, without starting one. */
export function currentService(): MoneyPrinterService | null {
  return runtimeGlobal.__breadboardMoneyPrinterService ?? null;
}

/**
 * Stop the service and wait for the process to go, so a caller about to delete
 * the environment it is running from does not race its open file handles.
 */
export async function stopService(): Promise<void> {
  const state = runtimeGlobal.__breadboardMoneyPrinterService;
  runtimeGlobal.__breadboardMoneyPrinterService = null;
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
  return lastLines(runtimeGlobal.__breadboardMoneyPrinterService?.log ?? "", 8);
}
