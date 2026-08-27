// The supervised SolidWorks MCP process.
//
// Unlike the CadQuery worker — one disposable process per build — this one is
// resident. A single part is a few dozen COM round trips, SolidWorks takes tens
// of seconds to attach to, and restarting that per operation would be absurd.
// So the bridge is a singleton with a lifecycle: started on the first request
// that needs it, kept for later ones, replaced on the next request after a
// crash, and shut down when Breadboard exits.
//
// Two ownerships are tracked separately and must not be confused:
//
//   * the MCP process — Breadboard spawned it, Breadboard kills it,
//   * SOLIDWORKS.EXE — the user's application. Breadboard never terminates it,
//     not even one it started itself. Closing a CAD program out from under
//     someone is not a cleanup step.
//
// The clone is used strictly as a tool bridge. Its optional PydanticAI agent is
// never reached, because the child gets a scrubbed environment with no model
// API keys in it: there is nothing for a second agent to authenticate with.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CadServiceError } from "../errors.ts";
import { solidworksAvailability, solidworksRunning } from "./availability.ts";
import { solidworksHome, solidworksVersionHint } from "./config.ts";
import { solidWorksPythonDependenciesInstalled } from "./configuration.ts";
import type { SolidWorksBridgeStatus, SolidWorksToolResult } from "./protocol.ts";

export type { SolidWorksBridgeStatus, SolidWorksToolResult } from "./protocol.ts";

/** The MCP protocol revision the pinned clone implements. */
const PROTOCOL_VERSION = "2025-06-18";

/**
 * How long the handshake may take.
 *
 * Generous because the clone connects to SolidWorks during setup: on a cold
 * machine that is the application launching, which is minutes rather than
 * seconds.
 */
const STARTUP_TIMEOUT_MS = 300_000;

/** How long one tool call may take. A rebuild after a cut is the slow case. */
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/** Bounded diagnostics. The clone logs to stderr; a run must not retain it all. */
const MAX_LOG_CHARS = 16_000;
const SETUP_TIMEOUT_MS = 5 * 60_000;

/**
 * Whether a bridge that has just started owns the SolidWorks session it uses.
 *
 * Sampled before the child process is spawned, because the child attaches
 * during its own setup. Ownership is claimed only when SolidWorks was
 * definitely not running: "we could not tell" is treated as the user's, which
 * is the safe direction to be wrong in — Breadboard never terminates
 * SOLIDWORKS.EXE either way, and the flag exists so it never starts describing
 * someone's own open session as one it opened.
 */
export function ownsLaunchedSolidWorks(runningBeforeStart: boolean | null): boolean {
  return runningBeforeStart === false;
}

interface PendingCall {
  resolve: (value: SolidWorksToolResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function scrubbedEnvironment(env: NodeJS.ProcessEnv, dataDir: string): NodeJS.ProcessEnv {
  // An allowlist rather than a denylist: the child is a Python process that
  // drives a desktop application, and inheriting Breadboard's environment would
  // hand it every provider credential the dashboard holds.
  const carried = [
    "SystemRoot",
    "SystemDrive",
    "WINDIR",
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "ProgramFiles",
    "ProgramW6432",
    "ProgramFiles(x86)",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
    "HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  // NODE_ENV is the one variable `ProcessEnv` insists on; it is meaningless to
  // a Python child, so it is set to nothing rather than carried across.
  const child: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV ?? "production" };
  for (const key of carried) {
    const value = env[key];
    if (value !== undefined) child[key] = value;
  }

  child.PYTHONUNBUFFERED = "1";
  child.PYTHONIOENCODING = "utf-8";
  // The clone reads its configuration from SOLIDWORKS_MCP_*-prefixed variables.
  child.SOLIDWORKS_MCP_DATA_DIR = dataDir;
  child.SOLIDWORKS_MCP_LOG_LEVEL = "WARNING";
  child.SOLIDWORKS_MCP_SECURITY_LEVEL = "minimal";
  child.SOLIDWORKS_MCP_API_KEY_REQUIRED = "false";
  child.SOLIDWORKS_MCP_ENABLE_RATE_LIMITING = "false";
  child.SOLIDWORKS_MCP_ENABLE_AUDIT_LOGGING = "false";
  // A cached measurement is a wrong measurement: `get_mass_properties` is read
  // back immediately after the cut that changes it.
  child.SOLIDWORKS_MCP_ENABLE_RESPONSE_CACHE = "false";
  // Breadboard chooses the operations; the clone's complexity router choosing
  // a generated-VBA path for some of them would make a build non-deterministic.
  child.SOLIDWORKS_MCP_ENABLE_INTELLIGENT_ROUTING = "false";
  child.SOLIDWORKS_MCP_DB_LOGGING = "0";
  const uvEnvironment = env.UV_PROJECT_ENVIRONMENT?.trim();
  if (uvEnvironment) child.UV_PROJECT_ENVIRONMENT = uvEnvironment;
  const uvCache = env.UV_CACHE_DIR?.trim();
  if (uvCache) child.UV_CACHE_DIR = uvCache;
  child.UV_PYTHON_DOWNLOADS = "never";

  const version = solidworksVersionHint(env);
  if (version) child.SOLIDWORKS_MCP_SOLIDWORKS_YEAR = String(version);

  if (env.BREADBOARD_SOLIDWORKS_MOCK === "1") {
    // Only ever set by the opt-in integration test. Mock mode returns simulated
    // geometry, so it must never be reachable from a real run.
    child.SOLIDWORKS_MCP_MOCK_SOLIDWORKS = "true";
    child.SOLIDWORKS_MCP_ADAPTER_TYPE = "mock";
  }

  return child;
}

function directFile(candidate: string | undefined): string | null {
  const value = candidate?.trim();
  if (!value || !path.isAbsolute(value)) return null;
  try {
    const resolved = path.resolve(value);
    const metadata = fs.lstatSync(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const canonical = fs.realpathSync.native(resolved);
    return process.platform === "win32"
      ? canonical.toLowerCase() === resolved.toLowerCase()
        ? resolved
        : null
      : canonical === resolved
        ? resolved
        : null;
  } catch {
    return null;
  }
}

async function runProvisioningStep(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    const append = (chunk: Buffer | string) => {
      diagnostics = `${diagnostics}${String(chunk)}`.slice(-2_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill(), SETUP_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new CadServiceError(
          "solidworks_bridge_failed",
          "The managed SolidWorks bridge environment could not be provisioned.",
          { detail: error.message },
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        reject(
          new CadServiceError(
            "solidworks_bridge_failed",
            "The managed SolidWorks bridge environment could not be provisioned.",
            { detail: diagnostics },
          ),
        );
      }
    });
  });
}

async function ensureManagedPython(
  env: NodeJS.ProcessEnv,
  clone: string,
  childEnvironment: NodeJS.ProcessEnv,
): Promise<string> {
  const configured = env.BREADBOARD_SOLIDWORKS_PYTHON?.trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new CadServiceError(
      "solidworks_unavailable",
      "SolidWorks backend unavailable: the managed Python path is invalid.",
    );
  }
  const existing = directFile(configured);
  if (existing && solidWorksPythonDependenciesInstalled(existing)) return existing;
  if (env.BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME?.trim() === "1") {
    throw new CadServiceError(
      "solidworks_unavailable",
      "SolidWorks backend unavailable: its immutable packaged Python runtime is missing or incomplete.",
    );
  }
  const uv = directFile(env.BREADBOARD_UV_PATH);
  const basePython = directFile(env.BREADBOARD_SOLIDWORKS_BASE_PYTHON);
  if (!uv || (!existing && !basePython)) {
    throw new CadServiceError(
      "solidworks_unavailable",
      "SolidWorks backend unavailable: its sealed uv or Python runtime is missing.",
    );
  }
  if (!existing) {
    const environmentRoot = path.dirname(path.dirname(path.resolve(configured)));
    fs.mkdirSync(path.dirname(environmentRoot), { recursive: true });
    await runProvisioningStep(
      uv,
      ["--no-config", "venv", "--python", basePython!, environmentRoot],
      clone,
      childEnvironment,
    );
  }
  await runProvisioningStep(
    uv,
    ["--no-config", "pip", "install", "--python", configured, clone],
    clone,
    childEnvironment,
  );
  const installed = directFile(configured);
  if (!installed || !solidWorksPythonDependenciesInstalled(installed)) {
    throw new CadServiceError(
      "solidworks_bridge_failed",
      "The managed SolidWorks bridge environment did not produce its Python runtime.",
    );
  }
  return installed;
}

export class SolidWorksBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private buffer = "";
  private log = "";
  private startedAt: string | null = null;
  private toolCount = 0;
  private ownsSolidWorksProcess = false;
  private exitHookInstalled = false;

  status(): SolidWorksBridgeStatus {
    return {
      running: this.child !== null && this.child.exitCode === null,
      ownsSolidWorks: this.ownsSolidWorksProcess,
      startedAt: this.startedAt,
      toolCount: this.toolCount,
      log: this.log,
    };
  }

  /** True when SOLIDWORKS.EXE was already open when this bridge attached. */
  attachedToExistingSession(): boolean {
    return this.child !== null && !this.ownsSolidWorksProcess;
  }

  private appendLog(chunk: string): void {
    this.log = `${this.log}${chunk}`.slice(-MAX_LOG_CHARS);
  }

  private failAll(error: Error): void {
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }

  /** Drop the child without touching SolidWorks. Used on crash and on exit. */
  private teardown(): void {
    const child = this.child;
    this.child = null;
    this.startedAt = null;
    this.buffer = "";
    if (!child) return;
    try {
      child.kill();
    } catch {
      // Already gone; the exit handler has run or will.
    }
  }

  private send(message: Record<string, unknown>): void {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: {
      id?: number;
      result?: {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
        [key: string]: unknown;
      };
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not every line a server writes is a response.
    }
    if (typeof message.id !== "number") return;
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    clearTimeout(call.timer);

    if (message.error) {
      call.reject(
        new CadServiceError(
          "solidworks_tool_failed",
          message.error.message?.slice(0, 400) || "The SolidWorks bridge rejected that request.",
          { retryable: true },
        ),
      );
      return;
    }
    const text = (message.result?.content ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // A tool that answers in prose still answers; `text` carries it.
    }
    call.resolve({
      data,
      text,
      isError: Boolean(message.result?.isError),
      raw: (message.result ?? {}) as Record<string, unknown>,
    });
  }

  /**
   * Start the process and complete the MCP handshake.
   *
   * Whether SolidWorks was already running is sampled *before* the child is
   * spawned, because the child connects during its own setup. That sample is
   * the only thing that distinguishes a session Breadboard started from the
   * user's own.
   */
  private async start(env: NodeJS.ProcessEnv): Promise<void> {
    if (
      env.BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED?.trim() !== "1" ||
      env.BREADBOARD_SOLIDWORKS_BRIDGE_OWNER?.trim() !== "runtime-v2-service"
    ) {
      throw new CadServiceError(
        "solidworks_unavailable",
        "The SolidWorks bridge lifecycle is owned by Runtime V2.",
      );
    }
    const availability = await solidworksAvailability(env, { checkRunning: false });
    if (!availability.available || !availability.clonePath) {
      throw new CadServiceError("solidworks_unavailable", availability.message);
    }

    const clone = availability.clonePath;
    const dataDir = solidworksHome(env);
    fs.mkdirSync(dataDir, { recursive: true });
    const childEnvironment = scrubbedEnvironment(env, dataDir);
    const command = await ensureManagedPython(env, clone, childEnvironment);
    const args = ["-m", "solidworks_mcp.server", "--mode", "local"];

    const wasRunning = await solidworksRunning();

    const child = spawn(command, args, {
      cwd: clone,
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
      // No shell: the arguments are fixed and the paths are ours, so handing
      // them to a command interpreter would only add a quoting bug.
      shell: false,
      windowsHide: true,
    });
    this.child = child;
    this.ownsSolidWorksProcess = ownsLaunchedSolidWorks(wasRunning);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.handleLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.appendLog(chunk));

    child.on("error", (error) => {
      this.appendLog(`\n[bridge] ${error.message}\n`);
      this.teardown();
      this.failAll(
        new CadServiceError(
          "solidworks_bridge_failed",
          "The SolidWorks bridge could not be started.",
          { retryable: false, detail: error.message },
        ),
      );
    });
    child.on("close", (code) => {
      this.appendLog(`\n[bridge] exited with code ${code}\n`);
      this.teardown();
      this.failAll(
        new CadServiceError(
          "solidworks_bridge_crashed",
          "The SolidWorks bridge stopped before it answered.",
          { retryable: true, detail: this.log.slice(-1_000) },
        ),
      );
    });

    if (!this.exitHookInstalled) {
      // The MCP process is ours and goes when we go. SolidWorks is not, and
      // stays.
      const stop = () => this.teardown();
      process.once("exit", stop);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      this.exitHookInstalled = true;
    }

    await this.handshake();
    this.startedAt = new Date().toISOString();
  }

  private handshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.teardown();
        reject(
          new CadServiceError(
            "solidworks_bridge_timeout",
            "The SolidWorks bridge did not finish starting in time. SolidWorks may be showing a dialog that needs dismissing.",
            { retryable: true, detail: this.log.slice(-1_000) },
          ),
        );
      }, STARTUP_TIMEOUT_MS);

      this.pending.set(id, {
        timer,
        reject,
        resolve: () => {
          this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          resolve();
        },
      });

      this.send({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "breadboard", version: "1" },
        },
      });
    });
  }

  /**
   * Make sure a live process exists, starting one if necessary.
   *
   * A crashed bridge is not retried in place: the child is already gone by the
   * time anyone notices, so the next request simply starts a new one.
   */
  async ensureStarted(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = this.start(env).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
  ): Promise<SolidWorksToolResult> {
    await this.ensureStarted(options.env ?? process.env);
    const child = this.child;
    if (!child) {
      throw new CadServiceError(
        "solidworks_bridge_crashed",
        "The SolidWorks bridge is not running.",
        { retryable: true },
      );
    }

    return new Promise<SolidWorksToolResult>((resolve, reject) => {
      const id = this.nextId++;
      const settle = (outcome: { value: SolidWorksToolResult } | { error: Error }) => {
        this.pending.delete(id);
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if ("value" in outcome) resolve(outcome.value);
        else reject(outcome.error);
      };
      const timer = setTimeout(() => {
        settle({
          error: new CadServiceError(
            "solidworks_operation_timeout",
            `SolidWorks did not finish ${name} in time.`,
            { retryable: true },
          ),
        });
      }, options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
      const onAbort = () =>
        settle({
          error: new CadServiceError("solidworks_aborted", "The SolidWorks build was cancelled.", {
            retryable: false,
          }),
        });
      options.signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(id, {
        timer,
        resolve: (value) => settle({ value }),
        reject: (error) => settle({ error }),
      });
      this.send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      });
    });
  }

  /** Count the tools the running server exposes. Used by the smoke test. */
  async listTools(options: { env?: NodeJS.ProcessEnv } = {}): Promise<number> {
    await this.ensureStarted(options.env ?? process.env);
    const count = await new Promise<number>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CadServiceError(
            "solidworks_operation_timeout",
            "The SolidWorks bridge did not list its tools in time.",
            { retryable: true },
          ),
        );
      }, 30_000);
      this.pending.set(id, {
        timer,
        reject,
        // `tools/list` answers with `tools`, not with text content, so the
        // count comes from the raw result rather than from a parsed payload.
        resolve: (value) => resolve(Array.isArray(value.raw.tools) ? value.raw.tools.length : 0),
      });
      this.send({ jsonrpc: "2.0", id, method: "tools/list", params: {} });
    });
    this.toolCount = count;
    return count;
  }

  /** Stop the MCP process. SOLIDWORKS.EXE is deliberately left running. */
  shutdown(): void {
    this.failAll(
      new CadServiceError("solidworks_aborted", "The SolidWorks bridge was shut down.", {
        retryable: false,
      }),
    );
    this.teardown();
  }
}

// One bridge per Node process, surviving the dev server's module reloads for
// the same reason the run managers do: a second one would mean a second MCP
// process talking to the same SolidWorks session.
const globalBridge = globalThis as typeof globalThis & {
  __breadboardSolidWorksBridge?: SolidWorksBridge;
};

export function solidworksBridge(): SolidWorksBridge {
  const existing = globalBridge.__breadboardSolidWorksBridge;
  if (existing) return existing;
  const created = new SolidWorksBridge();
  globalBridge.__breadboardSolidWorksBridge = created;
  return created;
}
