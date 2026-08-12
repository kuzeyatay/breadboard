import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import type { ChatMessageAttachment } from "../chat-attachments.ts";
import type { ChatTokenUsage } from "../chat-token-usage.ts";

export interface CodexEvent {
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
  repositoryName: string;
  gardenSlug: string;
  status: RunStatus;
  sequence: number;
  events: CodexEvent[];
  child: ChildProcess | null;
  stderr: string;
  output: string[];
  startedAt: number;
  toolCount: number;
  runtimeError: string;
  cleanup: (() => void) | null;
  usage?: ChatTokenUsage;
  terminalResult?: CodexTerminalResult;
  terminalHandler?: (result: CodexTerminalResult) => void;
}

export interface CodexTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

interface Launcher {
  command: string;
  version: string;
}

/** Exported for other agents that drive a Codex process of their own. */
export type CodexLauncher = Launcher;

type CodexImageAttachment = Extract<ChatMessageAttachment, { type: "image" }>;

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardCodexRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardCodexRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardCodexRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 32_000;
const MAX_OUTPUT_PARTS = 200;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function commandVersion(command: string): string | null {
  const probe = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (probe.error || probe.status !== 0) return null;
  return (probe.stdout || probe.stderr || "Codex").trim().slice(0, 120);
}

function localBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  return [
    env.CODEX_BIN?.trim() ?? "",
    path.resolve(process.cwd(), "codex", "codex-rs", "target", "release", executable),
    path.resolve(process.cwd(), "codex", "codex-rs", "target", "debug", executable),
    path.resolve(process.cwd(), "..", "codex", "codex-rs", "target", "release", executable),
    path.resolve(process.cwd(), "..", "codex", "codex-rs", "target", "debug", executable),
  ].filter(Boolean);
}

export function resolveCodexLauncher(env: NodeJS.ProcessEnv = process.env): Launcher | null {
  return resolveLauncher(env);
}

function resolveLauncher(env: NodeJS.ProcessEnv = process.env): Launcher | null {
  for (const candidate of localBinaryCandidates(env)) {
    if (!existsSync(candidate)) continue;
    const version = commandVersion(candidate);
    if (version) return { command: candidate, version };
  }
  const command = process.platform === "win32" ? "codex.exe" : "codex";
  const version = commandVersion(command);
  return version ? { command, version } : null;
}

export function runtimeAvailability(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  installed: boolean;
  reason?: string;
  version?: string;
} {
  const launcher = resolveLauncher(env);
  if (launcher) {
    return { available: true, installed: true, version: launcher.version };
  }
  const cloneCandidates = [
    path.resolve(process.cwd(), "codex", "codex-rs", "Cargo.toml"),
    path.resolve(process.cwd(), "..", "codex", "codex-rs", "Cargo.toml"),
  ];
  const cloned = cloneCandidates.some((candidate) => existsSync(candidate));
  return {
    available: false,
    installed: cloned,
    reason: cloned
      ? "The Codex clone is present but no executable was found. Build it or set CODEX_BIN."
      : "Codex was not found. Clone or install it, or set CODEX_BIN.",
  };
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
}

function publishTerminal(run: RunState, result: CodexTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // The run result remains replayable even when transcript persistence fails.
  }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function text(value: unknown, max = 2_000): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value === undefined || value === null) return "";
  return JSON.stringify(value).slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function materializeImages(
  repositoryPath: string,
  attachments: readonly CodexImageAttachment[],
): { paths: string[]; cleanup: () => void } {
  if (attachments.length === 0) return { paths: [], cleanup: () => undefined };
  const repositoryRoot = path.resolve(repositoryPath);
  const temporaryDirectory = mkdtempSync(path.join(repositoryRoot, ".breadboard-codex-"));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const resolved = path.resolve(temporaryDirectory);
    const expectedPrefix = `${repositoryRoot}${path.sep}.breadboard-codex-`;
    if (resolved.startsWith(expectedPrefix)) {
      rmSync(resolved, { recursive: true, force: true });
    }
  };
  try {
    const paths = attachments.slice(0, MAX_IMAGES).map((attachment, index) => {
      const match = attachment.dataUrl.match(
        /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=\s]+)$/i,
      );
      if (!match) throw new Error("invalid_image_attachment");
      const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
        throw new Error("image_attachment_too_large");
      }
      const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
      const filePath = path.join(temporaryDirectory, `screenshot-${index + 1}.${extension}`);
      writeFileSync(filePath, bytes, { flag: "wx" });
      return filePath;
    });
    return { paths, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function fileChangeSummary(item: Record<string, unknown>): string {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  return changes
    .slice(0, 40)
    .map((change) => {
      const value = record(change);
      return `${text(value.kind, 30) || "update"} ${text(value.path, 400)}`.trim();
    })
    .filter(Boolean)
    .join("\n");
}

function ingestCodexEvent(run: RunState, value: Record<string, unknown>): void {
  if (value.type === "error") {
    run.runtimeError = text(value.message, 2_000) || "Codex reported an error.";
    emit(run, "runtime.error", { error: run.runtimeError });
    return;
  }
  if (value.type === "turn.failed") {
    run.runtimeError = text(record(value.error).message, 2_000) || "The Codex turn failed.";
    emit(run, "runtime.error", { error: run.runtimeError });
    return;
  }
  if (value.type === "turn.completed") {
    const usage = record(value.usage);
    const inputTokens = Number(usage.input_tokens) || 0;
    const outputTokens = Number(usage.output_tokens) || 0;
    run.usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens: Number(usage.cached_input_tokens) || 0,
      reasoningTokens: Number(usage.reasoning_output_tokens) || 0,
      estimated: false,
    };
    emit(run, "agent.usage", { ...run.usage });
    return;
  }
  if (value.type !== "item.completed") return;
  const item = record(value.item);
  const kind = text(item.type, 80);
  if (kind === "agent_message") {
    const message = text(item.text, 100_000).trim();
    if (!message) return;
    run.output.push(message);
    if (run.output.length > MAX_OUTPUT_PARTS) run.output.shift();
    emit(run, "text.completed", { text: message });
    return;
  }
  if (kind === "reasoning") {
    const reasoning = text(item.text, 8_000).trim();
    if (reasoning) emit(run, "reasoning.completed", { text: reasoning });
    return;
  }

  let tool = kind || "tool";
  let title = "";
  let summary = "";
  let status = text(item.status, 40) || "completed";
  if (kind === "command_execution") {
    tool = "shell";
    title = text(item.command, 400);
    summary = text(item.aggregated_output, 2_000);
    if (Number(item.exit_code) !== 0) status = "failed";
  } else if (kind === "file_change") {
    tool = "apply_patch";
    title = "Updated repository files";
    summary = fileChangeSummary(item);
  } else if (kind === "mcp_tool_call") {
    tool = text(item.tool, 120) || "mcp";
    title = text(item.server, 120);
    summary = text(item.error ?? item.result, 2_000);
  } else if (kind === "web_search") {
    tool = "web_search";
    title = text(item.query, 400);
  } else {
    return;
  }
  run.toolCount += 1;
  emit(run, "tool.completed", { tool, title, summary, status });
}

export function startRun(input: {
  userId: number;
  task: string;
  instruction?: string;
  skill?: { id: string; slug: string; contentHash?: string };
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  apiKey: string;
  repositoryPath: string;
  repositoryName: string;
  gardenSlug: string;
  attachments?: readonly CodexImageAttachment[];
}): { runId: string; status: RunStatus } {
  const launcher = resolveLauncher();
  if (!launcher) {
    throw new Error(runtimeAvailability().reason ?? "Codex is unavailable.");
  }
  const runId = `cxrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    task: input.task,
    repositoryName: input.repositoryName,
    gardenSlug: input.gardenSlug,
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    output: [],
    startedAt: Date.now(),
    toolCount: 0,
    runtimeError: "",
    cleanup: null,
  };
  runs.set(runId, run);

  let materialized: ReturnType<typeof materializeImages>;
  try {
    materialized = materializeImages(input.repositoryPath, input.attachments ?? []);
  } catch (error) {
    runs.delete(runId);
    throw error;
  }
  run.cleanup = materialized.cleanup;
  const codexHome = process.env.CODEX_HOME?.trim() || path.resolve(process.cwd(), ".runtime", "codex-agent");
  mkdirSync(codexHome, { recursive: true });
  const effort = ["none", "low", "medium", "high", "xhigh"].includes(input.reasoningEffort)
    ? input.reasoningEffort
    : "high";
  // The current native Windows CLI advertises `workspace-write`, but without
  // an elevated Codex sandbox installation it exposes the connected repository
  // to the model as read-only. Breadboard launches from the explicitly
  // connected repository; use Codex's unsandboxed execution mode on Windows so
  // this coding agent can actually edit it. Unix builds keep the
  // repository-scoped workspace sandbox. The Windows mode is intentionally
  // documented because cwd is not a filesystem security boundary.
  const sandboxMode =
    process.platform === "win32" ? "danger-full-access" : "workspace-write";
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox",
    sandboxMode,
    "--cd",
    input.repositoryPath,
    "--model",
    input.model,
    "-c",
    'model_provider="chatmock"',
    "-c",
    'model_providers.chatmock.name="ChatMock"',
    "-c",
    `model_providers.chatmock.base_url=${JSON.stringify(input.baseUrl)}`,
    "-c",
    'model_providers.chatmock.wire_api="responses"',
    "-c",
    "model_providers.chatmock.requires_openai_auth=false",
    "-c",
    "model_providers.chatmock.supports_websockets=false",
    "-c",
    'approval_policy="never"',
    "-c",
    `model_reasoning_effort=${JSON.stringify(effort)}`,
    ...materialized.paths.flatMap((filePath) => ["--image", filePath]),
    "-",
  ];

  const child = spawn(launcher.command, args, {
    cwd: input.repositoryPath,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CHATMOCK_BASE_URL: input.baseUrl,
      CHATMOCK_API_KEY: input.apiKey,
      CHATMOCK_MODEL: input.model,
    },
  }) as ChildProcessWithoutNullStreams;
  child.stdin.end(input.instruction ?? input.task);
  run.child = child;
  run.status = "running";
  emit(run, "run.started", {
    model: input.model,
    repository: input.repositoryName,
    gardenSlug: input.gardenSlug,
    codexVersion: launcher.version,
    provider: "chatmock",
    sandbox: sandboxMode,
    attachmentCount: materialized.paths.length,
    ...(input.skill ? { skill: input.skill } : {}),
  });

  let childErrored = false;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          ingestCodexEvent(run, value as Record<string, unknown>);
        }
      } catch {
        // Codex diagnostics that are not JSONL are intentionally ignored.
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    run.stderr = `${run.stderr}${chunk}`.slice(-MAX_STDERR);
  });
  const cleanup = () => {
    run.cleanup?.();
    run.cleanup = null;
  };
  child.on("error", (error) => {
    childErrored = true;
    if (run.child === child) run.child = null;
    cleanup();
    if (run.status === "aborted") return;
    run.status = "failed";
    emit(run, "run.failed", { error: error.message });
    publishTerminal(run, { outcome: "failed", content: error.message, usage: run.usage });
  });
  child.on("exit", (code) => {
    if (run.child === child) run.child = null;
    if (childErrored || run.status === "aborted") return;
    cleanup();
    const elapsedSec = Math.max(0, (Date.now() - run.startedAt) / 1_000);
    if (code === 0) {
      const summary = run.output.join("\n\n").trim() || "Codex completed the task.";
      run.status = "completed";
      emit(run, "run.completed", {
        summary,
        elapsedSec,
        toolCount: run.toolCount,
        repository: run.repositoryName,
      });
      publishTerminal(run, { outcome: "completed", content: summary, usage: run.usage });
      return;
    }
    const error =
      run.runtimeError ||
      run.stderr.trim().split(/\r?\n/).slice(-1)[0] ||
      `Codex exited with code ${code ?? "unknown"}`;
    run.status = "failed";
    emit(run, "run.failed", { error, elapsedSec, toolCount: run.toolCount });
    publishTerminal(run, { outcome: "failed", content: error, usage: run.usage });
  });

  return { runId, status: run.status };
}

export function getEventsSince(userId: number, runId: string, since = 0): CodexEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/**
 * Attaches durable transcript persistence after the run descriptor has been
 * recorded. If Codex finished unusually quickly, the stored terminal result is
 * delivered immediately instead of being lost between launch and subscription.
 */
export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: CodexTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.status = "aborted";
  try {
    run.child?.kill();
  } catch {
    // The process may have exited between the state check and kill.
  }
  run.cleanup?.();
  run.cleanup = null;
  emit(run, "run.aborted", { summary: "Codex task stopped." });
  publishTerminal(run, { outcome: "aborted", content: "Codex task stopped.", usage: run.usage });
  return true;
}
