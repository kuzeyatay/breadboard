// The OpenMontage agent: a Codex process, pinned to ChatMock, working inside
// the clone with its projects directory pointed at a per-run workspace.
//
// OpenMontage is a production system with no orchestrator of its own — upstream
// is explicit that "the AI agent IS the intelligence" and that Python holds only
// tools and persistence. There is nothing to wrap, so Breadboard supplies the
// missing half and keeps the production knowledge where upstream put it: the
// run prompt points at `AGENT_GUIDE.md` and the agent reads it. The model
// reaches ChatMock the same way `/agents:codex` does, so this agent answers on
// the same account and the same model picker as the rest of the app.
//
// Progress is not inferred from the shell. OpenMontage already writes its own
// state — a project marker, one checkpoint per completed stage, an append-only
// decision log — so the run polls those files and reports what the production
// says about itself. That is why the card can show "scene plan done, generating
// assets" and name the provider that was chosen, which no amount of watching
// command lines scroll past would give.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import { resolveCodexLauncher, type CodexLauncher } from "../codex/run-manager.ts";
import { runInstruction } from "./prompt.ts";
import { openMontageEnv, runtimeAvailability, type OpenMontageToolchain } from "./runtime.ts";
import {
  createRuntimeWorkspace,
  primaryVideo,
  readProductionStateFrom,
  scanOpenMontageArtifacts,
  WorkspaceError,
  type OpenMontageArtifact,
  type ProductionState,
} from "./workspace.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface OpenMontageEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  projectId: string;
  workspaceRoot: string;
  projectsRoot: string;
  status: RunStatus;
  sequence: number;
  events: OpenMontageEvent[];
  child: ChildProcess | null;
  stderr: string;
  output: string[];
  startedAt: number;
  toolCount: number;
  runtimeError: string;
  lastScanAt: number;
  artifacts: OpenMontageArtifact[];
  production: ProductionState | null;
  usage?: ChatTokenUsage;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardOpenMontageRuns?: Map<string, RunState>;
};
const runs = runtimeGlobal.__breadboardOpenMontageRuns ?? new Map<string, RunState>();
runtimeGlobal.__breadboardOpenMontageRuns = runs;

const MAX_EVENTS = 5_000;
const MAX_STDERR = 32_000;
const MAX_OUTPUT_PARTS = 200;
const MAX_STDOUT_RECORD_BYTES = 4 * 1024 * 1024;
const SCAN_INTERVAL_MS = 2_000;
const RUNTIME_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TERMINAL_STATUSES = new Set<RunStatus>(["completed", "failed", "aborted"]);

function directWorkspace(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  const normalize = (value: string) => {
    const normalized = path.normalize(path.resolve(value));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  try {
    const metadata = fs.lstatSync(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      normalize(fs.realpathSync.native(resolved)) !== normalize(resolved)
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

function productionChanged(before: ProductionState | null, after: ProductionState): boolean {
  if (!before) return true;
  return (
    before.projectId !== after.projectId ||
    before.title !== after.title ||
    before.pipelineType !== after.pipelineType ||
    before.currentStage !== after.currentStage ||
    before.completedStages.length !== after.completedStages.length ||
    before.decisions.length !== after.decisions.length ||
    before.spendUsd !== after.spendUsd
  );
}

/**
 * Re-read what the production wrote and publish what changed. Called after any
 * tool that can touch the workspace, so a completed stage or a logged decision
 * shows up while the run is still going rather than only at the end.
 */
function refresh(run: RunState, options: { force?: boolean } = {}): void {
  const now = Date.now();
  if (!options.force && now - run.lastScanAt < SCAN_INTERVAL_MS) return;
  run.lastScanAt = now;

  let production: ProductionState;
  try {
    production = readProductionStateFrom(run.projectsRoot);
  } catch {
    return;
  }
  if (productionChanged(run.production, production)) {
    const previousStage = run.production?.currentStage ?? null;
    run.production = production;
    emit(run, "production.updated", { production });
    if (production.currentStage && production.currentStage !== previousStage) {
      emit(run, "stage.completed", { stage: production.currentStage });
    }
  }

  let artifacts: OpenMontageArtifact[];
  try {
    artifacts = scanOpenMontageArtifacts(run.projectsRoot);
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
    emit(run, "render.completed", { video });
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
    run.runtimeError = text(value.message, 2_000) || "The production agent reported an error.";
    emit(run, "runtime.error", { error: run.runtimeError });
    return;
  }
  if (value.type === "turn.failed") {
    run.runtimeError =
      text(record(value.error).message, 2_000) || "The production agent's turn failed.";
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
    run.toolCount += 1;
    emit(run, "tool.completed", { tool, title, summary, status });
    // A render can take minutes and writes the deliverable at the very end, so
    // the scan after a command is the one that must not be rate-limited away.
    refresh(run, { force: true });
    return;
  }
  if (kind === "file_change") {
    tool = "apply_patch";
    title = "Wrote production files";
    summary = fileChangeSummary(item);
    run.toolCount += 1;
    emit(run, "tool.completed", { tool, title, summary, status });
    refresh(run);
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
  workingDirectory: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
}): string[] {
  const effort = ["none", "low", "medium", "high", "xhigh"].includes(input.reasoningEffort)
    ? input.reasoningEffort
    : "high";
  // The sandbox choice matches the Codex agent's, and for the same reason: the
  // current native Windows CLI exposes `workspace-write` as read-only unless its
  // elevated sandbox is installed, and an agent that cannot write its project
  // cannot make a video. The working directory is the clone, but a production's
  // writes are steered out of it by OPENMONTAGE_PROJECTS_DIR and by the prompt.
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
    input.workingDirectory,
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
  refresh(run, { force: true });
  const elapsedSec = Math.max(0, (Date.now() - run.startedAt) / 1_000);
  const video = primaryVideo(run.artifacts);
  if (code === 0) {
    const summary =
      run.output.join("\n\n").trim() ||
      (video
        ? `Rendered ${video.name}.`
        : "The production agent finished without a rendered video.");
    run.status = "completed";
    emit(run, "run.completed", {
      summary,
      elapsedSec,
      toolCount: run.toolCount,
      artifacts: run.artifacts,
      production: run.production,
      video,
    });
    return;
  }
  const error =
    run.runtimeError ||
    run.stderr.trim().split(/\r?\n/).slice(-1)[0] ||
    `The production agent exited with code ${code ?? "unknown"}`;
  run.status = "failed";
  emit(run, "run.failed", {
    error,
    elapsedSec,
    toolCount: run.toolCount,
    artifacts: run.artifacts,
    production: run.production,
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
  "FAL_KEY",
  "FAL_AI_API_KEY",
  "REPLICATE_API_TOKEN",
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
  "KLING_API_KEY",
  "KLING_API_BASE_URL",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DOUBAO_SPEECH_API_KEY",
  "DOUBAO_SPEECH_VOICE_TYPE",
  "DASHSCOPE_API_KEY",
  "SUNO_API_KEY",
  "HEYGEN_API_KEY",
  "RUNWAY_API_KEY",
  "VOLC_ACCESSKEY",
  "VOLC_SECRETKEY",
  "VIDEO_GEN_LOCAL_ENABLED",
  "VIDEO_GEN_LOCAL_MODEL",
  "MODAL_LTX2_ENDPOINT_URL",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "HF_TOKEN",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
] as const;

function childEnvironment(
  run: RunState,
  toolchain: OpenMontageToolchain,
  input: {
    root: string;
    projectsPath: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  },
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
    OPENMONTAGE_ROOT: input.root,
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
    ...openMontageEnv(toolchain, { projectsDirectory: input.projectsPath }, base),
    CODEX_HOME: codexHome,
    CHATMOCK_BASE_URL: input.baseUrl,
    CHATMOCK_API_KEY: input.apiKey,
    CHATMOCK_MODEL: input.model,
  };
}

function spawnAgent(
  run: RunState,
  codex: CodexLauncher,
  toolchain: OpenMontageToolchain,
  input: {
    workingDirectory: string;
    projectsPath: string;
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
      workingDirectory: input.workingDirectory,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
    }),
    {
      cwd: input.workingDirectory,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnvironment(run, toolchain, {
        root: input.workingDirectory,
        projectsPath: input.projectsPath,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
      }),
    },
  ) as ChildProcessWithoutNullStreams;
  child.stdin.end(input.instruction);
  run.child = child;
  run.status = "running";

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
      run.runtimeError = "The production agent emitted an oversized event.";
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
  if (!availability.available || !availability.root) {
    throw new Error(availability.reason ?? "The OpenMontage toolchain is unavailable.");
  }
  const codex = resolveCodexLauncher();
  if (!codex) {
    throw new Error(
      "The coding runtime that drives OpenMontage was not found. Install Codex or set CODEX_BIN.",
    );
  }
  const root = availability.root;

  if (!input.brief || !RUNTIME_JOB_ID.test(input.runtimeJobId) || runs.has(input.runtimeJobId)) {
    throw new Error("OpenMontage Runtime identity is invalid.");
  }
  const workspaceRoot = directWorkspace(input.runtimeWorkspacePath);
  if (!workspaceRoot) throw new Error("OpenMontage Runtime workspace is invalid.");
  const runId = input.runtimeJobId;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.brief,
    // Upstream project ids are directory names; deriving one from the run id
    // keeps the card, the workspace and the checkpoints naming the same thing.
    projectId: `production-${createHash("sha256").update(runId).digest("hex").slice(0, 13)}`,
    workspaceRoot,
    projectsRoot: path.join(workspaceRoot, "projects"),
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    stderr: "",
    output: [],
    startedAt: Date.now(),
    toolCount: 0,
    runtimeError: "",
    lastScanAt: 0,
    artifacts: [],
    production: null,
  };
  runs.set(runId, run);

  void (async () => {
    try {
      const workspace = await createRuntimeWorkspace(workspaceRoot);
      if (run.status === "aborted") return;
      emit(run, "run.started", {
        model: input.model,
        provider: "chatmock",
        codexVersion: codex.version,
        projectId: run.projectId,
        python: availability.toolchain.python.version,
        ffmpeg: availability.toolchain.ffmpeg.source,
        renderRuntimes: {
          ffmpeg: availability.toolchain.ffmpeg.found,
          remotion: availability.toolchain.remotion.found,
        },
      });
      spawnAgent(run, codex, availability.toolchain, {
        workingDirectory: root,
        projectsPath: workspace.projectsDirectory,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        instruction: promptWithContext(
          runInstruction({
            brief: input.brief,
            root,
            projectsDirectory: workspace.projectsDirectory,
            projectId: run.projectId,
          }),
          input.conversationContext,
        ),
      });
    } catch (error) {
      if (run.status === "aborted") return;
      const message =
        error instanceof WorkspaceError || error instanceof Error
          ? error.message
          : "The production workspace could not be prepared.";
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
): OpenMontageEvent[] {
  const run = requireRun(userId, runId);
  // A long stage can pass with no Codex event at all — assets generate inside a
  // single tool call. Polling here means the card still advances between them.
  if (run.status === "running") refresh(run);
  return run.events.filter((event) => event.sequenceNumber > since);
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
  refresh(run, { force: true });
  emit(run, "run.aborted", {
    summary: "Production stopped.",
    artifacts: run.artifacts,
    production: run.production,
  });
  return true;
}
