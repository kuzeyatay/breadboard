import "server-only";

import fs from "node:fs";
import {
  listArtifactsForUser,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { promptWithContext } from "../conversations/agent-context.ts";
import {
  closeMeetingArtifactContext,
  openMeetingArtifactContext,
  saveNotesArtifact,
  saveTranscriptArtifact,
} from "./artifact.ts";
import {
  isEmptySummary,
  renderMeetingNotesMarkdown,
  summarizeMeeting,
  type MeetingSummary,
} from "./notes.ts";
import { summarizeRun, type MeetingTranscript } from "./report.ts";
import { transcribeRuntimeMeeting } from "./runtime-transcribe.ts";

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
  status: RunStatus;
  sequence: number;
  events: MeetingNotesEvent[];
  controller: AbortController;
  createdAt: number;
}

export interface RuntimeMeetingNotesInput {
  userId: number;
  runtimeJobId: string;
  runtimeWorkspacePath: string;
  runtimeInputPath: string;
  conversationPublicId: string;
  request: {
    sourceKind: "upload" | "artifact" | "attachment" | "transcript" | "auto";
    prompt: string;
    language: string | null;
    speakers: boolean;
    transcriptOnly: boolean;
  };
  source: {
    kind: "audio" | "transcript" | "error";
    filename: string;
    title: string;
    label: string;
    artifactId: string | null;
    byteSize: number;
    error: string | null;
  };
  engine: "scriberr" | "voicebox" | "none";
  voiceboxModel: string;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext: string;
}

const runs = new Map<string, RunState>();
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({ sequenceNumber: run.sequence, type, payload, at: new Date().toISOString() });
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function artifactMetadata(artifact: ArtifactRow): Record<string, unknown> {
  try {
    const value = JSON.parse(artifact.metadata_json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function existingArtifacts(input: RuntimeMeetingNotesInput): {
  notes: ArtifactRow | null;
  transcript: ArtifactRow | null;
} {
  const artifacts = listArtifactsForUser({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  }).filter((artifact) => artifact.status === "ready" &&
    artifactMetadata(artifact).meetingNotesRuntimeJobId === input.runtimeJobId);
  return {
    notes: artifacts.find((artifact) => artifactMetadata(artifact).meetingNotesArtifactRole === "notes") ?? null,
    transcript: artifacts.find((artifact) => artifactMetadata(artifact).meetingNotesArtifactRole === "transcript") ?? null,
  };
}

function readTranscript(filePath: string): string {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_TRANSCRIPT_BYTES) {
    throw new Error("That transcript is too large.");
  }
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) throw new Error("That transcript is empty.");
  if (text.length > 2_000_000) throw new Error("That transcript is too large.");
  return text;
}

async function drive(run: RunState, input: RuntimeMeetingNotesInput): Promise<void> {
  const request = input.request;
  run.status = "running";
  emit(run, "run.started", {
    source: request.sourceKind,
    transcriptOnly: request.transcriptOnly,
    model: input.model,
  });
  emit(run, "source.resolving", {});
  if (input.source.kind === "error") {
    throw new Error(input.source.error || "The recording could not be read.");
  }
  emit(run, "source.resolved", {
    kind: input.source.kind,
    label: input.source.label,
    ...(input.source.kind === "audio"
      ? { byteSize: input.source.byteSize, artifactId: input.source.artifactId }
      : {}),
  });

  let transcript: MeetingTranscript | null = null;
  let transcriptText: string;
  if (input.source.kind === "transcript") {
    transcriptText = readTranscript(input.runtimeInputPath);
  } else {
    emit(run, "transcribe.started", { filename: input.source.filename });
    transcript = await transcribeRuntimeMeeting({
      engine: input.engine,
      audioPath: input.runtimeInputPath,
      filename: input.source.filename,
      title: input.source.title,
      language: request.language,
      speakers: request.speakers,
      voiceboxModel: input.voiceboxModel,
      workspacePath: input.runtimeWorkspacePath,
      signal: run.controller.signal,
      onProgress: (stage) => emit(run, "transcribe.progress", { stage }),
    });
    transcriptText = transcript.text;
    emit(run, "transcribe.completed", {
      engine: transcript.engine,
      speakers: transcript.speakers,
      characters: transcriptText.length,
    });
  }
  if (run.controller.signal.aborted) return;

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
    if (run.controller.signal.aborted) return;
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

  let { notes, transcript: transcriptArtifact } = existingArtifacts(input);
  let artifactProblem: string | null = null;
  if ((summary && !notes) || (transcript && !transcriptArtifact)) {
    const context = openMeetingArtifactContext({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      label: summary?.meetingName || "Meeting notes",
      agentRunId: input.runtimeJobId,
    });
    if (!context) {
      artifactProblem =
        "The notes could not be filed as an artifact in this chat, so they are only in this message.";
    } else {
      try {
        if (summary && !notes) {
          notes = saveNotesArtifact({
            context,
            summary,
            markdown,
            transcriptEngine: transcript?.engine ?? "none",
            speakers: transcript?.speakers ?? [],
            sourceLabel: input.source.label,
            runtimeJobId: input.runtimeJobId,
          });
        }
        if (transcript && !transcriptArtifact) {
          transcriptArtifact = saveTranscriptArtifact({
            context,
            transcript,
            title: summary?.meetingName || input.source.title,
            runtimeJobId: input.runtimeJobId,
          });
        }
        closeMeetingArtifactContext(context, "completed");
      } catch (error) {
        closeMeetingArtifactContext(context, "failed");
        artifactProblem = `The notes could not be saved as an artifact (${
          error instanceof Error ? error.message : "unknown error"
        }), so they are only in this message.`;
      }
    }
  }
  emit(run, "artifacts.saved", {
    notesArtifactId: notes?.id ?? null,
    transcriptArtifactId: transcriptArtifact?.id ?? null,
  });

  const writtenSummary = summarizeRun({
    markdown,
    transcript,
    notesArtifactId: notes?.id ?? null,
    transcriptArtifactId: transcriptArtifact?.id ?? null,
    sourceLabel: input.source.label,
    failedChunks,
    chunks,
    artifactProblem,
  });
  run.status = "completed";
  emit(run, "run.completed", {
    summary: writtenSummary,
    meetingName: summary?.meetingName ?? "",
    notesArtifactId: notes?.id ?? null,
    transcriptArtifactId: transcriptArtifact?.id ?? null,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
}

export function startRuntimeWorkerRun(
  input: RuntimeMeetingNotesInput,
): { runId: string; status: RunStatus } {
  const run: RunState = {
    runId: input.runtimeJobId,
    userId: input.userId,
    status: "queued",
    sequence: 0,
    events: [],
    controller: new AbortController(),
    createdAt: Date.now(),
  };
  runs.set(run.runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.status === "aborted") return;
    run.status = "failed";
    const summary = error instanceof Error ? error.message : "The meeting notes run failed.";
    emit(run, "run.failed", { error: summary, summary });
  });
  return { runId: run.runId, status: run.status };
}

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): MeetingNotesEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.controller.abort();
  run.status = "aborted";
  emit(run, "run.aborted", { summary: "The meeting notes run was stopped." });
  return true;
}
