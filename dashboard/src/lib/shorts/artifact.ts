// Storing each cut short as a Breadboard artifact.
//
// The deliverable of a run is video files, so each one is imported as a video
// artifact that belongs to the conversation: playable in the chat, downloadable,
// and still there after a reload — the run's own events are in memory and gone
// the moment the process restarts.
//
// Every clip carries what the ranker said about it (its window, its score, the
// hook line and why the model thought it would travel), so the reason a clip
// exists survives with the file rather than only in the run card.

import fs from "node:fs";
import path from "node:path";
import {
  createImportedArtifact,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";

export const SHORTS_TOOL = "shorts_cut_clips";

export interface ShortsArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** This agent's run id, which is how its chat turn is addressed. */
  agentRunId: string;
  /**
   * The chat turn this run belongs to, so each clip renders under that reply.
   * Null only if the turn was never stored — the clips still belong to the
   * conversation, they just have no message to sit under.
   */
  assistantMessageId: number | null;
}

/**
 * The assistant turn this run belongs to, looked up again if it was not there
 * when the run started — the chat surface posts the run first and writes the
 * turn once it has a run id, so a context opened at dispatch sees no message.
 */
function assistantMessageFor(context: ShortsArtifactContext): number | null {
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
 * Resolve everything the artifact store needs from the conversation this run
 * was dispatched in, and open a run for the clips to hang off. Returns null
 * when the conversation has no runtime session yet.
 */
export function openShortsArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  agentRunId: string;
}): ShortsArtifactContext | null {
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

export function closeShortsArtifactContext(
  context: ShortsArtifactContext | null,
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

export interface ShortsClip {
  index: number;
  title: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  score: number;
  hook: string;
  reason: string;
  /** Absolute path of the encoded file, inside the run's own workspace. */
  path: string;
  sizeBytes: number;
}

export interface PublishedClip extends ShortsClip {
  artifactId: string | null;
  filename: string;
}

/**
 * Import one cut clip. Returns the clip with its artifact id, or with a null id
 * when storing failed — a clip that exists on disk but could not be attached is
 * still worth reporting rather than silently dropping.
 */
export function publishClip(input: {
  context: ShortsArtifactContext;
  clip: ShortsClip;
  /** The directory the run wrote its clips into; nothing outside it is read. */
  workspace: string;
  sourceLabel: string;
}): PublishedClip {
  const filename = `${String(input.clip.index).padStart(2, "0")}-${safeFilename(
    input.clip.title,
  )}.mp4`;
  try {
    const artifact: ArtifactRow = createImportedArtifact({
      userId: input.context.userId,
      runtimeSessionId: input.context.runtimeSessionId,
      hermesSessionId: input.context.hermesSessionId,
      conversationId: input.context.conversationId,
      clusterId: input.context.clusterId,
      runId: input.context.runId,
      assistantMessageId: assistantMessageFor(input.context),
      toolCallId: null,
      surface: input.context.surface,
      kind: "video",
      title: input.clip.title.slice(0, 240),
      filename,
      authorizedRoot: input.workspace,
      filePath: input.clip.path,
      parentArtifactId: null,
      metadata: {
        shortsClip: true,
        shortsRunId: input.context.agentRunId,
        shortsSource: input.sourceLabel.slice(0, 500),
        shortsIndex: input.clip.index,
        shortsScore: input.clip.score,
        shortsStartSec: Math.round(input.clip.startSec * 10) / 10,
        shortsEndSec: Math.round(input.clip.endSec * 10) / 10,
        shortsDurationSec: Math.round(input.clip.durationSec),
        shortsHook: input.clip.hook.slice(0, 600),
        shortsReason: input.clip.reason.slice(0, 600),
      },
      sourceHermesTool: SHORTS_TOOL,
    });
    return { ...input.clip, artifactId: artifact.id, filename: artifact.filename };
  } catch {
    return { ...input.clip, artifactId: null, filename };
  }
}

/**
 * Remove the run's working directory once its clips have been imported. The
 * artifact store copied what it kept, so what is left here is a duplicate of
 * every stored clip.
 */
export function discardWorkspace(workspace: string): void {
  try {
    if (path.basename(workspace).startsWith("run_")) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  } catch {
    // A leftover temporary directory is not worth failing a finished run.
  }
}

function safeFilename(title: string): string {
  return (
    title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "short"
  );
}
