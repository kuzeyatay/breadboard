import "server-only";

// Keeping the notes.
//
// A meeting's notes are the thing somebody opens next week, so they are an
// artifact rather than a long chat message — and an artifact belongs to exactly
// one conversation. The context is opened from the `conversationPublicId`
// carried from the launching chat, never by looking up "the current chat" when
// the run finishes: by then the person may be somewhere else entirely.
//
// Two artifacts come out of a run, and they are deliberately separate. The notes
// are what the meeting was for. The transcript is the evidence underneath them,
// and it is worth keeping on its own because it is the expensive part to
// reproduce — the notes can always be rewritten from it without listening to two
// hours of audio again.

import {
  createArtifact,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import type { MeetingSummary } from "./notes.ts";
import type { MeetingTranscript } from "./transcribe.ts";

export const MEETING_NOTES_TOOL = "meeting_notes_write";

export interface MeetingArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** The chat turn these notes belong to, so the card sits under it. */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation the run
 * started in, and open a run for the notes to hang off. Returns null when the
 * conversation has no runtime session — the caller then says so plainly rather
 * than silently dropping the file.
 */
export function openMeetingArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  /** The Meeting Notes run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): MeetingArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (
      conversation.surface !== "dashboard_terminal" &&
      conversation.surface !== "garden_chat"
    ) {
      return null;
    }
    const session = getRuntimeSessionByConversation(conversation.id);
    if (!session) return null;
    const hermesSessionId = runtimeExternalSessionId(session);
    if (!hermesSessionId) return null;

    const run = beginRuntimeRun({
      runtimeSessionId: session.id,
      instruction: input.label.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.label.slice(0, 4_000),
      },
    });

    return {
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      runtimeSessionId: session.id,
      hermesSessionId,
      conversationId: conversation.id,
      clusterId:
        conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
      assistantMessageId:
        findExternalAgentAssistantMessage({
          conversationId: conversation.id,
          runId: input.agentRunId,
        })?.id ?? null,
    };
  } catch {
    return null;
  }
}

export function closeMeetingArtifactContext(
  context: MeetingArtifactContext | null,
  status: "completed" | "failed",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(context.runId, status === "completed" ? "completed" : "error");
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

function safeFilename(title: string, extension: string): string {
  const base =
    title
      .replace(/[^a-z0-9 _-]+/gi, " ")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "meeting";
  return `${base}.${extension}`;
}

/** Store the notes as a markdown artifact bound to the chat that made them. */
export function saveNotesArtifact(input: {
  context: MeetingArtifactContext;
  summary: MeetingSummary;
  markdown: string;
  transcriptEngine: string;
  speakers: string[];
  sourceLabel: string;
}): ArtifactRow {
  const title = input.summary.meetingName || "Meeting notes";
  return createArtifact({
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    surface: input.context.surface,
    kind: "markdown",
    rendererId: "markdown",
    title: title.slice(0, 240),
    filename: safeFilename(title, "md"),
    mimeType: "text/markdown; charset=utf-8",
    content: input.markdown,
    metadata: {
      meetingNotes: true,
      meetingName: input.summary.meetingName,
      meetingSections: input.summary.sections.map((section) => ({
        title: section.title,
        blocks: section.blocks.length,
      })),
      transcriptEngine: input.transcriptEngine,
      speakers: input.speakers,
      recordingSource: input.sourceLabel,
    },
    sourceHermesTool: MEETING_NOTES_TOOL,
  });
}

/** Store the transcript itself, so the notes can be rewritten without the audio. */
export function saveTranscriptArtifact(input: {
  context: MeetingArtifactContext;
  transcript: MeetingTranscript;
  title: string;
}): ArtifactRow {
  const title = `${input.title} — transcript`;
  const header = [
    `# ${input.title} — transcript`,
    "",
    `Transcribed by ${input.transcript.engine === "scriberr" ? "Scriberr (WhisperX)" : "the local speech model"}.`,
    input.transcript.speakers.length
      ? `Speakers: ${input.transcript.speakers.join(", ")}.`
      : "No speaker separation.",
    "",
  ].join("\n");
  return createArtifact({
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    surface: input.context.surface,
    kind: "markdown",
    rendererId: "markdown",
    title: title.slice(0, 240),
    filename: safeFilename(title, "md"),
    mimeType: "text/markdown; charset=utf-8",
    content: `${header}${input.transcript.text}`,
    metadata: {
      meetingTranscript: true,
      transcriptEngine: input.transcript.engine,
      speakers: input.transcript.speakers,
      language: input.transcript.language,
      durationSeconds: input.transcript.durationSeconds,
    },
    sourceHermesTool: MEETING_NOTES_TOOL,
  });
}
