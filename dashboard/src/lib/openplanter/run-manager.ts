// OpenPlanter's full Python/tool process tree runs only inside one fresh Runtime
// V2 worker. Next routes import runtime-run-manager.ts, never this module.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promptWithContext } from "../conversations/agent-context.ts";
import {
  openPlanterPythonCommand,
  openPlanterRunnerPath,
  resolveOpenPlanterRoot,
  runtimeAvailability,
} from "./runtime.ts";

export interface OpenPlanterEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  task: string;
  workspace: string;
  status: RunStatus;
  sequence: number;
  events: OpenPlanterEvent[];
  child: ChildProcess | null;
  stderr: string;
}

export interface OpenPlanterRuntimeWorkerRunInput {
  readonly userId: number;
  readonly runtimeJobId: string;
  readonly runtimeWorkspacePath: string;
  readonly task: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly conversationContext?: string;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardOpenPlanterWorkerRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardOpenPlanterWorkerRuns ?? new Map<string, RunState>();
globalRuns.__breadboardOpenPlanterWorkerRuns = runs;

const RUNTIME_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_EVENTS = 5_000;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_STDOUT_RECORD_BYTES = 3 * 1024 * 1024;
const MAX_INVOCATION_BYTES = 1024 * 1024;
const TERMINAL_STATUSES = new Set<RunStatus>(["completed", "failed", "aborted"]);
const PASSTHROUGH_ENV = [
  "SystemRoot",
  "WINDIR",
  "SystemDrive",
  "PATH",
  "PATHEXT",
  "ComSpec",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "LANG",
  "LC_ALL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
] as const;

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function directWorkspace(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  try {
    const metadata = fs.lstatSync(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(resolved), resolved)
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function closedPythonEnvironment(root: string, workspace: string): NodeJS.ProcessEnv {
  const home = path.join(workspace, ".runtime-home");
  const temporary = path.join(workspace, ".runtime-temp");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  for (const directory of [home, temporary, appData, localAppData]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    OPENPLANTER_ROOT: root,
    OPENPLANTER_RUNTIME_WORKSPACE: workspace,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    TEMP: temporary,
    TMP: temporary,
  };
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.events.push({
    sequenceNumber: ++run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function boundedAppend(current: string, chunk: string, maximumBytes: number): string {
  const remaining = maximumBytes - Buffer.byteLength(current, "utf8");
  if (remaining <= 0) return current;
  const bytes = Buffer.from(chunk, "utf8");
  return current + bytes.subarray(0, remaining).toString("utf8").replace(/\uFFFD+$/u, "");
}

function failRun(run: RunState, error: unknown): void {
  if (TERMINAL_STATUSES.has(run.status)) return;
  run.status = "failed";
  const message = error instanceof Error ? error.message : "OpenPlanter could not start.";
  emit(run, "run.failed", { error: message.slice(0, 8_000) });
  try {
    run.child?.kill();
  } catch {
    // Native Runtime remains the final process-tree authority.
  }
}

function acceptPublicLine(run: RunState, line: string): void {
  if (Buffer.byteLength(line, "utf8") > MAX_STDOUT_RECORD_BYTES) {
    failRun(run, new Error("OpenPlanter emitted an oversized event."));
    return;
  }
  try {
    const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };
    if (typeof parsed.type !== "string") return;
    const payload =
      parsed.payload && typeof parsed.payload === "object" && !Array.isArray(parsed.payload)
        ? (parsed.payload as Record<string, unknown>)
        : {};
    if (parsed.type === "run.completed") run.status = "completed";
    if (parsed.type === "run.failed") run.status = "failed";
    emit(run, parsed.type, payload);
  } catch {
    // Dependency logs on stdout are deliberately ignored; only NDJSON is public.
  }
}

function invocationBytes(input: OpenPlanterRuntimeWorkerRunInput): Buffer {
  const value = {
    protocolVersion: 1,
    task: promptWithContext(input.task, input.conversationContext),
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    reasoningEffort: input.reasoningEffort,
    maxSteps: 40,
    maxSeconds: 900,
  };
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_INVOCATION_BYTES) {
    throw new Error("OpenPlanter invocation exceeded its sealed bound.");
  }
  return bytes;
}

function launchWorkerChild(run: RunState, input: OpenPlanterRuntimeWorkerRunInput): void {
  if (run.status === "aborted") return;
  const availability = runtimeAvailability();
  const root = resolveOpenPlanterRoot();
  const runner = openPlanterRunnerPath();
  const python = openPlanterPythonCommand();
  if (!availability.available || !root || !runner || !python) {
    throw new Error(availability.reason ?? "runtime_unavailable");
  }
  const child = spawn(python, [runner], {
    cwd: run.workspace,
    windowsHide: true,
    env: closedPythonEnvironment(root, run.workspace),
    stdio: ["pipe", "pipe", "pipe"],
  });
  run.child = child;
  run.status = "running";
  let stdout = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    if (Buffer.byteLength(stdout, "utf8") > MAX_STDOUT_RECORD_BYTES) {
      failRun(run, new Error("OpenPlanter emitted an oversized event."));
      stdout = "";
      return;
    }
    const lines = stdout.split(/\r?\n/u);
    stdout = lines.pop() ?? "";
    for (const line of lines) acceptPublicLine(run, line);
  });
  child.stderr?.on("data", (chunk: string) => {
    run.stderr = boundedAppend(run.stderr, chunk, MAX_STDERR_BYTES);
  });
  child.stdin?.on("error", (error) => failRun(run, error));
  child.on("error", (error) => failRun(run, error));
  child.on("close", (code) => {
    run.child = null;
    if (TERMINAL_STATUSES.has(run.status)) return;
    run.status = code === 0 ? "completed" : "failed";
    emit(
      run,
      run.status === "completed" ? "run.completed" : "run.failed",
      run.status === "completed"
        ? { summary: "OpenPlanter completed." }
        : {
            error:
              run.stderr.trim().split(/\r?\n/u).at(-1) ||
              `OpenPlanter exited with code ${code}`,
          },
    );
  });
  child.stdin?.end(invocationBytes(input));
}

/** Fixed worker-local entrypoint. Runtime supplies the job id and private path. */
export function startRuntimeWorkerRun(
  input: OpenPlanterRuntimeWorkerRunInput,
): { runId: string; status: RunStatus } {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !RUNTIME_JOB_ID.test(input.runtimeJobId) ||
    runs.has(input.runtimeJobId)
  ) {
    throw new Error("OpenPlanter Runtime identity is invalid.");
  }
  const workspace = directWorkspace(input.runtimeWorkspacePath);
  if (!workspace) throw new Error("OpenPlanter Runtime workspace is invalid.");
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    task: input.task,
    workspace,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
  };
  runs.set(run.runId, run);
  void Promise.resolve()
    .then(() => launchWorkerChild(run, input))
    .catch((error: unknown) => failRun(run, error));
  return { runId: run.runId, status: "queued" };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): OpenPlanterEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return TERMINAL_STATUSES.has(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (TERMINAL_STATUSES.has(run.status)) return false;
  run.status = "aborted";
  try {
    run.child?.kill();
  } catch {
    // Native Runtime kills every remaining descendant after the grace window.
  }
  emit(run, "run.aborted", { summary: "OpenPlanter investigation stopped." });
  return true;
}
