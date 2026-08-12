// In-memory run manager for the Video Use agent.
//
// One run is one pass of the clone's pipeline over one video:
//
//   adopt source → probe → transcribe (cached) → pack → plan → render → publish
//
// Breadboard drives it rather than a wrapped process, because the clone has no
// runtime — it is a skill and a set of helpers. What that buys is that every
// stage is addressable: the transcript is cached against the artifact, the plan
// is a revision of the stored program rather than a fresh idea, and the render
// publishes a *version* of an artifact that already exists.
//
// Runs are ephemeral and the events live here for the SSE route to replay. The
// artifact is what is durable — which is deliberate: someone who closes the tab
// mid-render comes back to a finished video in the archive, not to a lost run.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ArtifactRow } from "../hermes/artifact-store.ts";
import type { PresentedArtifact } from "../hermes/artifact-types.ts";
import {
  artifactOutputFile,
  assignArtifactToAssistantTurn,
  closeVideoUseArtifactContext,
  openVideoUseArtifactContext,
  programForArtifact,
  publishEditedVideo,
  requireVideoArtifact,
  VIDEO_USE_METADATA,
  type VideoUseArtifactContext,
} from "./artifact.ts";
import {
  videoUseRunLabel,
  type VideoUseRequest,
} from "./identity.ts";
import { detectSilences, probeVideo, renderSilenceMap, type VideoProbe } from "./media.ts";
import { planEdit, VideoPlanError } from "./plan.ts";
import {
  identityProgram,
  programDurationSeconds,
  type VideoEditProgram,
} from "./program.ts";
import { renderProgram, VideoRenderError } from "./render.ts";
import {
  invalidateHealth,
  resolveVideoUseRoot,
  videoUseHealth,
} from "./runtime.ts";
import {
  discardSession,
  findSession,
  openSession,
  type VideoEditSession,
} from "./session.ts";
import {
  clipPackedTranscript,
  hasTranscript,
  packTranscript,
  transcribeSource,
  TranscriptError,
} from "./transcript.ts";
import { findVideoBlob, type StoredVideoBlob } from "../conversations/video-blob-store.ts";
import { attachVideoToExternalAgentUserTurn } from "../conversations/external-agent-turns.ts";
import type { ChatMessageAttachment } from "../chat-attachments.ts";
import { videoSourceFor } from "../video-sources/identity.ts";
import { resolveSpeechEngine } from "./speech.ts";
import { ensureVideoSource } from "../video-sources/resolve.ts";
import {
  createImportedArtifact,
  deleteArtifact,
  getArtifactById,
} from "../hermes/artifact-store.ts";

export interface VideoUseRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  conversationPublicId: string;
  request: VideoUseRequest;
  label: string;
  status: RunStatus;
  sequence: number;
  events: VideoUseRunEvent[];
  controller: AbortController;
  context: VideoUseArtifactContext | null;
  createdAt: number;
  /**
   * The artifact *this run* created to hold the untouched source, while it
   * still holds only that. Null for an edit of a video that already existed,
   * which the run is a guest of and must never remove.
   */
  adoptedArtifactId: string | null;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardVideoUseRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardVideoUseRuns ?? new Map<string, RunState>();
globalRuns.__breadboardVideoUseRuns = runs;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 60 * 60 * 1000;

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

function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

export interface StartVideoUseRunInput {
  userId: number;
  conversationPublicId: string;
  request: VideoUseRequest;
  /** The chat's model — what plans the cut, through ChatMock. */
  model: string;
  reasoningEffort?: string;
  /** ChatMock's OpenAI-compatible base URL, already resolved for this request. */
  baseUrl: string;
}

export function startRun(input: StartVideoUseRunInput): { runId: string; status: RunStatus } {
  const health = videoUseHealth();
  if (!health.available) {
    throw new Error(health.reason ?? "Video Use is not ready on this machine.");
  }

  const sourceName =
    input.request.source.kind === "attachment"
      ? input.request.source.filename
      : input.request.source.kind === "url"
        ? (videoSourceFor(input.request.source.url)?.label ?? "video")
        : "video";
  const runId = `vurun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    request: input.request,
    label: videoUseRunLabel({ prompt: input.request.prompt, sourceName }),
    status: "queued",
    sequence: 0,
    events: [],
    controller: new AbortController(),
    context: null,
    createdAt: Date.now(),
    adoptedArtifactId: null,
  };
  runs.set(runId, run);

  run.context = openVideoUseArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    label: run.label,
    agentRunId: runId,
  });

  void drive(run, input).catch((error) => {
    finish(run, "failed", {
      error: error instanceof Error ? error.message : "The edit could not be completed.",
    });
  });

  return { runId, status: "queued" };
}

/**
 * Adopt the video this run edits.
 *
 * An upload becomes an artifact *before* anything is edited, with the original
 * as version 1. That costs one copy and buys three things: the person sees
 * their video in the chat straight away, "revert to the original" is just an
 * older version rather than a special case, and every later prompt has a
 * durable id to address.
 *
 * It is adopted as `generating`, not as `ready`. Version one is a byte-copy of
 * what the person just handed over, so publishing it as a finished artifact
 * puts a downloadable "result" in the transcript that is identical to the
 * input — and if the run then dies before the render, that is all they are left
 * with. A loading card says the true thing until `publishEditedVideo` turns it
 * into the edit, and `discardAdoptedArtifact` removes it if that never happens.
 */
async function adoptSource(
  run: RunState,
  request: VideoUseRequest,
  conversationPublicId: string,
): Promise<{
  artifact: ArtifactRow;
  session: VideoEditSession;
  sourceName: string;
  sourceAttachment?: Extract<ChatMessageAttachment, { type: "video" }>;
}> {
  if (request.source.kind === "artifact") {
    const artifact = requireVideoArtifact({
      userId: run.userId,
      conversationPublicId,
      artifactId: request.source.artifactId,
    });
    const existing = findSession(run.userId, artifact.id);
    const session =
      existing ??
      openSession({
        userId: run.userId,
        artifactId: artifact.id,
        // A video from another agent — a cut short, a rendered film — has no
        // session yet. Its current file becomes this session's original, which
        // is the honest reading: that file is what the person is looking at.
        originalPath: artifactOutputFile(artifact),
      });
    const metadata = artifact.metadata_json ? JSON.parse(artifact.metadata_json) : {};
    const storedName = (metadata as Record<string, unknown>)[VIDEO_USE_METADATA.sourceName];
    return {
      artifact,
      session,
      sourceName: typeof storedName === "string" && storedName ? storedName : artifact.title,
    };
  }

  // A link is fetched here rather than before the run, so the wait has a
  // progress line and a stop button instead of a frozen composer. The fetch is
  // cached by video identity, so a second edit of the same link — or an edit
  // after the Watch skill already looked at it — is a lookup.
  let staged: StoredVideoBlob | null;
  let sourceName: string;
  if (request.source.kind === "url") {
    const linked = videoSourceFor(request.source.url);
    if (!linked) throw new Error("That link does not name a single video this can fetch.");

    emit(run, "stage.updated", {
      stage: "fetch",
      status: "running",
      label: "Fetching the video",
    });
    const fetched = await ensureVideoSource({
      userId: run.userId,
      source: linked,
      signal: run.controller.signal,
      onProgress: (progress) => {
        emit(run, "fetch.progress", { percent: progress.percent, detail: progress.detail });
      },
    });
    emit(run, "stage.updated", {
      stage: "fetch",
      status: "done",
      label: fetched.cached ? "Already downloaded" : "Downloaded",
    });
    staged = fetched.blob;
    sourceName = `${fetched.title || linked.label}.${fetched.blob.format}`;
  } else {
    staged = findVideoBlob({ userId: run.userId, blobId: request.source.blobId });
    sourceName = request.source.filename;
    if (!staged) {
      throw new Error("That attached video is no longer available. Attach it again.");
    }
  }

  if (!run.context) {
    throw new Error(
      "This chat has no runtime session yet, so the video could not be stored. Send a message first, then try again.",
    );
  }

  const created = createImportedArtifact({
    userId: run.context.userId,
    runtimeSessionId: run.context.runtimeSessionId,
    hermesSessionId: run.context.hermesSessionId,
    conversationId: run.context.conversationId,
    clusterId: run.context.clusterId,
    runId: run.context.runId,
    assistantMessageId: null,
    toolCallId: null,
    surface: run.context.surface,
    kind: "video",
    title: path.parse(sourceName).name.slice(0, 240) || "Video",
    filename: sourceName,
    authorizedRoot: path.dirname(staged.path),
    filePath: staged.path,
    parentArtifactId: null,
    metadata: {
      [VIDEO_USE_METADATA.sourceName]: sourceName,
      videoUseOriginal: true,
      ...(request.source.kind === "url" ? { videoUseSourceUrl: request.source.url } : {}),
    },
    sourceHermesTool: "video_use_import",
    status: "generating",
  });
  run.adoptedArtifactId = created.id;

  // The blob is left where it is: it belongs to the message that carried it and
  // is swept when that message goes. The session keeps its own copy, which is
  // what every later revision replays against.
  const session = openSession({
    userId: run.userId,
    artifactId: created.id,
    originalPath: staged.path,
  });
  return {
    artifact: created,
    session,
    sourceName,
    sourceAttachment: {
      type: "video",
      name: sourceName,
      blobId: staged.blobId,
      format: staged.format,
      sizeBytes: staged.byteSize,
    },
  };
}

/**
 * The run starts before its external-agent turn is persisted, because the
 * browser needs a run id to store in that turn. A cached URL can therefore be
 * adopted before its user row exists. Wait briefly for that row rather than
 * dropping the attachment; a fresh download normally finds it on the first
 * attempt, while a cache hit needs only one event-loop turn.
 */
async function attachSourceToUserTurn(
  run: RunState,
  attachment: Extract<ChatMessageAttachment, { type: "video" }>,
): Promise<boolean> {
  if (!run.context) return false;
  const deadline = Date.now() + 5_000;
  do {
    const stored = attachVideoToExternalAgentUserTurn({
      conversationId: run.context.conversationId,
      runId: run.runId,
      attachment,
    });
    if (stored) return true;
    if (run.controller.signal.aborted) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 50);
      timer.unref?.();
    });
  } while (Date.now() < deadline);
  return false;
}

async function drive(run: RunState, input: StartVideoUseRunInput): Promise<void> {
  const runtime = resolveVideoUseRoot();
  if (!runtime) throw new Error("The video-use clone was not found next to the dashboard.");

  run.status = "running";
  emit(run, "run.started", { label: run.label, prompt: run.request.prompt });

  const { artifact, session, sourceName, sourceAttachment } = await adoptSource(
    run,
    run.request,
    input.conversationPublicId,
  );
  const sourceAttached = sourceAttachment
    ? await attachSourceToUserTurn(run, sourceAttachment)
    : false;
  // Waiting for the user turn above is also the point at which the assistant
  // turn exists, so the card can be put under the response that is producing it
  // rather than floating in the transcript's unassigned pile until the edit
  // publishes — which, on a failed run, is never.
  if (run.adoptedArtifactId && run.context) {
    assignArtifactToAssistantTurn(run.context, run.adoptedArtifactId);
  }
  emit(run, "source.ready", {
    artifactId: artifact.id,
    sourceName,
    version: artifact.current_version,
    ...(sourceAttachment ? { sourceAttachment, sourceAttached } : {}),
  });

  const probe = await probeVideo(session.sourcePath, run.controller.signal);
  emit(run, "source.probed", {
    durationSeconds: Math.round(probe.durationSeconds * 10) / 10,
    width: probe.width,
    height: probe.height,
    hasAudio: probe.hasAudio,
  });
  throwIfAborted(run);

  // --- reading the video -------------------------------------------------
  const notes: string[] = [];
  let packed: string | null = null;
  let silenceMap: string | null = null;

  // Both engines are local and both produce the same file at the same path, so
  // the run only has to know whether *one* of them will answer. Only "no speech
  // at all" sends the plan to the silence map.
  const engine = probe.hasAudio ? await resolveSpeechEngine() : null;
  if (probe.hasAudio && engine) {
    const cached = hasTranscript(session);
    emit(run, "stage.updated", {
      stage: "transcribe",
      status: "running",
      label: cached ? "Reading the cached transcript" : "Transcribing the audio on this machine",
    });
    try {
      const transcribed = await transcribeSource({
        session,
        engine,
        durationSeconds: probe.durationSeconds,
        signal: run.controller.signal,
        onProgress: (stage) =>
          emit(run, "stage.updated", { stage: "transcribe", status: "running", label: stage }),
      });
      if (transcribed) {
        packed = await packTranscript({
          session,
          root: runtime.root,
          signal: run.controller.signal,
        });
      }
      emit(run, "stage.updated", {
        stage: "transcribe",
        status: "done",
        label: packed ? (cached ? "Transcript (cached)" : "Transcript ready") : "No speech found",
      });
    } catch (error) {
      // A speech-to-text failure narrows the edit; it does not end it.
      const message =
        error instanceof TranscriptError ? error.message : "The audio could not be transcribed.";
      notes.push(message);
      emit(run, "stage.updated", { stage: "transcribe", status: "failed", label: message });
    }
  } else if (probe.hasAudio) {
    notes.push(
      "Speech-to-text is not running, so this edit was planned from the silence map rather than from what was said. Start Scriberr, or build the local subtitle engine, in Video Use's settings — either one unlocks filler-word cuts and burned captions.",
    );
  }
  throwIfAborted(run);

  if (!packed) {
    emit(run, "stage.updated", {
      stage: "silences",
      status: "running",
      label: "Mapping the silences",
    });
    try {
      const windows = probe.hasAudio
        ? await detectSilences(session.sourcePath, { signal: run.controller.signal })
        : [];
      silenceMap = probe.hasAudio
        ? renderSilenceMap(windows, probe.durationSeconds)
        : "This video has no audio track.";
      emit(run, "stage.updated", {
        stage: "silences",
        status: "done",
        label: `${windows.length} gap${windows.length === 1 ? "" : "s"} found`,
      });
    } catch {
      silenceMap = "The audio could not be analysed.";
      emit(run, "stage.updated", { stage: "silences", status: "failed", label: "No silence map" });
    }
  }
  throwIfAborted(run);

  // --- planning ----------------------------------------------------------
  const program = programForArtifact(artifact, probe.durationSeconds);
  emit(run, "stage.updated", { stage: "plan", status: "running", label: "Planning the cut" });
  const planned = await planEdit({
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    root: runtime.root,
    probe,
    program,
    packedTranscript: packed ? clipPackedTranscript(packed) : null,
    silenceMap,
    prompt: run.request.prompt,
    signal: run.controller.signal,
    onTransportRetry: (detail) =>
      emit(run, "stage.updated", { stage: "plan", status: "running", label: detail }),
  });
  emit(run, "plan.ready", {
    summary: planned.program.summary,
    cuts: planned.program.ranges.length,
    runtimeSeconds: programDurationSeconds(planned.program),
    aspect: planned.program.aspect,
    grade: planned.program.grade,
    subtitles: planned.program.subtitles,
    repaired: planned.repaired,
    usage: planned.usage,
  });
  throwIfAborted(run);

  // --- rendering ---------------------------------------------------------
  emit(run, "stage.updated", { stage: "render", status: "running", label: "Assembling the cut" });
  const rendered = await renderProgram({
    session,
    root: runtime.root,
    program: planned.program,
    quality: run.request.quality,
    signal: run.controller.signal,
    onProgress: (progress) => {
      emit(run, "render.progress", { stage: progress.stage, detail: progress.detail ?? "" });
    },
  });
  emit(run, "stage.updated", { stage: "render", status: "done", label: "Rendered" });
  throwIfAborted(run);

  // --- publishing --------------------------------------------------------
  if (!run.context) {
    throw new Error(
      "The edit finished but this chat has no runtime session, so it could not be stored.",
    );
  }
  const history = [
    ...program.history,
    {
      version: artifact.current_version + 1,
      prompt: run.request.prompt,
      summary: planned.program.summary,
      at: new Date().toISOString(),
    },
  ].slice(-60);

  const stored = publishEditedVideo({
    context: run.context,
    artifact,
    workspace: session.root,
    renderedPath: rendered.outputPath,
    rendered,
    program: planned.program,
    history,
    prompt: run.request.prompt,
    sourceName,
    sourceDurationSeconds: probe.durationSeconds,
    title: artifact.title,
  });
  // Published: the artifact now holds the version that was asked for, so it is
  // the deliverable rather than this run's scratch copy of the input.
  run.adoptedArtifactId = null;
  emit(run, "artifact.stored", {
    artifactId: stored.id,
    version: stored.version,
    title: stored.title,
  });

  complete(run, {
    artifact: stored,
    summary: composeSummary({
      artifact: stored,
      plan: planned.program,
      rendered,
      sourceDurationSeconds: probe.durationSeconds,
      notes,
    }),
    notes,
  });
}

function throwIfAborted(run: RunState): void {
  if (run.controller.signal.aborted) throw new Error("The edit was stopped.");
}

/**
 * The chat reply. Short on purpose: the video is the deliverable and its card
 * sits directly under this message, so the transcript points at it rather than
 * restating it.
 */
export function composeSummary(input: {
  artifact: PresentedArtifact;
  plan: { summary: string; ranges: unknown[]; aspect: string; subtitles: string };
  rendered: { durationSeconds: number };
  sourceDurationSeconds: number;
  notes: string[];
}): string {
  const before = formatDuration(input.sourceDurationSeconds);
  const after = formatDuration(input.rendered.durationSeconds);
  const facts = [
    `${input.plan.ranges.length} cut${input.plan.ranges.length === 1 ? "" : "s"}`,
    before === after ? after : `${before} → ${after}`,
    input.plan.aspect !== "original" ? input.plan.aspect : "",
    input.plan.subtitles === "burn" ? "captions burned in" : "",
  ].filter(Boolean);

  return [
    input.plan.summary,
    `**${input.artifact.title}** · version ${input.artifact.version} · ${facts.join(" · ")}`,
    "Open it to keep editing in the studio.",
    ...input.notes.map((note) => `_${note}_`),
  ].join("\n\n");
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes}:${String(total % 60).padStart(2, "0")}` : `${total}s`;
}

function complete(
  run: RunState,
  payload: { artifact: PresentedArtifact; summary: string; notes: string[] },
): void {
  if (isTerminalStatus(run.status)) return;
  closeVideoUseArtifactContext(run.context, "completed");
  run.context = null;
  run.status = "completed";
  emit(run, "run.completed", {
    summary: payload.summary,
    artifactId: payload.artifact.id,
    version: payload.artifact.version,
    notes: payload.notes,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  invalidateHealth();
  scheduleCleanup(run);
}

function finish(run: RunState, status: RunStatus, payload: Record<string, unknown>): void {
  if (isTerminalStatus(run.status)) return;
  run.status = status;
  closeVideoUseArtifactContext(run.context, status === "aborted" ? "aborted" : "failed");
  run.context = null;
  emit(run, status === "aborted" ? "run.aborted" : "run.failed", {
    ...payload,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  void discardAdoptedArtifact(run);
  scheduleCleanup(run);
}

/**
 * A run that produced nothing leaves nothing behind.
 *
 * The source is adopted as an artifact before the edit is planned, so when the
 * run dies first — a stopped edit, an unreachable model — that artifact holds
 * only a copy of the video the person handed over. Left in place it reads as
 * the answer: a video card, downloadable, identical to the input, sitting under
 * a turn that failed. Take it and its session with the run instead, so a retry
 * starts clean rather than editing the leftovers.
 */
async function discardAdoptedArtifact(run: RunState): Promise<void> {
  const artifactId = run.adoptedArtifactId;
  if (!artifactId) return;
  run.adoptedArtifactId = null;
  // Belt and braces: a version past the first is an edit somebody asked for,
  // and no failure of a later run may remove it.
  const artifact = getArtifactById(artifactId);
  if (artifact && artifact.current_version > 1) return;
  try {
    await deleteArtifact({
      artifactId,
      userId: run.userId,
      conversationPublicId: run.conversationPublicId,
    });
  } catch {
    // An artifact that will not delete is clutter, not a second failure to
    // report on top of the one that got us here.
  }
  discardSession(run.userId, artifactId);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => runs.delete(run.runId), RETENTION_MS);
  timer.unref?.();
}

export function getEventsSince(userId: number, runId: string, since = 0): VideoUseRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return isTerminalStatus(requireRun(userId, runId).status);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (isTerminalStatus(run.status)) return false;
  run.controller.abort();
  finish(run, "aborted", {
    summary: "The edit was stopped before it finished rendering.",
  });
  return true;
}

export { VideoPlanError, VideoRenderError };

/** Used by the studio to show what a stored artifact currently is. */
export function describeStoredProgram(artifactId: string): VideoEditProgram | null {
  const artifact = getArtifactById(artifactId);
  if (!artifact) return null;
  const metadata = JSON.parse(artifact.metadata_json || "{}") as Record<string, unknown>;
  const duration = Number(metadata[VIDEO_USE_METADATA.sourceDurationSeconds]);
  return programForArtifact(
    artifact,
    Number.isFinite(duration) && duration > 0 ? duration : 0,
  );
}

/** Best-effort probe of a session's original, for the studio's header. */
export async function sourceProbeFor(
  userId: number,
  artifactId: string,
): Promise<VideoProbe | null> {
  const session = findSession(userId, artifactId);
  if (!session || !fs.existsSync(session.sourcePath)) return null;
  try {
    return await probeVideo(session.sourcePath);
  } catch {
    return null;
  }
}

export { identityProgram };
