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

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { resolveCodexLauncher, type CodexLauncher } from "../codex/run-manager.ts";
import {
  externalRuntimeLstat,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";
import { runInstruction, writeProjectGuidance } from "./prompt.ts";
import {
  hyperframesEnv,
  resolveLauncher,
  runtimeAvailability,
  writeCliShim,
  type HyperframesToolchain,
} from "./runtime.ts";
import {
  createRuntimeWorkspace,
  primaryVideo,
  scanHyperframesArtifacts,
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

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

/** The visible phases of a video build, in the order the CLI loop runs them. */
export type RunStage = "scaffolding" | "authoring" | "linting" | "checking" | "rendering";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  workspaceRoot: string;
  projectRoot: string;
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
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardHyperframesRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardHyperframesRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardHyperframesRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 32_000;
const MAX_OUTPUT_PARTS = 200;
const MAX_STDOUT_RECORD_BYTES = 4 * 1024 * 1024;
const SCAN_INTERVAL_MS = 1_500;
const OUTPUT_RELATIVE_PATH = "out/video.mp4";
const RUNTIME_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TERMINAL_STATUSES = new Set<RunStatus>(["completed", "failed", "aborted"]);

function directWorkspace(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  const normalize = (value: string) => {
    const normalized = path.normalize(path.resolve(value));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  try {
    const metadata = externalRuntimeLstat(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      normalize(externalRuntimeRealpath(resolved)) !== normalize(resolved)
    ) return null;
    return resolved;
  } catch {
    return null;
  }
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
    artifacts = scanHyperframesArtifacts(run.projectRoot);
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
  if (TERMINAL_STATUSES.has(run.status)) return;
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
}

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
  "FONTCONFIG_FILE",
  "FONTCONFIG_PATH",
] as const;

function childEnvironment(
  run: RunState,
  toolchain: HyperframesToolchain,
  input: { shimDirectory?: string; baseUrl: string; apiKey: string; model: string },
): NodeJS.ProcessEnv {
  const home = path.join(run.workspaceRoot, ".runtime-home");
  const temporary = path.join(run.workspaceRoot, ".runtime-temp");
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  const codexHome = path.join(home, ".codex");
  for (const directory of [home, temporary, appData, localAppData, codexHome]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
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
    if (value !== undefined) base[key] = value;
  }
  return {
    ...hyperframesEnv(toolchain, base, input.shimDirectory ? [input.shimDirectory] : []),
    CODEX_HOME: codexHome,
    CHATMOCK_BASE_URL: input.baseUrl,
    CHATMOCK_API_KEY: input.apiKey,
    CHATMOCK_MODEL: input.model,
  };
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
      env: childEnvironment(run, toolchain, input),
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
    if (
      Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(chunk, "utf8") >
      MAX_STDOUT_RECORD_BYTES
    ) {
      stdout = "";
      run.runtimeError = "The video agent emitted an oversized event.";
      try {
        child.kill();
      } catch {
        // Runtime remains the final process-tree authority.
      }
      return;
    }
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
  });
  child.on("exit", (code) => {
    if (run.child === child) run.child = null;
    if (childErrored || run.status === "aborted") return;
    finish(run, code);
  });
}

export function startRuntimeWorkerRun(input: {
  userId: number;
  runtimeJobId: string;
  runtimeWorkspacePath: string;
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

  if (!RUNTIME_JOB_ID.test(input.runtimeJobId) || runs.has(input.runtimeJobId)) {
    throw new Error("HyperFrames Runtime identity is invalid.");
  }
  const runId = input.runtimeJobId;
  const workspaceRoot = directWorkspace(input.runtimeWorkspacePath);
  if (!workspaceRoot) throw new Error("HyperFrames Runtime workspace is invalid.");
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.brief,
    workspaceRoot,
    projectRoot: path.join(workspaceRoot, "project"),
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
      const workspace = await createRuntimeWorkspace({
        runtimeWorkspacePath: workspaceRoot,
        launcher,
        toolchain: availability.toolchain,
        environment: childEnvironment(run, availability.toolchain, {
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          model: input.model,
        }),
        onChild: (child) => {
          if (run.status === "aborted") {
            try {
              child?.kill();
            } catch {
              // Runtime remains the final process-tree authority.
            }
            return;
          }
          run.child = child;
        },
      });
      if (run.status === "aborted") return;
      run.child = null;
      const shimDirectory = writeCliShim(path.join(workspaceRoot, "bin"), launcher);
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
    }
  })();

  return { runId, status: run.status };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): HyperframesEvent[] {
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
    // The process may have exited between the state check and kill.
  }
  refreshArtifacts(run, { force: true });
  emit(run, "run.aborted", {
    summary: "Video build stopped.",
    artifacts: run.artifacts,
  });
  return true;
}
