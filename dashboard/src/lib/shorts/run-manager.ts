// Worker-local run manager for the Shorts agent.
//
// Breadboard does not drive a tool loop here: the cloned project owns the whole
// pipeline — download, transcribe, rank, cut, reframe — and there is no point
// reimplementing any of it. Breadboard starts the bridge
// (scripts/shorts-bridge.py) inside the clone's environment, points its LLM step
// at ChatMock through the OpenAI SDK's own base-URL variable, and turns the
// bridge's NDJSON into the event stream every other agent publishes.
//
// One fresh Runtime V2 process owns each run and its complete Python/Whisper/
// ffmpeg tree. The public functions at the bottom are the thin Next facade over
// Rust's durable job ledger. Cut clips remain durable conversation artifacts.

import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  closeShortsArtifactContext,
  discardWorkspace,
  openShortsArtifactContext,
  publishClip,
  type PublishedClip,
  type ShortsArtifactContext,
  type ShortsClip,
} from "./artifact.ts";
import {
  shortsRunLabel,
  shortsSourceLabel,
  type ShortsRequest,
} from "./identity.ts";
import {
  bridgeScriptPath,
  invalidateHealth,
  resolveShortsRoot,
  shortsEnv,
  venvPython,
  workspaceDirectory,
} from "./runtime.ts";
import { resolveUpload } from "./uploads.ts";

export interface ShortsRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  request: ShortsRequest;
  label: string;
  status: RunStatus;
  sequence: number;
  events: ShortsRunEvent[];
  child: ChildProcess | null;
  aborted: boolean;
  /** Where this run's clips are written before they become artifacts. */
  workspace: string;
  context: ShortsArtifactContext | null;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardShortsRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardShortsRuns ?? new Map<string, RunState>();
globalRuns.__breadboardShortsRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 30 * 60 * 1000;
// Downloading an hour of video, transcribing it on a CPU and re-encoding ten
// clips is genuinely long, and the first run also fetches a Whisper model.
const RUN_TIMEOUT_MS = 3 * 60 * 60 * 1000;

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

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export interface StartShortsRunInput {
  userId: number;
  requestId?: string;
  conversationPublicId: string;
  request: ShortsRequest;
  /** The chat's model — what ranks the transcript, through ChatMock. */
  model: string;
  /** Whisper size from the agent's settings: tiny / base / small / medium. */
  whisperModel: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
}

export interface ShortsRuntimeWorkerRunInput extends StartShortsRunInput {
  runtimeJobId?: string;
  runtimeWorkspacePath?: string;
  apiKey: string;
}

/** Fixed worker-local entrypoint. Next routes must call durable `startRun`. */
export function startRuntimeWorkerRun(
  input: ShortsRuntimeWorkerRunInput,
): { runId: string; status: RunStatus } {
  const runtime = resolveShortsRoot();
  if (!runtime) {
    throw new Error("The AI-Youtube-Shorts-Generator clone was not found next to the dashboard.");
  }
  const python = venvPython(runtime.root);
  if (!python) {
    throw new Error(
      "Shorts has no Python environment yet. Build its environment from its settings first.",
    );
  }
  const bridge = bridgeScriptPath();
  if (!bridge) throw new Error("Breadboard's Shorts bridge script is missing.");

  // An uploaded video is resolved here, inside the user's own store: the
  // request only ever carried an id, and this is the one place that turns one
  // into a path.
  let source: string;
  if (input.request.source.kind === "upload") {
    const stored = resolveUpload(input.userId, input.request.source.uploadId);
    if (!stored) {
      throw new Error("That uploaded video is no longer available. Choose it again.");
    }
    source = stored;
  } else {
    source = input.request.source.url;
  }

  const runId = input.runtimeJobId ?? `shrun_${randomUUID().replaceAll("-", "")}`;
  const workspace = input.runtimeWorkspacePath
    ? path.join(input.runtimeWorkspacePath, "clips")
    : path.join(workspaceDirectory(), `run_${runId}`);
  fs.mkdirSync(workspace, { recursive: true });

  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    label: shortsRunLabel(input.request),
    status: "queued",
    sequence: 0,
    events: [],
    child: null,
    aborted: false,
    workspace,
    context: null,
    createdAt: Date.now(),
  };
  runs.set(runId, run);

  // Opened before the pipeline runs so each clip has a run to hang off; a
  // conversation with no runtime session yet simply produces no artifacts, and
  // the run still reports what it cut.
  run.context = openShortsArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    label: run.label,
    agentRunId: runId,
  });

  try {
    drive(run, input, { python, bridge, root: runtime.root, source });
  } catch (error) {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The run could not start.",
    });
  }
  return { runId, status: run.status === "failed" ? "failed" : "queued" };
}

function drive(
  run: RunState,
  input: ShortsRuntimeWorkerRunInput,
  paths: { python: string; bridge: string; root: string; source: string },
): void {
  const job = {
    source: paths.source,
    clipCount: run.request.clipCount,
    aspectRatio: run.request.aspectRatio,
    resolution: run.request.resolution,
    language: run.request.language,
    clipDir: run.workspace,
    model: input.model,
  };

  const child = spawn(paths.python, [paths.bridge], {
    cwd: paths.root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: shortsEnv({
      SHORTS_CLONE_ROOT: paths.root,
      // Downloads and cached transcripts are shared across runs; only the cut
      // clips are per-run, and those go to clipDir above.
      LOCAL_OUTPUT_DIR: workspaceDirectory(),
      // The clone's local LLM step is the OpenAI SDK, which reads its endpoint
      // from these. Pointing them at ChatMock is what makes the ranking run on
      // Breadboard's own models with no key and no change to the checkout.
      LLM_PROVIDER: "openai",
      OPENAI_BASE_URL: normalizeBaseUrl(input.baseUrl),
      OPENAI_API_KEY: input.apiKey,
      OPENAI_MODEL: input.model,
      LOCAL_WHISPER_MODEL: input.whisperModel || "base",
      LOCAL_WHISPER_DEVICE: process.env.SHORTS_WHISPER_DEVICE?.trim() || "auto",
    }),
  });
  run.child = child;
  run.status = "running";
  emit(run, "run.started", {
    label: run.label,
    source: shortsSourceLabel(run.request.source),
    sourceKind: run.request.source.kind,
    clipCount: run.request.clipCount,
    aspectRatio: run.request.aspectRatio,
    resolution: run.request.resolution,
    model: input.model,
  });

  const timer = setTimeout(() => {
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    run.aborted = true;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    finish(run, "failed", { error: "The run passed its time limit and was stopped." });
  }, RUN_TIMEOUT_MS);
  timer.unref?.();

  let stdoutBuffer = "";
  let stderrTail = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) handleBridgeLine(run, line);
      newline = stdoutBuffer.indexOf("\n");
    }
    // A single event should never be this long; if it is, the stream is not
    // NDJSON and holding on to it only grows memory.
    if (stdoutBuffer.length > 4_000_000) stdoutBuffer = "";
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-8_000);
  });

  child.on("error", (error) => {
    clearTimeout(timer);
    if (run.aborted) return;
    finish(run, "failed", { error: `The run could not start: ${error.message}` });
  });

  child.on("exit", (code) => {
    clearTimeout(timer);
    run.child = null;
    if (["completed", "failed", "aborted"].includes(run.status)) return;
    if (run.aborted) return;
    // The bridge reports its own failures as events; reaching here means it
    // died without saying why, so the stderr tail is the only explanation.
    const detail = stderrTail.split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
    finish(run, "failed", {
      error:
        code === 0
          ? "The run ended without producing any clips."
          : `The run stopped unexpectedly (exit ${code ?? "unknown"}).`,
      detail,
    });
  });

  try {
    child.stdin?.write(`${JSON.stringify(job)}\n`);
    child.stdin?.end();
  } catch (error) {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The request could not be sent.",
    });
  }
}

/** ChatMock is mounted at /v1; the SDK appends the rest of the path itself. */
function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

/** Translate one bridge event into the run's own event stream. */
function handleBridgeLine(run: RunState, line: string): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return; // Not an event — library chatter that escaped the redirect.
  }
  const type = text(event.type);

  if (type === "stage") {
    emit(run, "stage.updated", {
      stage: text(event.stage),
      status: text(event.status, "pending"),
      label: text(event.label),
    });
    return;
  }

  if (type === "source") {
    emit(run, "source.ready", { sizeBytes: count(event.sizeBytes) });
    return;
  }

  if (type === "transcript") {
    emit(run, "transcript.ready", {
      segments: count(event.segments),
      durationSec: Math.round(count(event.durationSec)),
    });
    return;
  }

  if (type === "highlights") {
    emit(run, "highlights.ready", {
      found: count(event.found),
      kept: count(event.kept),
      items: Array.isArray(event.items) ? event.items.slice(0, 20) : [],
    });
    return;
  }

  if (type === "clip") {
    const status = text(event.status);
    emit(run, status === "completed" ? "clip.cut" : status === "failed" ? "clip.failed" : "clip.started", {
      index: count(event.index),
      total: count(event.total),
      title: text(event.title),
      ...(status === "completed"
        ? {
            durationSec: Math.round(count(event.durationSec)),
            score: count(event.score),
          }
        : {}),
      ...(status === "failed" ? { error: text(event.error) } : {}),
    });
    return;
  }

  if (type === "completed") {
    const clips = readClips(event.clips);
    void completeRun(run, clips, count(event.elapsedSec));
    return;
  }

  if (type === "failed") {
    finish(run, "failed", {
      error: text(event.error, "The run failed."),
      detail: text(event.detail).split(/\r?\n/).slice(-8).join("\n"),
    });
  }
}

function readClips(value: unknown): ShortsClip[] {
  if (!Array.isArray(value)) return [];
  const clips: ShortsClip[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const filePath = text(record.path);
    if (!filePath) continue;
    clips.push({
      index: count(record.index) || clips.length + 1,
      title: text(record.title, "Untitled"),
      startSec: count(record.startSec),
      endSec: count(record.endSec),
      durationSec: count(record.durationSec),
      score: count(record.score),
      hook: text(record.hook),
      reason: text(record.reason),
      path: filePath,
      sizeBytes: count(record.sizeBytes),
    });
  }
  return clips;
}

/**
 * Import every cut clip, then close the run. Storing happens here rather than
 * in the bridge because an artifact belongs to a conversation, which is a
 * Breadboard concept the clone knows nothing about.
 */
async function completeRun(
  run: RunState,
  clips: ShortsClip[],
  elapsedSec: number,
): Promise<void> {
  if (["completed", "failed", "aborted"].includes(run.status)) return;

  const published: PublishedClip[] = [];
  const sourceLabel = shortsSourceLabel(run.request.source);
  for (const clip of clips) {
    if (!run.context) {
      published.push({ ...clip, artifactId: null, filename: "" });
      continue;
    }
    const stored = await publishClip({
      context: run.context,
      clip,
      workspace: run.workspace,
      sourceLabel,
    });
    published.push(stored);
    if (stored.artifactId) {
      emit(run, "clip.stored", {
        index: stored.index,
        title: stored.title,
        artifactId: stored.artifactId,
      });
    }
  }

  const attached = published.filter((clip) => clip.artifactId).length;
  closeShortsArtifactContext(run.context, "completed");
  run.context = null;
  discardWorkspace(run.workspace);

  run.status = "completed";
  emit(run, "run.completed", {
    summary: composeSummary(run.request, published, attached),
    clips: published.map((clip) => ({
      index: clip.index,
      title: clip.title,
      startSec: Math.round(clip.startSec * 10) / 10,
      endSec: Math.round(clip.endSec * 10) / 10,
      durationSec: Math.round(clip.durationSec),
      score: clip.score,
      hook: clip.hook,
      artifactId: clip.artifactId,
    })),
    clipCount: published.length,
    attached,
    elapsedSec,
  });
  invalidateHealth();
  scheduleCleanup(run);
}

/**
 * The chat reply. Short on purpose: the clips are the deliverable and their own
 * cards sit directly under this message, so the transcript points at them
 * rather than restating them.
 */
export function composeSummary(
  request: ShortsRequest,
  clips: PublishedClip[],
  attached: number,
): string {
  const source = shortsSourceLabel(request.source);
  const lines = [
    `Cut **${clips.length} short${clips.length === 1 ? "" : "s"}** at ${request.aspectRatio} from ${source}.`,
  ];
  for (const clip of clips) {
    const window = `${formatTimecode(clip.startSec)}–${formatTimecode(clip.endSec)}`;
    const detail = [`${Math.round(clip.durationSec)}s`, `score ${clip.score}`].join(" · ");
    lines.push(
      `**${clip.index}. ${clip.title}** — ${window} (${detail})${
        clip.hook ? `\n> ${clip.hook}` : ""
      }`,
    );
  }
  if (attached < clips.length) {
    lines.push(
      attached === 0
        ? "The clips were cut but could not be attached to this conversation."
        : `${clips.length - attached} clip${clips.length - attached === 1 ? "" : "s"} could not be attached to this conversation.`,
    );
  }
  return lines.join("\n\n");
}

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (["completed", "failed", "aborted"].includes(run.status)) return;
  run.status = status;
  closeShortsArtifactContext(run.context, status === "aborted" ? "aborted" : "failed");
  run.context = null;
  discardWorkspace(run.workspace);
  emit(run, status === "completed" ? "run.completed" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  invalidateHealth();
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): ShortsRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  try {
    run.child?.kill();
  } catch {
    // It may have exited between the state check and the kill.
  }
  run.child = null;
  closeShortsArtifactContext(run.context, "aborted");
  run.context = null;
  discardWorkspace(run.workspace);
  emit(run, "run.aborted", {
    summary: "The run was stopped before any clip was finished.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}

/** Public durable facade. Runtime V2 owns the complete media process tree. */
export async function startRun(
  input: StartShortsRunInput,
): Promise<{ runId: string; status: RunStatus }> {
  const { startOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return startOuterAgentRun({
    kind: "shorts",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      request: input.request,
      conversationPublicId: input.conversationPublicId,
      model: input.model,
      whisperModel: input.whisperModel,
      baseUrl: input.baseUrl,
    },
  }) as Promise<{ runId: string; status: RunStatus }>;
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<ShortsRunEvent[]> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  const view = await readOuterAgentRunView("shorts", userId, runId, since);
  return view.events as ShortsRunEvent[];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  const { readOuterAgentRunView } = await import("../runtime-v2/outer-agent-run.ts");
  return (await readOuterAgentRunView("shorts", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  const { abortOuterAgentRun } = await import("../runtime-v2/outer-agent-run.ts");
  return abortOuterAgentRun("shorts", userId, runId);
}
