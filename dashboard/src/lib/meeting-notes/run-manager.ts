import "server-only";

// In-memory run manager for the Meeting Notes agent.
//
// A run is three steps with very different costs: find the recording (instant),
// transcribe it (minutes, and the whole reason there is a progress line), then
// walk the transcript in chunks writing notes (a model call per chunk). Each
// step emits, so a two-hour meeting shows something moving rather than a spinner
// for twenty minutes.
//
// Events are append-only with a sequence number, so the SSE route replays from a
// cursor and a reconnecting card catches up instead of starting blank. The
// terminal event carries the full written summary, because that summary is what
// gets saved as the message — a card that only streamed its answer would lose it
// on reload.

import { randomUUID } from "node:crypto";

import {
  closeMeetingArtifactContext,
  openMeetingArtifactContext,
  saveNotesArtifact,
  saveTranscriptArtifact,
  type MeetingArtifactContext,
} from "./artifact.ts";
import type { MeetingNotesRequest } from "./identity.ts";
import {
  isEmptySummary,
  renderMeetingNotesMarkdown,
  summarizeMeeting,
  type MeetingSummary,
} from "./notes.ts";
import { recordingBytes, resolveMeetingSource, SourceError } from "./source.ts";
import { summarizeRun, type MeetingTranscript } from "./report.ts";
import { transcribeMeeting, TranscriptionUnavailable } from "./transcribe.ts";
import { removeMeetingUpload } from "./uploads.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

// Re-exported so callers of the run manager need not know the split.
export { summarizeRun };

export interface MeetingNotesEvent {
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
  request: MeetingNotesRequest;
  status: RunStatus;
  sequence: number;
  events: MeetingNotesEvent[];
  summary: string;
  aborted: boolean;
  controller: AbortController;
  createdAt: number;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardMeetingNotesRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardMeetingNotesRuns ?? new Map<string, RunState>();
globalRuns.__breadboardMeetingNotesRuns = runs;

const MAX_EVENTS = 2_000;
/**
 * Transcribing a long meeting can outlast any plausible tab switch, and the
 * notes are the only reason the person started it — so a run stays readable for
 * a day rather than the ten minutes a quick agent uses.
 */
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RUNS = 40;

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
  // A run id must never be readable by another account.
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function evict(): void {
  const now = Date.now();
  for (const [runId, run] of runs) {
    if (now - run.createdAt > RETENTION_MS) runs.delete(runId);
  }
  if (runs.size <= MAX_RUNS) return;
  const ordered = [...runs.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt);
  for (const [runId] of ordered.slice(0, runs.size - MAX_RUNS)) runs.delete(runId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  conversationPublicId: string;
  request: MeetingNotesRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  /** The chat this was launched from, so a request can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartRunInput): { runId: string; status: RunStatus } {
  evict();
  const runId = `mnrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    summary: "",
    aborted: false,
    controller: new AbortController(),
    createdAt: Date.now(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    run.summary = error instanceof Error ? error.message : "The meeting notes run failed.";
    emit(run, "run.failed", { error: run.summary, summary: run.summary });
  });
  return { runId, status: "queued" };
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  const request = run.request;
  run.status = "running";
  emit(run, "run.started", {
    source: request.source.kind,
    transcriptOnly: request.transcriptOnly,
    model: input.model,
  });

  // ---- 1. find the meeting -------------------------------------------------
  emit(run, "source.resolving", {});
  let resolved;
  try {
    resolved = resolveMeetingSource({
      userId: run.userId,
      conversationPublicId: run.conversationPublicId,
      source: request.source,
      fallbackTitle: "Meeting",
    });
  } catch (error) {
    // A missing recording is the most common way this run ends, and it is not a
    // crash — it is an instruction. It reads as one.
    throw new Error(
      error instanceof SourceError
        ? error.message
        : "The recording could not be read.",
    );
  }
  const sourceLabel =
    resolved.kind === "transcript"
      ? "a transcript you provided"
      : `${resolved.filename}${
          request.source.kind === "auto" ? " (the newest recording in this chat)" : ""
        }`;
  emit(run, "source.resolved", {
    kind: resolved.kind,
    label: sourceLabel,
    ...(resolved.kind === "audio"
      ? { byteSize: recordingBytes(resolved.path), artifactId: resolved.artifactId }
      : {}),
  });

  // ---- 2. transcribe -------------------------------------------------------
  let transcript: MeetingTranscript | null = null;
  let transcriptText: string;
  if (resolved.kind === "transcript") {
    transcriptText = resolved.text;
  } else {
    emit(run, "transcribe.started", { filename: resolved.filename });
    try {
      transcript = await transcribeMeeting({
        userId: run.userId,
        audioPath: resolved.path,
        filename: resolved.filename,
        title: resolved.title,
        language: request.language,
        speakers: request.speakers,
        signal: run.controller.signal,
        onProgress: (stage) => emit(run, "transcribe.progress", { stage }),
      });
    } catch (error) {
      if (run.aborted) return;
      throw new Error(
        error instanceof TranscriptionUnavailable
          ? error.message
          : error instanceof Error
            ? error.message
            : "The recording could not be transcribed.",
      );
    }
    transcriptText = transcript.text;
    emit(run, "transcribe.completed", {
      engine: transcript.engine,
      speakers: transcript.speakers,
      characters: transcriptText.length,
    });
    // The staged upload has served its purpose; the durable form is the
    // transcript artifact, and a 2 GB recording is not worth keeping for it.
    if (request.source.kind === "upload") {
      try {
        removeMeetingUpload({ userId: run.userId, uploadId: request.source.uploadId });
      } catch {
        // The daily sweep will get it.
      }
    }
  }
  if (run.aborted) return;

  // ---- 3. write the notes --------------------------------------------------
  let summary: MeetingSummary | null = null;
  let markdown: string;
  let chunks = 0;
  let failedChunks = 0;

  if (request.transcriptOnly) {
    markdown = transcriptText;
  } else {
    emit(run, "notes.started", { characters: transcriptText.length });
    const written = await summarizeMeeting({
      transcript: transcriptText,
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      // Context only when the person actually directed the summary; with no
      // direction there is nothing for an earlier message to qualify.
      customPrompt: request.prompt
        ? promptWithContext(request.prompt, input.conversationContext)
        : request.prompt,
      signal: run.controller.signal,
      progress: {
        onChunkStart: (index, total) => emit(run, "notes.chunk", { index: index + 1, total }),
        onRetry: (index, attempt, reason) =>
          emit(run, "notes.retry", { index: index + 1, attempt, reason }),
      },
    });
    if (run.aborted) return;
    summary = written.summary;
    chunks = written.chunks;
    failedChunks = written.failedChunks;
    emit(run, "run.usage", { ...written.usage });
    if (isEmptySummary(summary)) {
      throw new Error(
        "Nothing could be read out of that transcript — it may be too short, or not a meeting.",
      );
    }
    markdown = renderMeetingNotesMarkdown(summary);
    emit(run, "notes.completed", {
      meetingName: summary.meetingName,
      sections: summary.sections
        .filter((section) => section.blocks.length)
        .map((section) => ({ title: section.title, blocks: section.blocks.length })),
    });
  }

  // ---- 4. keep it ----------------------------------------------------------
  let notesArtifactId: string | null = null;
  let transcriptArtifactId: string | null = null;
  let artifactProblem: string | null = null;
  const context: MeetingArtifactContext | null = openMeetingArtifactContext({
    userId: run.userId,
    conversationPublicId: run.conversationPublicId,
    label: summary?.meetingName || "Meeting notes",
    agentRunId: run.runId,
  });

  if (!context) {
    // Silently dropping the file is the one unacceptable outcome, so the run
    // says it out loud and still hands back the notes in the message.
    artifactProblem =
      "The notes could not be filed as an artifact in this chat, so they are only in this message.";
  } else {
    try {
      if (summary) {
        notesArtifactId = saveNotesArtifact({
          context,
          summary,
          markdown,
          transcriptEngine: transcript?.engine ?? "none",
          speakers: transcript?.speakers ?? [],
          sourceLabel,
        }).id;
      }
      if (transcript) {
        transcriptArtifactId = saveTranscriptArtifact({
          context,
          transcript,
          title: summary?.meetingName || resolved.title,
        }).id;
      }
      closeMeetingArtifactContext(context, "completed");
    } catch (error) {
      closeMeetingArtifactContext(context, "failed");
      artifactProblem = `The notes could not be saved as an artifact (${
        error instanceof Error ? error.message : "unknown error"
      }), so they are only in this message.`;
    }
    emit(run, "artifacts.saved", { notesArtifactId, transcriptArtifactId });
  }

  run.summary = summarizeRun({
    markdown,
    transcript,
    notesArtifactId,
    transcriptArtifactId,
    sourceLabel,
    failedChunks,
    chunks,
    artifactProblem,
  });
  run.status = "completed";
  emit(run, "run.completed", {
    summary: run.summary,
    meetingName: summary?.meetingName ?? "",
    notesArtifactId,
    transcriptArtifactId,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
}

// ---------------------------------------------------------------------------
// Read/control API
// ---------------------------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): MeetingNotesEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  // Stopping means stopping: the transcription job and the model call both take
  // the signal, so neither keeps burning after the card says it stopped.
  run.controller.abort();
  run.summary = "The meeting notes run was stopped.";
  emit(run, "run.aborted", { summary: run.summary });
  return true;
}
