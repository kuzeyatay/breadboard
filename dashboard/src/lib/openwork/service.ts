// The two processes behind the OpenWork agent, supervised as one service.
//
// A run needs an OpenCode engine and an OpenWork server pointed at it. Both are
// slow to start — the engine downloads and boots, the server opens its runtime
// database and reconciles the workspace — so they are started once, lazily, on
// the first run and then reused. That is the difference between a 30-second and
// a 2-second second run.
//
// The engine's configuration is written here rather than reused from
// `opencode-config/opencode.json`. That file belongs to `/agents:opencode`: it
// pins an agent prompt about "the local Git repository connected to this
// Breadboard Garden" and mounts a codebase-memory MCP server over npx. Pointed
// at an OpenWork workspace both are wrong, and the MCP launch alone stalls the
// first turn while npx fetches a package. OpenWork gets its own config, with
// its own agent and no repository tooling.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { workspaceAgentPrompt, type PromptOptions } from "./prompt.ts";
import {
  openworkEnv,
  resolveBun,
  resolveEngineLauncher,
  resolvePreparedServer,
  runtimeAvailability,
  serverStateRoot,
  workspaceRoot,
} from "./runtime.ts";

export interface OpenworkService {
  engineUrl: string;
  serverUrl: string;
  token: string;
  hostToken: string;
  workspaceId: string;
  workspacePath: string;
  /** Models the running engine's config declares. */
  models: string[];
  startedAt: number;
}

interface ServiceState extends OpenworkService {
  engine: ChildProcess;
  server: ChildProcess;
  baseUrl: string;
  apiKey: string;
  prompt: PromptOptions;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardOpenworkService?: ServiceState | null;
  __breadboardOpenworkStarting?: Promise<OpenworkService> | null;
};

const ENGINE_READY_TIMEOUT_MS = 180_000;
const SERVER_READY_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 8_000;

export interface StartOptions {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  baseUrl: string;
  apiKey: string;
  /** The model this run wants, so a config without it forces a restart. */
  model: string;
  /** The agent's stored preferences, which are baked into the engine config. */
  prompt: PromptOptions;
}

/** Two services differ only in what the engine's config would say. */
function sameShape(state: ServiceState, options: StartOptions): boolean {
  return (
    state.baseUrl === options.baseUrl &&
    state.apiKey === options.apiKey &&
    state.prompt.deliverFiles === options.prompt.deliverFiles &&
    state.prompt.allowCommands === options.prompt.allowCommands &&
    state.models.includes(options.model)
  );
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
 * Every model ChatMock currently serves, so the generated config declares all
 * of them and switching model in the chat does not restart the engine. The
 * requested model is always included: a list that failed to load must not be
 * the reason a run cannot start.
 */
async function declaredModels(options: StartOptions): Promise<string[]> {
  const models = new Set<string>([options.model]);
  try {
    const response = await fetch(new URL("models", `${options.baseUrl.replace(/\/?$/, "/")}`), {
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: { id?: unknown }[] };
      for (const entry of body.data ?? []) {
        if (typeof entry.id === "string" && entry.id.trim()) models.add(entry.id.trim());
      }
    }
  } catch {
    // ChatMock being unreachable is the run's problem to report, not setup's.
  }
  return [...models];
}

const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

function engineConfig(models: readonly string[], prompt: PromptOptions): string {
  const entries = Object.fromEntries(
    models.map((id) => [
      id,
      {
        name: id,
        reasoning: true,
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        variants: Object.fromEntries(
          EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
        ),
      },
    ]),
  );
  return `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      default_agent: "openwork",
      provider: {
        chatmock: {
          npm: "@ai-sdk/openai-compatible",
          name: "ChatMock (Breadboard)",
          options: {
            baseURL: "{env:CHATMOCK_BASE_URL}",
            apiKey: "{env:CHATMOCK_API_KEY}",
          },
          models: entries,
        },
      },
      agent: {
        openwork: {
          description: "Works inside the Breadboard OpenWork workspace",
          mode: "primary",
          prompt: workspaceAgentPrompt(prompt),
          permission: {
            // The workspace is the agent's own scratch space, so editing inside
            // it is free. Everything that reaches outside it — another
            // directory, a push — stays denied, exactly as for the repository
            // coding agents. "ask" is never used: nobody is watching a chat run,
            // so a prompt would hang until the stream timed out.
            external_directory: "deny",
            bash: prompt.allowCommands
              ? {
                  "git push": "deny",
                  "git push *": "deny",
                  "*": "allow",
                }
              : { "*": "deny" },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function waitForLine(
  child: ChildProcess,
  matches: (line: string) => string | null,
  timeoutMs: number,
  label: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (error: Error | null, value = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`${label} did not start within ${Math.round(timeoutMs / 1000)}s. ${output.trim().slice(-300)}`)),
      timeoutMs,
    );
    const onChunk = (chunk: Buffer | string) => {
      output = `${output}${chunk}`.slice(-8_000);
      for (const line of String(chunk).split(/\r?\n/)) {
        const found = matches(line);
        if (found) finish(null, found);
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.once("error", (error) => finish(error));
    child.once("exit", (code) =>
      finish(new Error(`${label} exited with code ${code}. ${output.trim().slice(-300)}`)),
    );
  });
}

function stop(state: ServiceState | null | undefined): void {
  for (const child of [state?.server, state?.engine]) {
    try {
      child?.kill();
    } catch {
      // Already gone.
    }
  }
}

async function startEngine(
  options: StartOptions,
  models: readonly string[],
): Promise<{ child: ChildProcess; url: string }> {
  const launcher = resolveEngineLauncher();
  if (!launcher) throw new Error("No OpenCode engine could be launched.");
  const stateRoot = serverStateRoot();
  fs.mkdirSync(stateRoot, { recursive: true });
  const configPath = path.join(stateRoot, "opencode.json");
  fs.writeFileSync(configPath, engineConfig(models, options.prompt), "utf8");

  const workspace = workspaceRoot();
  fs.mkdirSync(workspace, { recursive: true });
  const port = await freePort();
  const child = spawn(
    launcher.command,
    [...launcher.prefix, "serve", "--hostname", "127.0.0.1", "--port", String(port), "--cors", "*"],
    {
      cwd: workspace,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: openworkEnv({
        OPENCODE_CONFIG: configPath,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        CHATMOCK_BASE_URL: options.baseUrl,
        CHATMOCK_API_KEY: options.apiKey,
      }),
    },
  );
  const url = await waitForLine(
    child,
    (line) => /opencode server listening on (\S+)/i.exec(line)?.[1] ?? null,
    ENGINE_READY_TIMEOUT_MS,
    "The OpenCode engine",
  );
  return { child, url };
}

async function startServer(engineUrl: string): Promise<{
  child: ChildProcess;
  url: string;
  token: string;
  hostToken: string;
  workspacePath: string;
}> {
  const bun = resolveBun();
  const prepared = resolvePreparedServer();
  if (!bun.found || !prepared.found) throw new Error("The OpenWork server is not prepared.");

  const stateRoot = serverStateRoot();
  fs.mkdirSync(stateRoot, { recursive: true });
  const configPath = path.join(stateRoot, "server.json");
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, "{}\n", "utf8");

  const workspacePath = workspaceRoot();
  fs.mkdirSync(workspacePath, { recursive: true });
  const token = randomBytes(24).toString("hex");
  const hostToken = randomBytes(24).toString("hex");
  const port = await freePort();

  const child = spawn(
    bun.path,
    [
      prepared.path,
      "--config",
      configPath,
      "--workspace",
      workspacePath,
      "--opencode-base-url",
      engineUrl,
      "--opencode-directory",
      workspacePath,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--token",
      token,
      "--host-token",
      hostToken,
      // Nothing is watching for a permission prompt: the run is driven by an
      // HTTP client, not a person at a desktop app. The agent's own permission
      // policy in the engine config is what actually bounds it.
      "--approval",
      "auto",
      "--no-log-requests",
    ],
    {
      cwd: path.dirname(prepared.path),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: openworkEnv(),
    },
  );
  const url = await waitForLine(
    child,
    (line) => /OpenWork server listening on (\S+)/i.exec(line)?.[1] ?? null,
    SERVER_READY_TIMEOUT_MS,
    "The OpenWork server",
  );
  return { child, url, token, hostToken, workspacePath };
}

async function resolveWorkspaceId(url: string, token: string): Promise<string> {
  const response = await fetch(new URL("/workspaces", url), {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The OpenWork server refused /workspaces (${response.status}).`);
  const body = (await response.json()) as { items?: { id?: unknown }[] };
  const id = body.items?.find((item) => typeof item.id === "string")?.id;
  if (typeof id !== "string") throw new Error("The OpenWork server reported no workspace.");
  return id;
}

async function alive(state: ServiceState): Promise<boolean> {
  if (state.engine.exitCode !== null || state.server.exitCode !== null) return false;
  try {
    const response = await fetch(new URL("/health", state.serverUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The running service, started if necessary. A restart happens when a process
 * died, when ChatMock moved, or when the run wants a model the engine's config
 * does not declare — OpenCode reads its config once at boot, so a new model is
 * only reachable through a new engine.
 */
export async function ensureService(options: StartOptions): Promise<OpenworkService> {
  const existing = runtimeGlobal.__breadboardOpenworkService;
  if (existing) {
    const usable = sameShape(existing, options) && (await alive(existing));
    if (usable) return existing;
    stop(existing);
    runtimeGlobal.__breadboardOpenworkService = null;
  }

  runtimeGlobal.__breadboardOpenworkStarting ??= start(options).finally(() => {
    runtimeGlobal.__breadboardOpenworkStarting = null;
  });
  return runtimeGlobal.__breadboardOpenworkStarting;
}

async function start(options: StartOptions): Promise<OpenworkService> {
  const availability = runtimeAvailability();
  if (!availability.available) {
    throw new Error(availability.reason ?? "OpenWork is not ready.");
  }

  const models = await declaredModels(options);
  const engine = await startEngine(options, models);
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(engine.url);
  } catch (error) {
    try {
      engine.child.kill();
    } catch {
      // Already gone.
    }
    throw error;
  }

  let workspaceId: string;
  try {
    workspaceId = await resolveWorkspaceId(server.url, server.token);
  } catch (error) {
    stop({ engine: engine.child, server: server.child } as ServiceState);
    throw error;
  }

  const state: ServiceState = {
    engine: engine.child,
    server: server.child,
    engineUrl: engine.url,
    serverUrl: server.url,
    token: server.token,
    hostToken: server.hostToken,
    workspaceId,
    workspacePath: server.workspacePath,
    models,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    prompt: options.prompt,
    startedAt: Date.now(),
  };
  // A process that dies later must not leave a service record behind that the
  // next run trusts; the health check would catch it, but clearing here means
  // the next run starts clean instead of paying a failed probe first.
  for (const child of [engine.child, server.child]) {
    child.once("exit", () => {
      if (runtimeGlobal.__breadboardOpenworkService === state) {
        stop(state);
        runtimeGlobal.__breadboardOpenworkService = null;
      }
    });
  }
  runtimeGlobal.__breadboardOpenworkService = state;
  return state;
}

/** The service if it is already running, without starting one. */
export function currentService(): OpenworkService | null {
  return runtimeGlobal.__breadboardOpenworkService ?? null;
}

export function stopService(): void {
  stop(runtimeGlobal.__breadboardOpenworkService);
  runtimeGlobal.__breadboardOpenworkService = null;
}
