import {
  createArtifact,
  renderArtifact,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";

export const OPEN_GYM_ARTIFACT_TOOL = "open_gym_program_write";

interface OpenGymArtifactContext {
  userId: number;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  assistantMessageId: number | null;
}

function openContext(input: {
  userId: number;
  conversationPublicId: string;
  task: string;
  agentRunId: string;
}): OpenGymArtifactContext | null {
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
      instruction: input.task.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.task.slice(0, 4_000),
      },
    });
    return {
      userId: input.userId,
      runtimeSessionId: session.id,
      hermesSessionId,
      conversationId: conversation.id,
      clusterId: conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
      surface: conversation.surface,
      runId: run.id,
      assistantMessageId: findExternalAgentAssistantMessage({
        conversationId: conversation.id,
        runId: input.agentRunId,
      })?.id ?? null,
    };
  } catch {
    return null;
  }
}

function filename(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "open-gym-program"}.md`;
}

/** Publish a completed program into the exact conversation that launched it. */
export async function publishOpenGymProgram(input: {
  userId: number;
  conversationPublicId: string;
  agentRunId: string;
  task: string;
  programId: string;
  title: string;
  markdown: string;
  exerciseIds: string[];
}): Promise<ArtifactRow | null> {
  const context = openContext(input);
  if (!context) return null;
  try {
    const artifact = createArtifact({
      userId: context.userId,
      runtimeSessionId: context.runtimeSessionId,
      hermesSessionId: context.hermesSessionId,
      conversationId: context.conversationId,
      clusterId: context.clusterId,
      runId: context.runId,
      assistantMessageId: context.assistantMessageId,
      surface: context.surface,
      kind: "markdown",
      rendererId: "markdown",
      title: input.title.slice(0, 240),
      filename: filename(input.title),
      mimeType: "text/markdown; charset=utf-8",
      content: input.markdown,
      metadata: {
        openGymProgram: true,
        openGymProgramId: input.programId,
        exerciseIds: input.exerciseIds,
      },
      sourceHermesTool: OPEN_GYM_ARTIFACT_TOOL,
    });
    const rendered = await renderArtifact({
      artifact,
      runId: context.runId,
      assistantMessageId: context.assistantMessageId,
    });
    finishRuntimeRun(context.runId, rendered.status === "ready" ? "completed" : "error");
    return rendered;
  } catch {
    try { finishRuntimeRun(context.runId, "error"); } catch { /* already closed */ }
    return null;
  }
}
