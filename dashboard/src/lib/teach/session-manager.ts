import "server-only";

// The teaching coordinator: one demonstration, start to saved workflow.
//
// It owns the recorder process, the narration file, the transcription, the
// timeline join, and the induction call. The browser drives it through an
// authenticated Breadboard API and can only say start / pause / resume /
// finish / cancel about a session it started -- it never touches a capture
// handle, a helper process, or the desktop.
//
// Every state transition is written to SQLite before it is acted on, because a
// dashboard restart in the middle of a demonstration must leave something a
// person can understand rather than a recorder nobody owns.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { demonstrationCaptureBackend, teachAvailability } from "./backends.ts";
import { compileProcedure } from "./compile.ts";
import { diffProcedures, induceProcedure, induceRevision, type ProcedureDiff } from "./induction.ts";
import { hasActiveCapture } from "./windows-capture.ts";
import { teachLog, teachWarn } from "./redaction.ts";
import * as store from "./store.ts";
import { buildDemonstrationTimeline, parseRecordedEvents } from "./timeline.ts";
import {
  readStoredTranscript,
  transcribeDemonstration,
  TranscriptionUnavailable,
  writeStoredTranscript,
} from "./transcription.ts";
import {
  discardSessionRecording,
  ensureDirectory,
  sessionDirectory,
  sessionFramesDirectory,
  sessionRecordingDirectory,
} from "./artifacts.ts";
import type {
  DemonstratedProcedure,
  DemonstrationTimeline,
  DemonstrationTranscript,
  TeachSessionSummary,
} from "./types.ts";

const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_FRAMES = 240;
const FRAME_MAX_WIDTH = 1280;

/** Windows belonging to Breadboard's own UI, so its controls never become steps. */
const HOST_APPLICATIONS = ["breadboard"];

export interface ProcessingStatus {
  stage: "transcribing" | "analysing" | "installing-speech" | "done";
  detail?: string;
}

interface Processing {
  promise: Promise<void>;
  status: ProcessingStatus;
  controller: AbortController;
}

const processingRegistry = (): Map<string, Processing> => {
  const holder = globalThis as typeof globalThis & {
    __breadboardTeachProcessing?: Map<string, Processing>;
  };
  if (!holder.__breadboardTeachProcessing) holder.__breadboardTeachProcessing = new Map();
  return holder.__breadboardTeachProcessing;
};

function audioPath(sessionId: string): string {
  return path.join(sessionRecordingDirectory(sessionId), "narration.webm");
}

function transcriptPath(sessionId: string): string {
  return path.join(sessionRecordingDirectory(sessionId), "transcript.json");
}

function eventLogPath(sessionId: string): string {
  return path.join(sessionRecordingDirectory(sessionId), "events.jsonl");
}

function timelinePath(sessionId: string): string {
  return path.join(sessionDirectory(sessionId), "timeline.json");
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export interface StartTeachingInput {
  userId: number;
  name?: string;
  objective?: string;
  reteachWorkflowId?: string | null;
  captureFrames?: boolean;
}

export interface StartTeachingResult {
  session: TeachSessionSummary;
  /** The recording's clock. The browser aligns its microphone against this. */
  startedAtEpochMs: number;
  screenDimensions: { width: number; height: number } | null;
}

/**
 * Begin capturing. Nothing has been recorded before this call.
 *
 * The session row exists before the recorder starts, so a recorder that starts
 * and is then lost is still attached to something the cleanup sweep can find.
 */
export async function startTeaching(input: StartTeachingInput): Promise<StartTeachingResult> {
  const availability = teachAvailability();
  if (!availability.available) throw new Error(availability.reason ?? "Teaching is unavailable here.");

  if (input.reteachWorkflowId) {
    const existing = store.getDemonstratedWorkflow(input.userId, input.reteachWorkflowId);
    if (!existing) throw new Error("That workflow cannot be re-taught.");
  }

  const row = store.createDemonstration({
    userId: input.userId,
    name: input.name?.trim() || "Untitled workflow",
    objective: input.objective,
    reteachWorkflowId: input.reteachWorkflowId ?? null,
  });

  const recordingDirectory = ensureDirectory(sessionRecordingDirectory(row.id));

  try {
    const capture = await demonstrationCaptureBackend().start({
      sessionId: row.id,
      outputDirectory: recordingDirectory,
      captureFrames: input.captureFrames !== false,
      maxFrames: MAX_FRAMES,
      frameMaxWidth: FRAME_MAX_WIDTH,
    });

    store.updateDemonstration(input.userId, row.id, {
      state: "recording",
      startedEpochMs: capture.startedAtEpochMs,
      framesAvailable: capture.framesDirectory !== null,
    });

    teachLog("session", "teaching session started", { sessionId: row.id });
    return {
      session: store.summarizeDemonstration(store.requireDemonstration(input.userId, row.id)),
      startedAtEpochMs: capture.startedAtEpochMs,
      screenDimensions: capture.screenDimensions,
    };
  } catch (error) {
    store.updateDemonstration(input.userId, row.id, {
      state: "failed",
      error: (error as Error).message,
      finishedAt: new Date().toISOString(),
    });
    discardSessionRecording(row.id);
    throw error;
  }
}

export async function pauseTeaching(userId: number, sessionId: string): Promise<TeachSessionSummary> {
  const row = store.requireDemonstration(userId, sessionId);
  if (row.state !== "recording") throw new Error("That session is not recording.");
  await demonstrationCaptureBackend().pause(sessionId);
  store.updateDemonstration(userId, sessionId, { state: "paused" });
  return store.summarizeDemonstration(store.requireDemonstration(userId, sessionId));
}

export async function resumeTeaching(userId: number, sessionId: string): Promise<TeachSessionSummary> {
  const row = store.requireDemonstration(userId, sessionId);
  if (row.state !== "paused") throw new Error("That session is not paused.");
  await demonstrationCaptureBackend().resume(sessionId);
  store.updateDemonstration(userId, sessionId, { state: "recording" });
  return store.summarizeDemonstration(store.requireDemonstration(userId, sessionId));
}

/**
 * Abandon a demonstration.
 *
 * The recording is deleted, not archived. A cancelled teaching session is one
 * the user decided should not exist, and keeping its screenshots and microphone
 * audio around because they might be useful later is exactly the behaviour a
 * cancel button is supposed to prevent.
 */
export async function cancelTeaching(userId: number, sessionId: string): Promise<TeachSessionSummary> {
  store.requireDemonstration(userId, sessionId);
  processingRegistry().get(sessionId)?.controller.abort();
  await demonstrationCaptureBackend().cancel(sessionId);
  const discarded = discardSessionRecording(sessionId);
  await fsp.rm(sessionDirectory(sessionId), { recursive: true, force: true }).catch(() => undefined);
  store.updateDemonstration(userId, sessionId, {
    state: "cancelled",
    finishedAt: new Date().toISOString(),
    draft: null,
    recordingRetained: false,
  });
  teachLog("session", "teaching session cancelled", {
    sessionId,
    reclaimedBytes: discarded.bytes,
  });
  return store.summarizeDemonstration(store.requireDemonstration(userId, sessionId));
}

export interface StoreNarrationInput {
  userId: number;
  sessionId: string;
  body: ReadableStream<Uint8Array> | null;
  /**
   * Where the microphone started relative to the recording clock, as measured by
   * the browser against the epoch `startTeaching` returned.
   */
  audioStartOffsetMs: number;
}

/** Save the browser's microphone recording beside the event log. */
export async function storeNarration(input: StoreNarrationInput): Promise<{ bytes: number }> {
  const row = store.requireDemonstration(input.userId, input.sessionId);
  if (row.state === "cancelled") throw new Error("That teaching session was cancelled.");
  if (!input.body) throw new Error("No narration was received.");

  ensureDirectory(sessionRecordingDirectory(input.sessionId));
  const target = audioPath(input.sessionId);
  const handle = await fsp.open(target, "w");
  let written = 0;
  try {
    const reader = input.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      written += value.byteLength;
      if (written > MAX_AUDIO_BYTES) {
        throw new Error("That narration recording is larger than a teaching session accepts.");
      }
      await handle.write(value);
    }
  } catch (error) {
    await handle.close();
    await fsp.rm(target, { force: true });
    throw error;
  }
  await handle.close();

  if (written === 0) {
    await fsp.rm(target, { force: true });
    throw new Error("The narration recording was empty.");
  }

  // A clock offset is a measurement, and a measurement from the browser is a
  // claim. A few seconds either way is plausible; a few hours is not.
  const clamped = Math.max(-5_000, Math.min(60_000, Math.round(input.audioStartOffsetMs)));
  store.updateDemonstration(input.userId, input.sessionId, { audioOffsetMs: clamped });
  teachLog("session", "narration stored", { sessionId: input.sessionId, bytes: written, offsetMs: clamped });
  return { bytes: written };
}

/**
 * Stop recording and start turning the demonstration into a procedure.
 *
 * Returns as soon as capture has stopped -- the machine is the user's again
 * immediately -- and the analysis continues in the background, reported through
 * the session's state.
 */
export async function finishTeaching(userId: number, sessionId: string): Promise<TeachSessionSummary> {
  const row = store.requireDemonstration(userId, sessionId);
  if (row.state !== "recording" && row.state !== "paused") {
    throw new Error("That session is not recording.");
  }

  const artifact = await demonstrationCaptureBackend().stop(sessionId);
  store.updateDemonstration(userId, sessionId, {
    state: "processing",
    durationMs: artifact.durationMs,
    eventCount: artifact.eventCount,
    finishedAt: new Date().toISOString(),
  });
  teachLog("session", "recording finished; analysis queued", {
    sessionId,
    durationMs: artifact.durationMs,
    eventCount: artifact.eventCount,
  });

  startProcessing(userId, sessionId);
  return store.summarizeDemonstration(store.requireDemonstration(userId, sessionId));
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

function startProcessing(userId: number, sessionId: string): void {
  const registry = processingRegistry();
  if (registry.has(sessionId)) return;

  const controller = new AbortController();
  const entry: Processing = {
    controller,
    status: { stage: "transcribing" },
    promise: Promise.resolve(),
  };
  registry.set(sessionId, entry);

  entry.promise = processDemonstration(userId, sessionId, entry)
    .catch((error: unknown) => {
      const message = (error as Error).message ?? "The demonstration could not be analysed.";
      teachWarn("session", "analysis failed", { sessionId, message });
      store.updateDemonstration(userId, sessionId, { state: "failed", error: message });
    })
    .finally(() => {
      registry.delete(sessionId);
    });
}

export function processingStatus(sessionId: string): ProcessingStatus | null {
  return processingRegistry().get(sessionId)?.status ?? null;
}

/**
 * Wait for an in-flight analysis to finish or unwind.
 *
 * Analysis is deliberately a background job, so a caller that needs it settled --
 * a shutdown, or a test that must not leave work running past its own end -- has
 * no other way to know when it has stopped touching the database.
 */
export async function awaitProcessing(sessionId: string): Promise<void> {
  const entry = processingRegistry().get(sessionId);
  if (!entry) return;
  await entry.promise.catch(() => undefined);
}

/**
 * Rebuild the timeline for a session from what is on disk.
 *
 * Separate from the analysis so a demonstration can be re-analysed, or shown on
 * the "view demonstration" screen, without transcribing again.
 */
export async function buildTimelineForSession(
  userId: number,
  sessionId: string,
): Promise<{ timeline: DemonstrationTimeline; transcript: DemonstrationTranscript | null }> {
  const row = store.requireDemonstration(userId, sessionId);
  const logPath = eventLogPath(sessionId);
  const contents = fs.existsSync(logPath) ? await fsp.readFile(logPath, "utf8") : "";
  const events = parseRecordedEvents(contents, row.started_epoch_ms);
  const transcript = await readStoredTranscript(transcriptPath(sessionId));

  const timeline = buildDemonstrationTimeline({
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    events,
    transcript: transcript?.segments ?? [],
    audioStartOffsetMs: transcript?.audioStartOffsetMs ?? row.audio_offset_ms,
    hostApplications: HOST_APPLICATIONS,
  });
  return { timeline, transcript };
}

async function processDemonstration(
  userId: number,
  sessionId: string,
  entry: Processing,
): Promise<void> {
  const row = store.requireDemonstration(userId, sessionId);

  // 1. Narration -> timed text, if there is any and the engine can be had.
  let transcript: DemonstrationTranscript | null = await readStoredTranscript(transcriptPath(sessionId));
  if (!transcript && fs.existsSync(audioPath(sessionId))) {
    entry.status = { stage: "transcribing" };
    try {
      transcript = await transcribeDemonstration({
        audioPath: audioPath(sessionId),
        audioStartOffsetMs: row.audio_offset_ms,
        signal: entry.controller.signal,
        onProgress: (progress) => {
          entry.status =
            progress.stage === "installing"
              ? { stage: "installing-speech", detail: progress.detail }
              : { stage: "transcribing", detail: progress.detail };
        },
      });
      await writeStoredTranscript(transcriptPath(sessionId), transcript);
      store.updateDemonstration(userId, sessionId, { transcriptAvailable: true });
    } catch (error) {
      if (entry.controller.signal.aborted) return;
      // A demonstration without narration is a weaker demonstration, not a
      // failed one. The analysis carries on and says the voice track is missing.
      const reason =
        error instanceof TranscriptionUnavailable ? error.message : (error as Error).message;
      teachWarn("session", "narration could not be transcribed; continuing without it", {
        sessionId,
        reason,
      });
      transcript = null;
    }
  }

  if (entry.controller.signal.aborted) return;

  // 2. Actions + narration -> one timeline.
  const { timeline } = await buildTimelineForSession(userId, sessionId);
  await fsp
    .writeFile(timelinePath(sessionId), JSON.stringify(timeline, null, 2), "utf8")
    .catch(() => undefined);

  if (timeline.events.filter((event) => event.importance === "high").length === 0) {
    throw new Error(
      "Nothing was captured from this demonstration. Check that the recording was running while you worked.",
    );
  }

  // 3. Timeline -> procedure.
  entry.status = { stage: "analysing" };
  const framesDirectory = sessionFramesDirectory(sessionId);
  const framesAvailable = fs.existsSync(framesDirectory);
  const context = {
    sessionId,
    recordedAt: row.started_at,
    durationMs: row.duration_ms,
    eventCount: timeline.events.length,
    transcriptAvailable: (transcript?.segments.length ?? 0) > 0,
    framesAvailable,
    videoAvailable: false,
    fallbackName: row.name || "Untitled workflow",
  };

  const request = {
    timeline,
    sessionId,
    frameRoot: framesAvailable ? sessionRecordingDirectory(sessionId) : undefined,
    nameHint: row.name || undefined,
    objectiveHint: row.objective || undefined,
    includeKeyframes: framesAvailable,
    signal: entry.controller.signal,
  };

  let draft: DemonstratedProcedure;
  if (row.reteach_workflow_id) {
    const existing = store.getDemonstratedWorkflow(userId, row.reteach_workflow_id);
    if (!existing) throw new Error("The workflow being re-taught no longer exists.");
    const revision = await induceRevision({ ...request, existing: existing.procedure }, context);
    draft = revision.procedure;
  } else {
    draft = await induceProcedure(request, context);
  }

  if (entry.controller.signal.aborted) return;

  store.updateDemonstration(userId, sessionId, {
    state: "review",
    draft,
    name: draft.name,
    error: null,
  });
  entry.status = { stage: "done" };
  teachLog("session", "analysis complete", {
    sessionId,
    steps: draft.steps.length,
    inputs: draft.inputs.length,
    questions: draft.ambiguities.length,
  });
}

/** What changed, for a re-teach's review screen. */
export function reteachDiff(userId: number, sessionId: string): ProcedureDiff | null {
  const row = store.getDemonstration(userId, sessionId);
  if (!row?.reteach_workflow_id) return null;
  const draft = store.readDraft(row);
  const existing = store.getDemonstratedWorkflow(userId, row.reteach_workflow_id);
  if (!draft || !existing) return null;
  return diffProcedures(existing.procedure, draft);
}

/* ------------------------------------------------------------------ *
 * Review and save
 * ------------------------------------------------------------------ */

export interface SaveTeachingInput {
  userId: number;
  sessionId: string;
  /** The edited procedure from the review screen, when the user changed anything. */
  procedure?: DemonstratedProcedure;
  /** Answers to the questions the analysis raised. */
  answers?: Record<string, string>;
  /** Keep the raw recording after compiling. Off by default. */
  retainRecording?: boolean;
}

export interface SaveTeachingResult {
  workflowId: string;
  version: number;
  procedure: DemonstratedProcedure;
}

/**
 * Turn a reviewed draft into a workflow.
 *
 * A re-teach saves a new version of the workflow it was correcting; a first
 * teach creates a new workflow row. Either way the compiled representation is
 * written before the version is recorded, so a saved version always has
 * something to run.
 */
export async function saveTeaching(input: SaveTeachingInput): Promise<SaveTeachingResult> {
  const row = store.requireDemonstration(input.userId, input.sessionId);
  if (row.state !== "review" && row.state !== "saved") {
    throw new Error("That demonstration has not been analysed yet.");
  }

  const base = input.procedure ?? store.readDraft(row);
  if (!base) throw new Error("There is no reviewed workflow to save.");

  const procedure = applyAnswers(base, input.answers ?? {});

  // Late import keeps the workflow store out of this module's import cycle:
  // lib/workflows owns the row, lib/teach owns the procedure on it.
  const workflows = await import("../workflows/store.ts");

  let workflowId = row.reteach_workflow_id ?? row.workflow_id;
  if (!workflowId) {
    const created = workflows.createWorkflow(input.userId, {
      name: procedure.name,
      description: procedure.description || procedure.goal,
    });
    workflowId = created.id;
  }

  const nextVersion =
    (store.getDemonstratedWorkflow(input.userId, workflowId)?.row.procedure_version ?? 0) + 1;
  const compiled = compileProcedure(workflowId, procedure, nextVersion);
  const withCompiled: DemonstratedProcedure = { ...procedure, compiled };

  const version = store.saveProcedureVersion({
    userId: input.userId,
    workflowId,
    procedure: withCompiled,
    compiledDirectory: compiled.directory,
    demonstrationId: input.sessionId,
    note: row.reteach_workflow_id ? "Revised from a second demonstration." : "Learned from a demonstration.",
  });

  store.updateDemonstration(input.userId, input.sessionId, {
    state: "saved",
    workflowId,
    draft: withCompiled,
    name: procedure.name,
  });

  // The workflow now runs from its compiled form. Whether the raw recording
  // survives is the user's call, and the default is that it does not: it is the
  // largest and most sensitive thing this feature produces, and nothing needs
  // it once the procedure exists.
  if (!input.retainRecording) {
    const discarded = discardSessionRecording(input.sessionId);
    store.updateDemonstration(input.userId, input.sessionId, { recordingRetained: false });
    teachLog("session", "raw demonstration discarded after compiling", {
      sessionId: input.sessionId,
      reclaimedBytes: discarded.bytes,
    });
  }

  teachLog("session", "workflow saved from demonstration", { workflowId, version });
  return { workflowId, version, procedure: withCompiled };
}

/**
 * Fold the review screen's answers into the procedure.
 *
 * An answered question becomes a constraint, so the reason a step behaves the
 * way it does survives into the thing that runs rather than living only in the
 * review UI where nobody will see it again.
 */
export function applyAnswers(
  procedure: DemonstratedProcedure,
  answers: Record<string, string>,
): DemonstratedProcedure {
  if (Object.keys(answers).length === 0) return procedure;
  const constraints = [...procedure.constraints];
  const ambiguities = procedure.ambiguities.map((ambiguity) => {
    const answer = answers[ambiguity.id];
    if (!answer) return ambiguity;
    const chosen = ambiguity.options.find((option) => option.id === answer || option.label === answer);
    const resolution = chosen?.label ?? answer;
    constraints.push({
      text: `${ambiguity.question} — ${resolution}`,
      kind: "always",
      source: "narration",
    });
    return { ...ambiguity, resolution };
  });
  return { ...procedure, constraints, ambiguities };
}

/* ------------------------------------------------------------------ *
 * Crash recovery
 * ------------------------------------------------------------------ */

/**
 * Close out sessions a restart orphaned.
 *
 * A row still marked `recording` after this process started means the recorder
 * that belonged to it is gone: its process died with the dashboard, or it is
 * running with nobody able to stop it. Either way the session is over, and
 * saying so is better than leaving a teaching UI that will wait forever.
 */
export function recoverOrphanedSessions(): { closed: number; resumed: number } {
  let closed = 0;
  let resumed = 0;

  for (const row of store.listLiveDemonstrations()) {
    // A session this process is still recording is not orphaned.
    if (processingRegistry().has(row.id)) continue;
    if (process.platform === "win32" && hasActiveCapture(row.id)) continue;

    store.updateDemonstration(row.user_id, row.id, {
      state: "failed",
      error: "Breadboard restarted while this demonstration was being recorded, so it was ended.",
      finishedAt: new Date().toISOString(),
    });
    discardSessionRecording(row.id);
    closed += 1;
  }

  // A demonstration that finished recording and was being analysed is a
  // different case: the recording is on disk and re-analysing it costs nothing
  // the user has to sit through twice, because the transcript was written before
  // the induction ran. That is worth resuming rather than throwing away.
  for (const row of store.listProcessingDemonstrations()) {
    if (processingRegistry().has(row.id)) continue;
    if (!fs.existsSync(eventLogPath(row.id))) {
      store.updateDemonstration(row.user_id, row.id, {
        state: "failed",
        error:
          "Breadboard restarted before this demonstration could be analysed, and its recording is no longer available.",
        finishedAt: row.finished_at ?? new Date().toISOString(),
      });
      closed += 1;
      continue;
    }
    teachLog("session", "resuming an analysis a restart interrupted", { sessionId: row.id });
    startProcessing(row.user_id, row.id);
    resumed += 1;
  }

  if (closed > 0 || resumed > 0) {
    teachLog("session", "recovered teaching sessions after a restart", { closed, resumed });
  }
  return { closed, resumed };
}
