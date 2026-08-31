// The gods-eye-view app, supervised as one long-lived local service.
//
// The runtime *is* the Vite dev server: the globe, the share-link restore, and
// the proxy middlewares that feed every live layer are all `vite dev`. So it is
// started lazily on the first run and then left up rather than torn down with
// the run — a framed view has to keep working after the run that aimed it is
// long gone.
//
// An optional Google Maps key reaches the clone through the child's
// environment, never its `.env`: Vite's `loadEnv` lets `process.env` win, so a
// file the user keeps in the checkout is left alone. The environment is built
// from a short allowlist rather than inherited, so the dashboard's own vendor
// keys cannot silently enable the clone's optional layers.

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { googleMapsKeyValue, GOOGLE_MAPS_ENV } from "./credentials.ts";
import { resolveGodsEyeRoot, viteEntry } from "./runtime.ts";

export interface GodsEyeService {
  /** The dev server's origin — the app and its data proxies both. */
  baseUrl: string;
  root: string;
  startedAt: number;
}

interface ServiceState extends GodsEyeService {
  child: ChildProcess;
  /** The key this server booted with, so a changed key is a restart. */
  keyFingerprint: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardGodsEyeService?: ServiceState | null;
  __breadboardGodsEyeStarting?: Promise<GodsEyeService> | null;
};

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 500;

/** Which environment the child inherits. Everything else is deliberately dropped. */
const INHERITED_ENVIRONMENT = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "ComSpec",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "PATHEXT",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

function fingerprint(key: string | null): string {
  // Enough to notice a change; never the key itself.
  return key ? `${key.length}:${key.slice(0, 4)}` : "keyless";
}

function stopChild(child: ChildProcess): void {
  try {
    child.kill();
  } catch {
    // Already gone.
  }
}

export function currentService(): GodsEyeService | null {
  const state = runtimeGlobal.__breadboardGodsEyeService;
  if (!state) return null;
  return { baseUrl: state.baseUrl, root: state.root, startedAt: state.startedAt };
}

export function stopService(): void {
  const state = runtimeGlobal.__breadboardGodsEyeService;
  if (!state) return;
  stopChild(state.child);
  runtimeGlobal.__breadboardGodsEyeService = null;
}

/** The child's environment: the allowlist above plus what the clone needs. */
export function serviceEnvironment(
  googleMapsApiKey: string | null = null,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const name of INHERITED_ENVIRONMENT) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  const serviceEnv: NodeJS.ProcessEnv = {
    ...env,
    NODE_ENV: "development",
    NO_COLOR: "1",
    BROWSER: "none",
  };
  if (googleMapsApiKey) serviceEnv[GOOGLE_MAPS_ENV] = googleMapsApiKey;
  return serviceEnv;
}

async function waitForReady(
  baseUrl: string,
  child: ChildProcess,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The God's Eye server exited before it was ready. ${log().slice(-400)}`.trim(),
      );
    }
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error("The God's Eye server did not become ready in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

async function start(): Promise<GodsEyeService> {
  const root = resolveGodsEyeRoot();
  if (!root) {
    throw new Error(
      "The gods-eye-view clone is missing. Clone bilawalsidhu/gods-eye-view beside the dashboard.",
    );
  }
  const entry = viteEntry();
  if (!entry) {
    throw new Error("God's Eye is not installed yet. Open its settings and install it once.");
  }
  const key = googleMapsKeyValue();
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [entry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: serviceEnvironment(key),
    },
  );

  let log = "";
  const collect = (chunk: string) => {
    log = `${log}${chunk}`.slice(-4_000);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("exit", () => {
    if (runtimeGlobal.__breadboardGodsEyeService?.child === child) {
      runtimeGlobal.__breadboardGodsEyeService = null;
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl, child, () => log);
    const state: ServiceState = {
      baseUrl,
      root,
      startedAt: Date.now(),
      child,
      keyFingerprint: fingerprint(key),
    };
    runtimeGlobal.__breadboardGodsEyeService = state;
    return currentService() as GodsEyeService;
  } catch (error) {
    stopChild(child);
    throw error;
  }
}

/**
 * The running server, started if there is none and restarted when the key it
 * booted with has changed.
 */
export function ensureService(): Promise<GodsEyeService> {
  const existing = runtimeGlobal.__breadboardGodsEyeService;
  const key = googleMapsKeyValue();
  if (existing && existing.keyFingerprint === fingerprint(key)) {
    const service = currentService();
    if (service) return Promise.resolve(service);
  }
  if (runtimeGlobal.__breadboardGodsEyeStarting) {
    return runtimeGlobal.__breadboardGodsEyeStarting;
  }
  if (existing) stopService();
  const request = start().finally(() => {
    runtimeGlobal.__breadboardGodsEyeStarting = null;
  });
  runtimeGlobal.__breadboardGodsEyeStarting = request;
  return request;
}
