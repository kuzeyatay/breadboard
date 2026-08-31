// Keeping a finished classroom as a Breadboard artifact.
//
// The classroom lives in the OpenMAIC runtime's `data/classrooms/<id>.json`,
// and the run card opens it there. The artifact is the same document filed
// under the chat turn that asked for it: it is what the artifact panel lists,
// what downloads as a file a person can back up or import into another
// OpenMAIC, and what survives the runtime copy being rebuilt.

import { createArtifact, type ArtifactRow } from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import type { ClassroomDocument } from "./client.ts";

export const CLASSROOM_ARTIFACT_TOOL = "classroom_lesson";

export interface ClassroomArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /** The chat turn this classroom belongs to, so the card sits under it. */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation the
 * classroom was asked for in. Returns null when the conversation has no runtime
 * session — the run then says so plainly rather than silently dropping the file.
 */
export function openClassroomArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  agentRunId: string;
}): ClassroomArtifactContext | null {
  try {
    const conversation = getConversationForUser(input.conversationPublicId, input.userId);
    if (conversation.surface !== "dashboard_terminal" && conversation.surface !== "garden_chat") {
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
      clusterId: conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
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

export function closeClassroomArtifactContext(
  context: ClassroomArtifactContext | null,
  status: "completed" | "failed",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(context.runId, status === "completed" ? "completed" : "error");
  } catch {
    // A run that was already closed is not worth surfacing.
  }
}

/** The stage names the lesson (`stage.name` in the clone's Stage type). */
function stageTitle(document: ClassroomDocument): string {
  for (const candidate of [document.stage.name, document.stage.title]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "Classroom";
}

/** What the artifact remembers about the classroom it holds. */
export function classroomMetadata(input: {
  document: ClassroomDocument;
  brief: string;
  openPath: string;
}): Record<string, unknown> {
  return {
    classroomLesson: true,
    classroomId: input.document.id,
    classroomOpenPath: input.openPath,
    classroomSceneCount: input.document.scenes.length,
    classroomBrief: input.brief.slice(0, 2_000),
  };
}

export function saveClassroomArtifact(input: {
  context: ClassroomArtifactContext;
  document: ClassroomDocument;
  brief: string;
  openPath: string;
}): ArtifactRow {
  return createArtifact({
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: input.context.assistantMessageId,
    surface: input.context.surface,
    kind: "data",
    rendererId: "json",
    title: stageTitle(input.document).slice(0, 240),
    filename: `classroom-${input.document.id}.json`,
    mimeType: "application/json",
    content: JSON.stringify(
      {
        id: input.document.id,
        stage: input.document.stage,
        scenes: input.document.scenes,
        createdAt: input.document.createdAt,
      },
      null,
      2,
    ),
    metadata: classroomMetadata(input),
    sourceHermesTool: CLASSROOM_ARTIFACT_TOOL,
  });
}
