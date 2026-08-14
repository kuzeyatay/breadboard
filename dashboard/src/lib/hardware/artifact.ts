// Storing a hardware blueprint as a Breadboard artifact.
//
// The whole HardwareDesign is the artifact's source, so reopening a blueprint
// never needs the model again. A follow-up change forks a new version of the
// same artifact through the existing revision mechanism rather than creating a
// second, unrelated artifact.

import {
  createArtifact,
  getArtifactById,
  listArtifactsForUser,
  readArtifactSource,
  renderArtifact,
  setArtifactOriginatingMessage,
  updateArtifactContent,
  type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { beginRuntimeRun, finishRuntimeRun } from "../hermes/run-store.ts";
import {
  getRuntimeSessionByConversation,
  runtimeExternalSessionId,
} from "../hermes/runtime-store.ts";
import { getConversationForUser } from "../conversations/store.ts";
import { findExternalAgentAssistantMessage } from "../conversations/external-agent-turns.ts";
import { parseStoredDesign } from "./schemas.ts";
import type { HardwareDesign } from "./types.ts";

export const HARDWARE_BLUEPRINT_RENDERER = "hardware-blueprint";
export const HARDWARE_BLUEPRINT_TOOL = "hardware_blueprint_compile";

export interface HardwareArtifactContext {
  userId: number;
  conversationPublicId: string;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  surface: "dashboard_terminal" | "garden_chat";
  runId: string;
  /**
   * The chat turn this run belongs to, so its blueprint renders under that
   * response. Null only if the turn was never stored — the artifact still
   * belongs to the conversation, it just has no message to sit under.
   */
  assistantMessageId: number | null;
}

/**
 * Resolve everything the artifact store needs from the conversation this run
 * was dispatched in, and open a run for the artifacts to hang off. Returns null
 * when the conversation has no runtime session yet.
 */
export function openHardwareArtifactContext(input: {
  userId: number;
  conversationPublicId: string;
  brief: string;
  /** The hardware run id, which is how its chat turn is addressed. */
  agentRunId: string;
}): HardwareArtifactContext | null {
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
      instruction: input.brief.slice(0, 4_000),
      dispatch: {
        conversationPublicId: input.conversationPublicId,
        runtimeText: input.brief.slice(0, 4_000),
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

export function closeHardwareArtifactContext(
  context: HardwareArtifactContext | null,
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

function artifactMetadata(design: HardwareDesign): Record<string, unknown> {
  const counts = design.validationResults.reduce(
    (totals, finding) => ({
      ...totals,
      [finding.severity]: (totals[finding.severity] ?? 0) + 1,
    }),
    {} as Record<string, number>,
  );
  return {
    hardwareBlueprint: true,
    hardwareDesignId: design.id,
    hardwareStatus: design.status,
    hardwareController:
      design.components.find((instance) => instance.reference === "U1")?.name ?? "",
    hardwareComponentCount: design.components.length,
    hardwareNetCount: design.nets.length,
    hardwareErrorCount: counts.error ?? 0,
    hardwareWarningCount: counts.warning ?? 0,
  };
}

/** The most recent hardware blueprint in this conversation, if any. */
export function latestHardwareArtifact(input: {
  userId: number;
  conversationPublicId: string;
}): ArtifactRow | null {
  try {
    return (
      listArtifactsForUser({
        userId: input.userId,
        conversationPublicId: input.conversationPublicId,
      }).find(
        (row) =>
          row.renderer_id === HARDWARE_BLUEPRINT_RENDERER && row.status !== "archived",
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** Read a stored blueprint back. Returns null when it cannot be trusted. */
export function readStoredDesign(artifact: ArtifactRow): HardwareDesign | null {
  try {
    const source = readArtifactSource(artifact);
    const parsed = parseStoredDesign(JSON.parse(source) as unknown);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export async function publishHardwareDesign(input: {
  context: HardwareArtifactContext;
  design: HardwareDesign;
  /** Fork a new version of this artifact instead of creating a fresh one. */
  previousArtifactId?: string | null;
}): Promise<ArtifactRow | null> {
  const content = `${JSON.stringify(input.design, null, 2)}\n`;
  const metadata = artifactMetadata(input.design);
  const title = `Hardware Blueprint: ${input.design.title}`.slice(0, 240);

  const assistantMessageId = input.context.assistantMessageId;

  try {
    const existing = input.previousArtifactId
      ? getArtifactById(input.previousArtifactId)
      : null;
    const artifact =
      existing && existing.user_id === input.context.userId && existing.status !== "archived"
        ? updateArtifactContent({
            artifact: existing,
            content,
            mode: "fork",
            runId: input.context.runId,
            assistantMessageId,
            metadata,
          })
        : createArtifact({
            userId: input.context.userId,
            runtimeSessionId: input.context.runtimeSessionId,
            hermesSessionId: input.context.hermesSessionId,
            conversationId: input.context.conversationId,
            clusterId: input.context.clusterId,
            runId: input.context.runId,
            assistantMessageId,
            surface: input.context.surface,
            kind: "data",
            rendererId: HARDWARE_BLUEPRINT_RENDERER,
            title,
            filename: "hardware-design.json",
            content,
            metadata,
            sourceHermesTool: HARDWARE_BLUEPRINT_TOOL,
          });

    // A revision forks the same artifact, so its one card follows the turn that
    // asked for the change rather than staying under the original design.
    setArtifactOriginatingMessage({ artifactId: artifact.id, assistantMessageId });

    return await renderArtifact({
      artifact,
      runId: input.context.runId,
      assistantMessageId,
    });
  } catch {
    return null;
  }
}

/** Compact description of a stored design, used to interpret a follow-up. */
export function summariseDesignForModel(design: HardwareDesign): string {
  return [
    `Title: ${design.title}`,
    `Status: ${design.status}`,
    "Components:",
    ...design.components.map(
      (instance) =>
        `- ${instance.id} (${instance.reference}) ${instance.name}${
          instance.value ? ` ${instance.value}` : ""
        }${instance.automaticallyAdded ? " [added automatically by the compiler]" : ""} — library id ${instance.definitionId}`,
    ),
    `Power: ${design.request.power.source}${
      design.request.power.part ? ` (${design.request.power.part})` : ""
    }`,
    `Prototype: ${design.request.prototypeType}`,
    `Purpose: ${design.request.purpose}`,
  ].join("\n");
}
