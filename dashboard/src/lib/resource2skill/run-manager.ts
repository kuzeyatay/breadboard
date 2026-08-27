// Resource2Skill's Python/tool/browser tree runs only inside one fresh Runtime
// V2 worker. Next routes import runtime-run-manager.ts, never this module.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promptWithContext } from "../conversations/agent-context.ts";
import type { Resource2SkillDomain } from "./identity.ts";
import {
  resource2SkillAvailability,
  resource2SkillBrowserRoot,
} from "./runtime.ts";
import {
  scanResource2SkillArtifacts,
  type Resource2SkillArtifact,
} from "./workspace.ts";

export interface Resource2SkillEvent {
  readonly sequenceNumber: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  readonly runId: string;
  readonly userId: number;
  readonly domain: Resource2SkillDomain;
  readonly outputRoot: string;
  status: RunStatus;
  sequence: number;
  events: Resource2SkillEvent[];
  child: ChildProcess | null;
  stderr: string;
  readonly startedAt: number;
  artifacts: Resource2SkillArtifact[];
  summary: string;
}

export interface Resource2SkillRuntimeWorkerRunInput {
  readonly userId: number;
  readonly runtimeJobId: string;
  readonly runtimeWorkspacePath: string;
  readonly task: string;
  readonly domain: Resource2SkillDomain;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly maxIterations: number;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly conversationContext?: string;
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardResource2SkillWorkerRuns?: Map<string, RunState>;
};
const runs = stateGlobal.__breadboardResource2SkillWorkerRuns ?? new Map<string, RunState>();
stateGlobal.__breadboardResource2SkillWorkerRuns = runs;

const RUNTIME_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const DOMAINS = new Set<Resource2SkillDomain>(["web", "ppt", "excel", "blender", "reaper"]);
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);
const TERMINAL_STATUSES = new Set<RunStatus>(["completed", "failed", "aborted"]);
const MAX_EVENTS = 5_000;
const MAX_STDOUT_RECORD_BYTES = 3 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_PUBLIC_TEXT_BYTES = 8 * 1024;
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
  "DISPLAY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "VWS_REAPER_SOUNDFONT",
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
    ) return null;
    return resolved;
  } catch {
    return null;
  }
}

function boundedText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_PUBLIC_TEXT_BYTES) return value;
  return bytes
    .subarray(0, MAX_PUBLIC_TEXT_BYTES)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function boundedAppend(current: string, chunk: string, maximumBytes: number): string {
  const remaining = maximumBytes - Buffer.byteLength(current, "utf8");
  if (remaining <= 0) return current;
  return current + Buffer.from(chunk, "utf8")
    .subarray(0, remaining)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
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

function refreshArtifacts(run: RunState): void {
  const next = scanResource2SkillArtifacts(run.outputRoot);
  const current = new Map(run.artifacts.map((item) => [item.id, item.modifiedAt]));
  if (
    next.length === run.artifacts.length &&
    next.every((item) => current.get(item.id) === item.modifiedAt)
  ) return;
  run.artifacts = next;
  emit(run, "artifacts.updated", { artifacts: next });
}

function failRun(run: RunState, error: unknown): void {
  if (TERMINAL_STATUSES.has(run.status)) return;
  run.status = "failed";
  try {
    run.child?.kill();
  } catch {
    // Rust remains the final process-tree authority.
  }
  refreshArtifacts(run);
  const message = boundedText(
    error instanceof Error ? error.message : error,
    "Resource2Skill could not complete the artifact.",
  );
  emit(run, "run.failed", {
    error: message,
    domain: run.domain,
    artifacts: run.artifacts,
  });
}

function ingest(run: RunState, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const event = typeof record.event === "string" ? record.event : "";
  if (event === "run.started") {
    run.status = "running";
    emit(run, "run.started", {
      model: boundedText(record.model),
      domain: run.domain,
    });
    return;
  }
  if (event === "model.call") {
    emit(run, "stage.changed", { stage: "planning" });
    emit(run, "model.call", {
      model: boundedText(record.model),
      reasoning: boundedText(record.reasoning),
    });
    return;
  }
  if (event === "tool.started") {
    emit(run, "stage.changed", { stage: "building" });
    emit(run, "tool.started", { tool: boundedText(record.tool) });
    return;
  }
  if (event === "tool.completed") {
    emit(run, "tool.completed", {
      tool: boundedText(record.tool),
      status: boundedText(record.status),
      summary: boundedText(record.summary),
    });
    refreshArtifacts(run);
    return;
  }
  if (event === "run.completed") {
    run.summary = boundedText(record.summary, "Resource2Skill completed the artifact.");
    return;
  }
  if (event === "run.failed") {
    run.summary = boundedText(record.error, "Resource2Skill could not complete the artifact.");
  }
}

function finish(run: RunState, code: number | null): void {
  if (TERMINAL_STATUSES.has(run.status)) return;
  refreshArtifacts(run);
  const elapsedSec = (Date.now() - run.startedAt) / 1_000;
  if (code === 0) {
    const summary = run.summary ||
      `Created ${run.artifacts.length} ${run.domain} output${run.artifacts.length === 1 ? "" : "s"}.`;
    run.status = "completed";
    emit(run, "run.completed", {
      summary,
      elapsedSec,
      domain: run.domain,
      artifacts: run.artifacts,
    });
    return;
  }
  run.status = "failed";
  const error = run.summary ||
    run.stderr.trim().split(/\r?\n/u).at(-1) ||
    `Resource2Skill exited with ${code ?? "an unknown status"}.`;
  emit(run, "run.failed", {
    error: boundedText(error),
    elapsedSec,
    domain: run.domain,
    artifacts: run.artifacts,
  });
}

function closedPythonEnvironment(
  input: Resource2SkillRuntimeWorkerRunInput,
  root: string,
  workspace: string,
): NodeJS.ProcessEnv {
  const home = path.join(workspace, ".runtime-home");
  const temporary = path.join(workspace, ".runtime-temp");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  for (const directory of [home, temporary, appData, localAppData]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    CHATMOCK_BASE_URL: input.baseUrl,
    CHATMOCK_API_KEY: input.apiKey,
    CHATMOCK_MODEL: input.model,
    RESOURCE2SKILL_ROOT: root,
    RESOURCE2SKILL_WORKSPACE_ROOT: workspace,
    PLAYWRIGHT_BROWSERS_PATH: resource2SkillBrowserRoot(),
    NO_COLOR: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
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

function validBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function validateInput(input: Resource2SkillRuntimeWorkerRunInput): void {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !RUNTIME_JOB_ID.test(input.runtimeJobId) ||
    runs.has(input.runtimeJobId) ||
    typeof input.task !== "string" ||
    !input.task.trim() ||
    input.task.length > 20_000 ||
    !DOMAINS.has(input.domain) ||
    typeof input.model !== "string" ||
    !input.model ||
    Buffer.byteLength(input.model, "utf8") > 256 ||
    /[\u0000\r\n]/u.test(input.model) ||
    !EFFORTS.has(input.reasoningEffort) ||
    !Number.isSafeInteger(input.maxIterations) ||
    input.maxIterations < 1 ||
    input.maxIterations > 120 ||
    !validBaseUrl(input.baseUrl) ||
    typeof input.apiKey !== "string" ||
    Buffer.byteLength(input.apiKey, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(input.apiKey) ||
    typeof (input.conversationContext ?? "") !== "string" ||
    (input.conversationContext ?? "").length > 6_000
  ) throw new Error("Resource2Skill Runtime request is invalid.");
}

function launchWorkerChild(
  run: RunState,
  input: Resource2SkillRuntimeWorkerRunInput,
  workspace: string,
): void {
  if (run.status === "aborted") return;
  const runtime = resource2SkillAvailability();
  if (!runtime.available || !runtime.root || !runtime.python) {
    throw new Error(runtime.reason ?? "Resource2Skill is unavailable.");
  }
  const child = spawn(runtime.python, [
    runtime.bridge,
    "--root", runtime.root,
    "--workspace", run.outputRoot,
    "--domain", input.domain,
    "--task", promptWithContext(input.task, input.conversationContext),
    "--model", input.model,
    "--reasoning", input.reasoningEffort,
    "--max-iter", String(input.maxIterations),
  ], {
    cwd: runtime.root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: closedPythonEnvironment(input, runtime.root, workspace),
  });
  run.child = child;
  run.status = "running";
  let stdout = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(chunk, "utf8") > MAX_STDOUT_RECORD_BYTES) {
      stdout = "";
      failRun(run, new Error("Resource2Skill emitted an oversized event."));
      return;
    }
    stdout += chunk;
    const lines = stdout.split(/\r?\n/u);
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      try {
        ingest(run, JSON.parse(line) as unknown);
      } catch {
        // Dependency logs on stdout are deliberately ignored.
      }
    }
  });
  child.stderr?.on("data", (chunk: string) => {
    run.stderr = boundedAppend(run.stderr, chunk, MAX_STDERR_BYTES);
    const line = chunk.trim().split(/\r?\n/u).at(-1);
    if (line) emit(run, "log", { text: boundedText(line, "Resource2Skill is working.") });
  });
  child.on("error", (error) => failRun(run, error));
  child.on("close", (code) => {
    run.child = null;
    finish(run, code);
  });
}

/** Fixed worker-local entrypoint. Runtime supplies the job id and private path. */
export function startRuntimeWorkerRun(
  input: Resource2SkillRuntimeWorkerRunInput,
): { runId: string; status: RunStatus } {
  validateInput(input);
  const workspace = directWorkspace(input.runtimeWorkspacePath);
  if (!workspace) throw new Error("Resource2Skill Runtime workspace is invalid.");
  const outputRoot = path.join(workspace, "output");
  fs.mkdirSync(outputRoot, { recursive: false });
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    domain: input.domain,
    outputRoot,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    startedAt: Date.now(),
    artifacts: [],
    summary: "",
  };
  runs.set(run.runId, run);
  void Promise.resolve()
    .then(() => launchWorkerChild(run, input, workspace))
    .catch((error: unknown) => failRun(run, error));
  return { runId: run.runId, status: "queued" };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Resource2SkillEvent[] {
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
    // Runtime kills every remaining descendant after the grace window.
  }
  refreshArtifacts(run);
  emit(run, "run.aborted", {
    summary: "Resource2Skill run stopped.",
    domain: run.domain,
    artifacts: run.artifacts,
  });
  return true;
}
