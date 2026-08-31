// The OpenMAIC app, supervised as one long-lived local service.
//
// The runtime *is* the web app: the generation job routes, the classroom player
// a finished lesson opens in, and the editor are all the same `next start`. So
// it is started lazily on the first run and then left up rather than torn down
// with the run — a classroom link has to keep working after the run that made
// it is long gone.
//
// Every model setting reaches the app through the child's environment. It
// reads its providers once at boot, so a changed model or ChatMock address is a
// restart rather than a flag. The environment is built from a short allowlist
// rather than inherited: the dashboard's own env carries vendor keys that would
// silently enable providers here, and ChatMock is the only model layer.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { health } from "./client.ts";
import { classroomDataDir, classroomRuntimeRoot, nextEntry } from "./runtime.ts";

export interface ClassroomService {
  /** The app's origin — the API base and the classroom player both. */
  baseUrl: string;
  root: string;
  model: string;
  startedAt: number;
}

interface ServiceState extends ClassroomService {
  child: ChildProcess;
  /** ChatMock's base URL this server was pointed at. */
  upstreamUrl: string;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardClassroomService?: ServiceState | null;
  __breadboardClassroomStarting?: Promise<ClassroomService> | null;
};

const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 750;

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

/**
 * Who may frame the classroom player. The run card frames it from the
 * dashboard's origin, whose port is chosen per launch, so both loopback hosts
 * on any port. OpenMAIC reads this in `next.config.ts` — at BUILD time, into
 * the routes manifest — so setup passes it to the build as well; at start it
 * changes nothing, and is set anyway so the two agree.
 */
export const FRAME_ANCESTORS = "http://127.0.0.1:* http://localhost:*";

export interface StartOptions {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  upstreamUrl: string;
  /** The model id the app should name on every generation call. */
  model: string;
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

function sameShape(state: ServiceState, options: StartOptions): boolean {
  return (
    state.upstreamUrl === options.upstreamUrl.replace(/\/$/, "") && state.model === options.model
  );
}

function stopChild(child: ChildProcess): void {
  try {
    child.kill();
  } catch {
    // Already gone.
  }
}

export function currentService(): ClassroomService | null {
  const state = runtimeGlobal.__breadboardClassroomService;
  if (!state) return null;
  return {
    baseUrl: state.baseUrl,
    root: state.root,
    model: state.model,
    startedAt: state.startedAt,
  };
}

export function stopService(): void {
  const state = runtimeGlobal.__breadboardClassroomService;
  if (!state) return;
  stopChild(state.child);
  runtimeGlobal.__breadboardClassroomService = null;
}

/**
 * The settings the service last booted with, kept on disk so a classroom link
 * opened after a restart can bring the server back with the same model rather
 * than refusing until someone runs a lesson.
 */
function rememberedOptionsFile(): string {
  return path.join(classroomDataDir(), "breadboard-service.json");
}

export function rememberedOptions(): StartOptions | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(rememberedOptionsFile(), "utf8")) as {
      upstreamUrl?: unknown;
      model?: unknown;
    };
    if (typeof parsed.upstreamUrl !== "string" || typeof parsed.model !== "string") return null;
    if (!parsed.upstreamUrl.trim() || !parsed.model.trim()) return null;
    return { upstreamUrl: parsed.upstreamUrl, model: parsed.model };
  } catch {
    return null;
  }
}

function rememberOptions(options: StartOptions): void {
  try {
    fs.mkdirSync(classroomDataDir(), { recursive: true });
    fs.writeFileSync(
      rememberedOptionsFile(),
      `${JSON.stringify({ ...options, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Losing this costs a reopen after restart, not a run.
  }
}

/** The child's environment: the allowlist above plus what OpenMAIC needs. */
export function serviceEnvironment(
  options: StartOptions,
  port: number,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const name of INHERITED_ENVIRONMENT) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  const upstreamUrl = options.upstreamUrl.replace(/\/$/, "");
  return {
    ...env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
    NO_COLOR: "1",
    // ChatMock is the model layer. OpenMAIC treats `openai` with a custom base
    // URL as an OpenAI-compatible upstream; the streaming-chat flag keeps it
    // on `/v1/chat/completions`, which every ChatMock provider serves.
    OPENAI_API_KEY: chatmockApiKeyValue(source),
    OPENAI_BASE_URL: upstreamUrl,
    OPENAI_MODELS: options.model,
    OPENAI_COMPAT_USE_STREAMING_CHAT: "true",
    DEFAULT_MODEL: `openai:${options.model}`,
    ALLOWED_FRAME_ANCESTORS: FRAME_ANCESTORS,
  };
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
        `The OpenMAIC server exited before it was ready. ${log().slice(-400)}`.trim(),
      );
    }
    try {
      await health(baseUrl);
      return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error("The OpenMAIC server did not become ready in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

async function start(options: StartOptions): Promise<ClassroomService> {
  const root = classroomRuntimeRoot();
  const entry = nextEntry();
  if (!entry) {
    throw new Error("Classroom is not set up yet. Open its settings and install it once.");
  }
  // OpenMAIC writes under its cwd; `data` there is a junction to the stable
  // data directory, made by setup and re-made here in case it is missing.
  const { ensureClassroomDataLink } = await import("./setup.ts");
  ensureClassroomDataLink();
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [entry, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: serviceEnvironment(options, port),
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
    if (runtimeGlobal.__breadboardClassroomService?.child === child) {
      runtimeGlobal.__breadboardClassroomService = null;
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl, child, () => log);
    const state: ServiceState = {
      baseUrl,
      root,
      model: options.model,
      startedAt: Date.now(),
      child,
      upstreamUrl: options.upstreamUrl.replace(/\/$/, ""),
    };
    runtimeGlobal.__breadboardClassroomService = state;
    rememberOptions(options);
    return currentService() as ClassroomService;
  } catch (error) {
    stopChild(child);
    throw error;
  }
}

/**
 * The running server, started if there is none and restarted when the model
 * layer it booted against has moved.
 */
export function ensureService(options: StartOptions): Promise<ClassroomService> {
  const existing = runtimeGlobal.__breadboardClassroomService;
  if (existing && sameShape(existing, options)) {
    const service = currentService();
    if (service) return Promise.resolve(service);
  }
  if (runtimeGlobal.__breadboardClassroomStarting) {
    return runtimeGlobal.__breadboardClassroomStarting;
  }
  if (existing) stopService();
  const request = start(options).finally(() => {
    runtimeGlobal.__breadboardClassroomStarting = null;
  });
  runtimeGlobal.__breadboardClassroomStarting = request;
  return request;
}

/**
 * The server for a classroom link opened cold: whatever is running, else a
 * restart on the settings it last ran with. Null when it has never run, which
 * the link route reports rather than guessing a model.
 */
export function reopenService(): Promise<ClassroomService> | null {
  const service = currentService();
  if (service) return Promise.resolve(service);
  const options = rememberedOptions();
  return options ? ensureService(options) : null;
}
