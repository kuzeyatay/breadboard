// The OpenScience server, supervised as one long-lived service.
//
// A run needs a server: the CLI's `run` subcommand can do a turn on its own,
// but its JSON projection only reports tool calls that *succeeded*, has no way
// to answer a permission prompt, and blocks forever on a question because it
// asks the terminal. The server exposes the whole event stream, takes
// permission responses over HTTP, and is the only way to grant the workspace
// the trust its own shell needs. So Breadboard starts one and drives it, the
// same way the OpenWork agent drives its engine.
//
// It is started lazily on the first run and then reused. Boot is slow — the
// binary loads ~290 skills, opens its storage and initialises the LSP layer —
// so this is the difference between a 20-second and a 2-second second run.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import {
  currentProject,
  grantTrust,
  health,
  trustStatus,
  type Connection,
} from "./client.ts";
import { declaredModels, writeConfig } from "./config.ts";
import { configRoot, dataRoot, resolveLauncher, workspaceRoot } from "./runtime.ts";
import { ensureWorkspace } from "./setup.ts";

export interface OpenscienceService {
  baseUrl: string;
  projectId: string;
  workspacePath: string;
  /** Models the running server's config declares. */
  models: string[];
  startedAt: number;
}

interface ServiceState extends OpenscienceService {
  child: ChildProcess;
  chatmockBaseUrl: string;
  apiKey: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardOpenscienceService?: ServiceState | null;
  __breadboardOpenscienceStarting?: Promise<OpenscienceService> | null;
};

const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 500;

export interface StartOptions {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  baseUrl: string;
  apiKey: string;
  /** The model this run wants, so a config without it forces a restart. */
  model: string;
}

/** Two services differ only in what the written config would say. */
function sameShape(state: ServiceState, options: StartOptions): boolean {
  return (
    state.chatmockBaseUrl === options.baseUrl &&
    state.apiKey === options.apiKey &&
    state.models.includes(options.model)
  );
}

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

function stopChild(child: ChildProcess): void {
  try {
    child.kill();
  } catch {
    // Already gone.
  }
}

export function currentService(): OpenscienceService | null {
  const state = runtimeGlobal.__breadboardOpenscienceService;
  if (!state) return null;
  // The process handle and the credentials stay inside this module; a caller
  // only ever sees the service's public shape.
  return {
    baseUrl: state.baseUrl,
    projectId: state.projectId,
    workspacePath: state.workspacePath,
    models: state.models,
    startedAt: state.startedAt,
  };
}

export function stopService(): void {
  const state = runtimeGlobal.__breadboardOpenscienceService;
  if (!state) return;
  stopChild(state.child);
  runtimeGlobal.__breadboardOpenscienceService = null;
}

async function waitForReady(
  connection: Connection,
  child: ChildProcess,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The OpenScience server exited before it was ready. ${log().slice(-400)}`.trim(),
      );
    }
    if (await health(connection)) return;
    if (Date.now() > deadline) {
      throw new Error("The OpenScience server did not become ready in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

/**
 * Make sure the workspace may execute its own code.
 *
 * A project starts untrusted, and an untrusted project cannot create a process
 * at all — so the agent writes its script and then reports that it was not
 * allowed to run it. The root granted is the one the server itself reports for
 * the workspace, and the server refuses any other, so this cannot widen beyond
 * the directory Breadboard made for it.
 */
async function ensureTrust(connection: Connection): Promise<string> {
  const project = await currentProject(connection);
  const status = await trustStatus(connection, project.id);
  if (status.canExecuteProjectCode) return project.id;
  const granted = await grantTrust(connection, project.id, status.root);
  if (!granted.canExecuteProjectCode) {
    throw new Error("The OpenScience workspace could not be granted execution rights.");
  }
  return project.id;
}

async function start(options: StartOptions): Promise<OpenscienceService> {
  const launcher = resolveLauncher();
  if (!launcher) {
    throw new Error(
      "OpenScience is not installed yet. Open its settings and install it once.",
    );
  }

  const workspace = ensureWorkspace();
  fs.mkdirSync(configRoot(), { recursive: true });
  fs.mkdirSync(dataRoot(), { recursive: true });
  writeConfig({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    models: [options.model, ...declaredModels()],
  });

  const port = await freePort();
  const child = spawn(launcher.command, [...launcher.baseArgs, "serve", "--port", String(port)], {
    cwd: workspace,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENSCIENCE_CONFIG_DIR: configRoot(),
      OPENSCIENCE_DATA_DIR: dataRoot(),
      OPENSCIENCE_DISABLE_AUTOUPDATE: "1",
      NO_COLOR: "1",
    },
  });

  let log = "";
  const collect = (chunk: string) => {
    log = `${log}${chunk}`.slice(-4_000);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("exit", () => {
    if (runtimeGlobal.__breadboardOpenscienceService?.child === child) {
      runtimeGlobal.__breadboardOpenscienceService = null;
    }
  });

  const connection: Connection = { baseUrl: `http://127.0.0.1:${port}` };
  try {
    await waitForReady(connection, child, () => log);
    const projectId = await ensureTrust(connection);
    const state: ServiceState = {
      baseUrl: connection.baseUrl,
      projectId,
      workspacePath: workspace,
      models: declaredModels(),
      startedAt: Date.now(),
      child,
      chatmockBaseUrl: options.baseUrl,
      apiKey: options.apiKey,
    };
    runtimeGlobal.__breadboardOpenscienceService = state;
    return currentService() as OpenscienceService;
  } catch (error) {
    stopChild(child);
    throw error;
  }
}

/**
 * The running service, started if there is none and restarted when the config
 * it booted with no longer matches what this run needs.
 */
export function ensureService(options: StartOptions): Promise<OpenscienceService> {
  const existing = runtimeGlobal.__breadboardOpenscienceService;
  if (existing && sameShape(existing, options)) {
    const service = currentService();
    if (service) return Promise.resolve(service);
  }
  if (runtimeGlobal.__breadboardOpenscienceStarting) {
    return runtimeGlobal.__breadboardOpenscienceStarting;
  }
  if (existing) stopService();
  const request = start(options).finally(() => {
    runtimeGlobal.__breadboardOpenscienceStarting = null;
  });
  runtimeGlobal.__breadboardOpenscienceStarting = request;
  return request;
}

/** Where a run's files land, before a service has been started. */
export function serviceWorkspace(): string {
  return currentService()?.workspacePath ?? workspaceRoot();
}
