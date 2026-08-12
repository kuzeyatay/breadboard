// The edited video as a Breadboard artifact.
//
// One video is one artifact, for its whole life. The first edit creates it, and
// every later prompt publishes a new version of that same id — same card in the
// transcript, same place in the archive, one history. That is what makes the
// studio coherent: "make it shorter", then "actually keep the intro", then "now
// vertical" is one thing being worked on, not three files.
//
// The edit program travels in the artifact's metadata, which is what lets any
// surface pick the video up later. Open a two-week-old clip from the Artifacts
// tab and the studio knows what the cut currently is, what was asked for, and
// where the untouched original lives.

import fs from "node:fs";
import path from "node:path";
import {
  artifactFile,
  createImportedArtifact,
  getArtifactById,
  getArtifactForUser,
  importArtifactVersion,
  presentArtifact,
  setArtifactOriginatingMessage,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { authorizeGardenAccess } from "../hermes/session-service.ts";
import type { PresentedArtifact } from "../hermes/artifact-types.ts";
import { parseStoredProgram, type VideoEditProgram } from "./program.ts";

export const VIDEO_USE_TOOL = "video_use_edit";

/** Metadata keys the studio reads back. Kept in one place so both ends agree. */
export const VIDEO_USE_METADATA = {
  edited: "videoUseEdited",
  program: "videoUseProgram",
  sourceName: "videoUseSourceName",
  sourceDurationSeconds: "videoUseSourceDurationSeconds",
  durationSeconds: "videoUseDurationSeconds",
  width: "videoUseWidth",
  height: "videoUseHeight",
  lastPrompt: "videoUseLastPrompt",
  lastSummary: "videoUseLastSummary",
} as const;

export interface VideoUseArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  /** The hermes_runs row the artifact versions hang off. */
  runId: string;
  /** This agent's run id, which is how its chat turn is addressed. */
  agentRunId: string;
  assistantMessageId: number | null;
}

/**
 * The assistant turn this run belongs to, looked up again if it was not there
 * when the run started — the chat surface posts the run first and writes the
 * turn once it has a run id, so a context opened at dispatch sees no message.
 */
function assistantMessageFor(context: VideoUseArtifactContext): number | null {
  if (context.assistantMessageId !== null) return context.assistantMessageId;
  try {
    const found = findExternalAgentAssistantMessage({
      conversationId: context.conversationId,
      runId: context.agentRunId,
    });
    if (found) context.assistantMessageId = found.id;
    return context.assistantMessageId;
  } catch {
    return null;
  }
}

/**
 * Put one artifact under this run's assistant turn, if that turn is resolvable
 * yet. Used for the adopted source, which is created before the render and
 * would otherwise sit in the transcript's unassigned pile — visibly detached
 * from the response producing it — for as long as the run takes.
 */
export function assignArtifactToAssistantTurn(
  context: VideoUseArtifactContext,
  artifactId: string,
): void {
  setArtifactOriginatingMessage({
    artifactId,
    assistantMessageId: assistantMessageFor(context),
  });
}

export function openVideoUseArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  agentRunId: string;
}): VideoUseArtifactContext | null {
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
      agentRunId: input.agentRunId,
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

export function closeVideoUseArtifactContext(
  context: VideoUseArtifactContext | null,
  status: "completed" | "failed" | "aborted",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(
      context.runId,
      status === "completed" ? "completed" : status === "aborted" ? "cancelled" : "error",
    );
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

/**
 * The video artifact being edited, checked against the caller. A garden's
 * artifact additionally needs access to that garden — the artifact id alone is
 * never enough.
 */
export function requireVideoArtifact(input: {
  userId: number;
  conversationPublicId: string;
  artifactId: string;
}): ArtifactRow {
  const artifact = getArtifactForUser({
    artifactId: input.artifactId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  });
  if (artifact.garden_slug) authorizeGardenAccess(input.userId, artifact.garden_slug);
  if (artifact.kind !== "video") {
    throw new Error("Only a video artifact can be edited here.");
  }
  return artifact;
}

/**
 * Where this artifact's current file lives on disk, for seeding a session.
 *
 * Asked of the store rather than reconstructed from its metadata, so the
 * storage root stays the store's business and a version that has no file fails
 * here instead of halfway through a render.
 */
export function artifactOutputFile(artifact: ArtifactRow): string {
  return artifactFile({
    artifact,
    version: artifact.current_version,
    purpose: "download",
  }).path;
}

function metadataFor(input: {
  program: Omit<VideoEditProgram, "history" | "version"> & { summary: string };
  history: VideoEditProgram["history"];
  prompt: string;
  sourceName: string;
  sourceDurationSeconds: number;
  rendered: { durationSeconds: number; width: number; height: number };
}): Record<string, unknown> {
  return {
    [VIDEO_USE_METADATA.edited]: true,
    [VIDEO_USE_METADATA.program]: {
      version: 1,
      ranges: input.program.ranges,
      grade: input.program.grade,
      aspect: input.program.aspect,
      subtitles: input.program.subtitles,
      transform: input.program.transform,
      history: input.history,
    },
    [VIDEO_USE_METADATA.sourceName]: input.sourceName.slice(0, 240),
    [VIDEO_USE_METADATA.sourceDurationSeconds]:
      Math.round(input.sourceDurationSeconds * 10) / 10,
    [VIDEO_USE_METADATA.durationSeconds]:
      Math.round(input.rendered.durationSeconds * 10) / 10,
    [VIDEO_USE_METADATA.width]: input.rendered.width,
    [VIDEO_USE_METADATA.height]: input.rendered.height,
    [VIDEO_USE_METADATA.lastPrompt]: input.prompt.slice(0, 1_000),
    [VIDEO_USE_METADATA.lastSummary]: input.program.summary.slice(0, 600),
  };
}

export interface PublishInput {
  context: VideoUseArtifactContext;
  /** The artifact being revised, or null when this edit creates it. */
  artifact: ArtifactRow | null;
  /** The session directory — the only place a file may be imported from. */
  workspace: string;
  renderedPath: string;
  rendered: { durationSeconds: number; width: number; height: number };
  program: Omit<VideoEditProgram, "history" | "version"> & { summary: string };
  history: VideoEditProgram["history"];
  prompt: string;
  sourceName: string;
  sourceDurationSeconds: number;
  title: string;
}

/**
 * Store the render: a new version of the artifact when there is one, otherwise
 * a new artifact. Returns what the chat and the studio both show.
 */
export function publishEditedVideo(input: PublishInput): PresentedArtifact {
  const metadata = metadataFor({
    program: input.program,
    history: input.history,
    prompt: input.prompt,
    sourceName: input.sourceName,
    sourceDurationSeconds: input.sourceDurationSeconds,
    rendered: input.rendered,
  });

  const assistantMessageId = assistantMessageFor(input.context);
  const stored = input.artifact
    ? importArtifactVersion({
        artifact: input.artifact,
        authorizedRoot: input.workspace,
        filePath: input.renderedPath,
        runId: input.context.runId,
        assistantMessageId,
        metadata,
      })
    : createImportedArtifact({
        userId: input.context.userId,
        runtimeSessionId: input.context.runtimeSessionId,
        hermesSessionId: input.context.hermesSessionId,
        conversationId: input.context.conversationId,
        clusterId: input.context.clusterId,
        runId: input.context.runId,
        assistantMessageId,
        toolCallId: null,
        surface: input.context.surface,
        kind: "video",
        title: input.title.slice(0, 240),
        filename: safeFilename(input.sourceName),
        authorizedRoot: input.workspace,
        filePath: input.renderedPath,
        parentArtifactId: null,
        metadata,
        sourceHermesTool: VIDEO_USE_TOOL,
      });

  // A URL or upload is adopted before the external-agent turn necessarily
  // exists, so its original artifact can start out unassigned. Publishing is
  // the first point where the owning assistant turn is guaranteed to be
  // resolvable; move the one durable video card onto that turn (and onto each
  // later revision's turn) instead of leaving it in the transcript's
  // unassigned pile.
  setArtifactOriginatingMessage({ artifactId: stored.id, assistantMessageId });

  // `stored` was read before the ownership update. Re-read it so callers that
  // present the returned artifact see the same owner the archive will expose.
  return presentArtifact(getArtifactById(stored.id) ?? stored);
}

/** The edit program stored on an artifact, or the identity program. */
export function programForArtifact(
  artifact: ArtifactRow,
  sourceDurationSeconds: number,
): VideoEditProgram {
  const metadata = presentArtifact(artifact).metadata;
  return parseStoredProgram(metadata[VIDEO_USE_METADATA.program], sourceDurationSeconds);
}

/** True when this artifact was produced by the editor rather than adopted. */
export function isVideoUseArtifact(artifact: ArtifactRow): boolean {
  return presentArtifact(artifact).metadata[VIDEO_USE_METADATA.edited] === true;
}

export function artifactById(id: string): ArtifactRow | null {
  return getArtifactById(id);
}

function safeFilename(sourceName: string): string {
  const base =
    path
      .parse(sourceName)
      .name.replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "video";
  return `${base}-edit.mp4`;
}

/** Best-effort size of a rendered file, for the run's summary. */
export function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
