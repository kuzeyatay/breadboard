// The HyperFrames agent: a Codex process, pinned to ChatMock, working inside a
// scaffolded HyperFrames project.
//
// The clone is a rendering framework plus a library of agent skills — there is
// no `hyperframes agent` to wrap. What the skills assume is a competent coding
// agent that can read markdown, write HTML, and run a CLI, so Breadboard
// supplies exactly that and keeps the video knowledge where upstream put it.
// The model reaches ChatMock the same way `/agents:codex` does, so this agent
// answers on the same account and the same model picker as the rest of the app.
//
// Everything user-visible is derived here rather than in the card: the run's
// stage (writing / linting / checking / rendering), the activity trail, and the
// files the project produced.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { resolveCodexLauncher, type CodexLauncher } from "../codex/run-manager.ts";
import { runInstruction, writeProjectGuidance } from "./prompt.ts";
import {
  hyperframesEnv,
  resolveLauncher,
  runtimeAvailability,
  writeCliShim,
  type HyperframesToolchain,
} from "./runtime.ts";
import {
  createWorkspace,
  primaryVideo,
  projectDirectory,
  runDirectory,
  scanArtifacts,
  WorkspaceError,
  type HyperframesArtifact,
} from "./workspace.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface HyperframesEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface HyperframesTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

/** The visible phases of a video build, in the order the CLI loop runs them. */
export type RunStage = "scaffolding" | "authoring" | "linting" | "checking" | "rendering";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  status: RunStatus;
  stage: RunStage;
  sequence: number;
  events: HyperframesEvent[];
  child: ChildProcess | null;
  stderr: string;
  output: string[];
  startedAt: number;
  toolCount: number;
  renderCount: number;
  runtimeError: string;
  lastScanAt: number;
  artifacts: HyperframesArtifact[];
  usage?: ChatTokenUsage;
  terminalResult?: HyperframesTerminalResult;
  terminalHandler?: (result: HyperframesTerminalResult) => void;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardHyperframesRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardHyperframesRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardHyperframesRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 32_000;
const MAX_OUTPUT_PARTS = 200;
const SCAN_INTERVAL_MS = 1_500;
const OUTPUT_RELATIVE_PATH = "out/video.mp4";

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

function publishTerminal(run: RunState, result: HyperframesTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // The run stays replayable even when transcript persistence fails.
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

function setStage(run: RunState, stage: RunStage): void {
  if (run.stage === stage) return;
  run.stage = stage;
  emit(run, "stage.changed", { stage });
}

/**
 * Re-read the project directory and publish what changed. Called after any tool
 * that can write a file, so the card shows the composition the moment it exists
 * and the video the moment it is encoded — not only at the end.
 */
function refreshArtifacts(run: RunState, options: { force?: boolean } = {}): void {
  const now = Date.now();
  if (!options.force && now - run.lastScanAt < SCAN_INTERVAL_MS) return;
  run.lastScanAt = now;
  let artifacts: HyperframesArtifact[];
  try {
    artifacts = scanArtifacts(run.runId);
  } catch {
    return;
  }
  const previous = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  const changed =
    artifacts.length !== run.artifacts.length ||
    artifacts.some((artifact) => previous.get(artifact.id)?.modifiedAt !== artifact.modifiedAt);
  if (!changed) return;
  const before = primaryVideo(run.artifacts);
  run.artifacts = artifacts;
  emit(run, "artifacts.updated", { artifacts });
  const video = primaryVideo(artifacts);
  if (video && (!before || before.id !== video.id || before.modifiedAt !== video.modifiedAt)) {
    run.renderCount += 1;
    emit(run, "render.completed", { video });
  }
}

/** Which CLI step a shell command represents, for the stage readout. */
function stageForCommand(command: string): RunStage | null {
  if (!/hyperframes/i.test(command)) return null;
  if (/\brender\b/i.test(command)) return "rendering";
  if (/\bcheck\b/i.test(command)) return "checking";
  if (/\blint\b/i.test(command)) return "linting";
  return null;
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
    run.runtimeError = text(value.message, 2_000) || "The video agent reported an error.";
    emit(run, "runtime.error", { error: run.runtimeError });
    return;
  }
  if (value.type === "turn.failed") {
    run.runtimeError = text(record(value.error).message, 2_000) || "The video agent's turn failed.";
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
    const stage = stageForCommand(title);
    if (stage) setStage(run, stage);
    run.toolCount += 1;
    emit(run, "tool.completed", { tool, title, summary, status });
    refreshArtifacts(run, { force: stage === "rendering" });
    return;
  }
  if (kind === "file_change") {
    tool = "apply_patch";
    title = "Wrote composition files";
    summary = fileChangeSummary(item);
    run.toolCount += 1;
    emit(run, "tool.completed", { tool, title, summary, status });
    refreshArtifacts(run);
    return;
  }
  if (kind === "mcp_tool_call") {
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

function launcherArgs(input: {
  projectPath: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
}): string[] {
  const effort = ["none", "low", "medium", "high", "xhigh"].includes(input.reasoningEffort)
    ? input.reasoningEffort
    : "high";
  // A scaffolded video project is not a Git repository, hence
  // `--skip-git-repo-check`. The sandbox choice matches the Codex agent's, and
  // for the same reason: the current native Windows CLI exposes
  // `workspace-write` as read-only unless its elevated sandbox is installed, so
  // an agent that must write a composition would silently fail there.
  const sandboxMode = process.platform === "win32" ? "danger-full-access" : "workspace-write";
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    sandboxMode,
    "--cd",
    input.projectPath,
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
    "-",
  ];
}

function finish(run: RunState, code: number | null): void {
  refreshArtifacts(run, { force: true });
  const elapsedSec = Math.max(0, (Date.now() - run.startedAt) / 1_000);
  const video = primaryVideo(run.artifacts);
  if (code === 0) {
    const summary =
      run.output.join("\n\n").trim() ||
      (video
        ? `Rendered ${video.name}.`
        : "The video agent finished without a rendered file.");
    run.status = "completed";
    emit(run, "run.completed", {
      summary,
      elapsedSec,
      toolCount: run.toolCount,
      artifacts: run.artifacts,
      video,
      renders: run.renderCount,
    });
    publishTerminal(run, { outcome: "completed", content: summary, usage: run.usage });
    return;
  }
  const error =
    run.runtimeError ||
    run.stderr.trim().split(/\r?\n/).slice(-1)[0] ||
    `The video agent exited with code ${code ?? "unknown"}`;
  run.status = "failed";
  emit(run, "run.failed", {
    error,
    elapsedSec,
    toolCount: run.toolCount,
    artifacts: run.artifacts,
  });
  publishTerminal(run, { outcome: "failed", content: error, usage: run.usage });
}

function spawnAgent(
  run: RunState,
  codex: CodexLauncher,
  toolchain: HyperframesToolchain,
  input: {
    projectPath: string;
    shimDirectory: string;
    model: string;
    reasoningEffort: string;
    baseUrl: string;
    apiKey: string;
    instruction: string;
  },
): void {
  const codexHome =
    process.env.CODEX_HOME?.trim() || path.resolve(process.cwd(), ".runtime", "codex-agent");
  // Codex refuses to start when CODEX_HOME names a directory that is not there.
  mkdirSync(codexHome, { recursive: true });
  const child = spawn(
    codex.command,
    launcherArgs({
      projectPath: input.projectPath,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
    }),
    {
      cwd: input.projectPath,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...hyperframesEnv(toolchain, process.env, [input.shimDirectory]),
        CODEX_HOME: codexHome,
        CHATMOCK_BASE_URL: input.baseUrl,
        CHATMOCK_API_KEY: input.apiKey,
        CHATMOCK_MODEL: input.model,
      },
    },
  ) as ChildProcessWithoutNullStreams;
  child.stdin.end(input.instruction);
  run.child = child;
  run.status = "running";
  setStage(run, "authoring");

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
  child.on("error", (error) => {
    childErrored = true;
    if (run.child === child) run.child = null;
    if (run.status === "aborted") return;
    run.status = "failed";
    emit(run, "run.failed", { error: error.message });
    publishTerminal(run, { outcome: "failed", content: error.message, usage: run.usage });
  });
  child.on("exit", (code) => {
    if (run.child === child) run.child = null;
    if (childErrored || run.status === "aborted") return;
    finish(run, code);
  });
}

export function startRun(input: {
  userId: number;
  brief: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  apiKey: string;
  /** The chat this was launched from, so a request can refer back to it. */
  conversationContext?: string;
}): { runId: string; status: RunStatus } {
  const availability = runtimeAvailability();
  if (!availability.available || !availability.toolchain.cli.found) {
    throw new Error(availability.reason ?? "The HyperFrames toolchain is unavailable.");
  }
  const codex = resolveCodexLauncher();
  if (!codex) {
    throw new Error(
      "The coding runtime that drives HyperFrames was not found. Install Codex or set CODEX_BIN.",
    );
  }
  const launcher = resolveLauncher();
  if (!launcher) throw new Error("The HyperFrames CLI was not found.");

  const runId = `hfrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.brief,
    status: "queued",
    stage: "scaffolding",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    output: [],
    startedAt: Date.now(),
    toolCount: 0,
    renderCount: 0,
    runtimeError: "",
    lastScanAt: 0,
    artifacts: [],
  };
  runs.set(runId, run);

  void (async () => {
    try {
      const workspace = await createWorkspace({
        runId,
        userId: input.userId,
        brief: input.brief,
        launcher,
        toolchain: availability.toolchain,
      });
      if (run.status === "aborted") return;
      const shimDirectory = writeCliShim(path.join(runDirectory(runId), "bin"), launcher);
      const promptInput = {
        projectDirectory: workspace.projectDirectory,
        outputRelativePath: OUTPUT_RELATIVE_PATH,
      };
      writeProjectGuidance(promptInput);
      emit(run, "run.started", {
        model: input.model,
        provider: "chatmock",
        cliVersion: launcher.version,
        cliSource: launcher.source,
        codexVersion: codex.version,
        browser: availability.toolchain.browser.source || "download on first render",
        scaffold: workspace.scaffold,
        ...(workspace.scaffoldWarning ? { scaffoldWarning: workspace.scaffoldWarning } : {}),
        outputPath: OUTPUT_RELATIVE_PATH,
      });
      refreshArtifacts(run, { force: true });
      spawnAgent(run, codex, availability.toolchain, {
        projectPath: workspace.projectDirectory,
        shimDirectory,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        instruction: promptWithContext(
          runInstruction({ ...promptInput, brief: input.brief }),
          input.conversationContext,
        ),
      });
    } catch (error) {
      if (run.status === "aborted") return;
      const message =
        error instanceof WorkspaceError || error instanceof Error
          ? error.message
          : "The video project could not be prepared.";
      run.status = "failed";
      emit(run, "run.failed", { error: message });
      publishTerminal(run, { outcome: "failed", content: message, usage: run.usage });
    }
  })();

  return { runId, status: run.status };
}

export function getEventsSince(userId: number, runId: string, since = 0): HyperframesEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/** Live artifacts for a run still held in memory, or null when it is not. */
export function liveArtifacts(userId: number, runId: string): HyperframesArtifact[] | null {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return null;
  return run.artifacts;
}

/**
 * Attaches durable transcript persistence after the run descriptor has been
 * recorded. A run that failed during scaffolding can already be terminal by the
 * time the caller subscribes, so a stored result is delivered immediately
 * instead of being lost between launch and subscription.
 */
export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: HyperframesTerminalResult) => void,
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
  refreshArtifacts(run, { force: true });
  emit(run, "run.aborted", {
    summary: "Video build stopped.",
    artifacts: run.artifacts,
  });
  publishTerminal(run, {
    outcome: "aborted",
    content: "Video build stopped.",
    usage: run.usage,
  });
  return true;
}

/** Where a run's project lives — used by the artifact routes. */
export function runProjectDirectory(runId: string): string {
  return projectDirectory(runId);
}
