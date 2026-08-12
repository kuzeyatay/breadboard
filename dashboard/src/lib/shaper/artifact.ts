// Durable GLB artifacts produced by the Formsmith/ShapeR runtime.

import fs from "node:fs";
import path from "node:path";
import { createImportedArtifact, type ArtifactRow } from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";

export const FORMSMITH_TOOL = "formsmith_reconstruct_image";

export interface FormsmithArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  agentRunId: string;
  assistantMessageId: number | null;
}

function assistantMessageFor(context: FormsmithArtifactContext): number | null {
  if (context.assistantMessageId !== null) return context.assistantMessageId;
  try {
    const found = findExternalAgentAssistantMessage({
      conversationId: context.conversationId,
      runId: context.agentRunId,
    });
    if (found) context.assistantMessageId = found.id;
  } catch {
    // The artifact still belongs to the conversation if the message raced us.
  }
  return context.assistantMessageId;
}

export function openFormsmithArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  label: string;
  agentRunId: string;
}): FormsmithArtifactContext | null {
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
      agentRunId: input.agentRunId,
      assistantMessageId: findExternalAgentAssistantMessage({
        conversationId: conversation.id,
        runId: input.agentRunId,
      })?.id ?? null,
    };
  } catch {
    return null;
  }
}

export function closeFormsmithArtifactContext(
  context: FormsmithArtifactContext | null,
  status: "completed" | "failed" | "aborted",
): void {
  if (!context) return;
  try {
    finishRuntimeRun(
      context.runId,
      status === "completed" ? "completed" : status === "aborted" ? "cancelled" : "error",
    );
  } catch {
    // The runtime run may already have been closed by shutdown recovery.
  }
}

export function publishFormsmithMesh(input: {
  context: FormsmithArtifactContext;
  workspace: string;
  meshPath: string;
  sourceFilename: string;
}): ArtifactRow {
  const base = path.basename(input.sourceFilename, path.extname(input.sourceFilename));
  const safeBase = base.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "object";
  return createImportedArtifact({
    userId: input.context.userId,
    runtimeSessionId: input.context.runtimeSessionId,
    hermesSessionId: input.context.hermesSessionId,
    conversationId: input.context.conversationId,
    clusterId: input.context.clusterId,
    runId: input.context.runId,
    assistantMessageId: assistantMessageFor(input.context),
    toolCallId: null,
    surface: input.context.surface,
    kind: "model",
    title: `3D reconstruction of ${base || "picture"}`.slice(0, 240),
    filename: `${safeBase.toLowerCase()}-formsmith.glb`,
    authorizedRoot: input.workspace,
    filePath: input.meshPath,
    parentArtifactId: null,
    metadata: {
      formsmith: true,
      shapeR: true,
      formsmithRunId: input.context.agentRunId,
      sourceFilename: input.sourceFilename.slice(0, 200),
    },
    sourceHermesTool: FORMSMITH_TOOL,
  });
}

export function discardFormsmithWorkspace(workspace: string): void {
  try {
    if (path.basename(workspace).startsWith("run_")) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  } catch {
    // A stale temporary directory is safe to prune later.
  }
}
