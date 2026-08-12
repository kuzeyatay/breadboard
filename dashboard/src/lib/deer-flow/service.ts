// The cloned DeerFlow Gateway, supervised as one long-lived service.
//
// The Gateway is the whole application: a FastAPI process with the LangGraph
// runtime embedded in it, so starting it is the only thing Breadboard has to do
// to get the real agent. It is slow to start — importing LangGraph, LangChain
// and the harness, then running the schema migrations against its SQLite file —
// so it is started once, lazily, on the first run and then reused. That is the
// difference between a minute-long and a two-second second run.
//
// Three decisions worth stating.
//
// Only the Gateway runs. The clone's `make dev` also starts a Next.js frontend
// and an nginx proxy; both exist to give DeerFlow a chat UI, and Breadboard is
// the chat UI here.
//
// Authentication is switched off (`DEER_FLOW_AUTH_DISABLED=1`), which is what
// makes the Gateway usable without a login screen Breadboard has nowhere to
// show. It is bound to loopback on a random port for exactly that reason: the
// process trusts every caller that can reach it.
//
// Configuration is rewritten per run (./config.ts) and most of it is re-read per
// request, so a restart is reserved for the parts DeerFlow reads once at boot.
// `startupFingerprint` is that set, and nothing else forces a restart.

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { writeConfig, type ConfigInput } from "./config.ts";
import {
  backendDirectory,
  deerFlowEnv,
  invalidateHealth,
  resolveDeerFlowRoot,
  setCurrentServiceUrl,
  venvPython,
} from "./runtime.ts";

export interface DeerFlowService {
  /** Where the supervised Gateway listens, e.g. `http://127.0.0.1:52413`. */
  url: string;
  /** Where DeerFlow keeps threads, checkpoints, memory and outputs. */
  home: string;
  startedAt: number;
}

interface ServiceState extends DeerFlowService {
  child: ChildProcess;
  /** Everything a restart would have to happen for, as one comparable string. */
  fingerprint: string;
  /** The tail of the process's own output, so a crash can be explained. */
  log: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardDeerFlowService?: ServiceState | null;
  __breadboardDeerFlowStarting?: Promise<DeerFlowService> | null;
};

// Cold-importing this dependency tree, then running the schema bootstrap,
// really is this slow the first time.
const READY_TIMEOUT_MS = 300_000;
const READY_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 8_000;
const STOP_GRACE_MS = 5_000;

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

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function lastLines(text: string, lines = 6): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

/**
 * Poll /health until the Gateway answers. Polling rather than watching stdout
 * for uvicorn's banner: the banner is printed when the socket opens, which is
 * before the app's lifespan has migrated its database and built its runtime.
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
        `The DeerFlow Gateway exited before it was ready (code ${child.exitCode ?? child.signalCode}). ${lastLines(readLog())}`.trim(),
      );
    }
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The DeerFlow Gateway did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s. ${lastLines(readLog())}`.trim(),
  );
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

async function start(input: ConfigInput, generated: Awaited<ReturnType<typeof writeConfig>>): Promise<DeerFlowService> {
  const runtime = resolveDeerFlowRoot();
  if (!runtime) throw new Error("The DeerFlow clone was not found next to the dashboard.");
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "DeerFlow has no Python environment yet. Build it from the agent's settings first.",
    );
  }

  const backend = backendDirectory(runtime.root);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(
    python,
    ["-m", "uvicorn", "app.gateway.app:app", "--host", "127.0.0.1", "--port", String(port)],
    {
      // The working directory is load-bearing: `backend/sitecustomize.py` is
      // what installs the Windows selector event-loop policy the Gateway needs,
      // and Python only imports it from sys.path.
      cwd: backend,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: deerFlowEnv({
        PYTHONPATH: backend,
        DEER_FLOW_PROJECT_ROOT: runtime.root,
        DEER_FLOW_HOME: generated.home,
        DEER_FLOW_CONFIG_PATH: generated.configPath,
        DEER_FLOW_EXTENSIONS_CONFIG_PATH: generated.extensionsPath,
        // No login screen exists on this side, and the process is loopback-only
        // on a random port. See the note at the top of the file.
        DEER_FLOW_AUTH_DISABLED: "1",
        GATEWAY_ENABLE_DOCS: "false",
        // `DEER_FLOW_ENV=production` is what makes the harness refuse the
        // auth-disabled mode above, so it is stated rather than inherited.
        DEER_FLOW_ENV: "local",
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
    home: generated.home,
    fingerprint: generated.startupFingerprint,
    startedAt: Date.now(),
    get log() {
      return log;
    },
  };
  // A process that dies later must not leave a service record the next run
  // trusts. The health check would catch it, but clearing here means the next
  // run starts clean instead of paying a failed probe first.
  child.once("exit", () => {
    if (runtimeGlobal.__breadboardDeerFlowService === state) {
      runtimeGlobal.__breadboardDeerFlowService = null;
      setCurrentServiceUrl(null);
      invalidateHealth();
    }
  });
  runtimeGlobal.__breadboardDeerFlowService = state;
  setCurrentServiceUrl(url);
  invalidateHealth();
  return state;
}

/**
 * The running Gateway, started if necessary, with this run's configuration
 * already written. Restarts only when the process died or when a startup-only
 * setting changed; everything else the new config file carries is picked up by
 * the Gateway on its next request.
 */
export async function ensureService(input: ConfigInput): Promise<DeerFlowService> {
  const generated = await writeConfig(input);
  const existing = runtimeGlobal.__breadboardDeerFlowService;
  if (existing) {
    if (
      existing.fingerprint === generated.startupFingerprint &&
      existing.child.exitCode === null &&
      (await reachable(existing.url))
    ) {
      return existing;
    }
    kill(existing.child);
    runtimeGlobal.__breadboardDeerFlowService = null;
    setCurrentServiceUrl(null);
  }

  runtimeGlobal.__breadboardDeerFlowStarting ??= start(input, generated).finally(() => {
    runtimeGlobal.__breadboardDeerFlowStarting = null;
  });
  return runtimeGlobal.__breadboardDeerFlowStarting;
}

/** The Gateway if it is already running, without starting one. */
export function currentService(): DeerFlowService | null {
  return runtimeGlobal.__breadboardDeerFlowService ?? null;
}

/**
 * Stop the Gateway and wait for the process to go, so a caller about to delete
 * the environment it is running from does not race its open file handles.
 */
export async function stopService(): Promise<void> {
  const state = runtimeGlobal.__breadboardDeerFlowService;
  runtimeGlobal.__breadboardDeerFlowService = null;
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
  return lastLines(runtimeGlobal.__breadboardDeerFlowService?.log ?? "", 8);
}
