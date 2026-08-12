import type { ConversationRow } from "../conversations/store.ts";
import {
  listConversationMessages,
  presentConversation,
  presentConversationMessage,
} from "../conversations/store.ts";
import {
  delegatedAgentPresentation,
  externalAgentMessageFields,
} from "../conversations/external-agent-runs.ts";
import { projectConversationBranchMessages } from "../conversations/branch-history.ts";
import { normalizeChatTextSelectionReference } from "../chat-text-selection.ts";
import { memoryUpdatedClientMessageIdsForSession } from "./memory-evidence.ts";
import { getRuntimeSessionByConversation } from "./runtime-store.ts";
import {
  getActiveRuntimeRun,
  parseRuntimeRunDispatch,
} from "./run-store.ts";
import { listArtifactsForUser } from "./artifact-store.ts";
import {
  HARDWARE_BLUEPRINT_RENDERER,
  readStoredDesign,
} from "../hardware/artifact.ts";
import { hardwareBlueprintRunCardState } from "../hardware/run-card-state.ts";
import type { HardwareDesign } from "../hardware/types.ts";

interface RecoverableHardwareCardSource {
  design?: HardwareDesign;
  enclosureTitle?: string;
}

function recoverableHardwareCardsByMessage(
  conversation: ConversationRow,
): Map<number, RecoverableHardwareCardSource> {
  const cards = new Map<number, RecoverableHardwareCardSource>();
  try {
    // Artifacts are newest first. Fill each kind once so a revised artifact
    // restores the same card with its newest stored version.
    for (const artifact of listArtifactsForUser({
      userId: conversation.user_id,
      conversationPublicId: conversation.public_id,
    })) {
      if (
        artifact.status === "archived" ||
        artifact.originating_message_id === null
      ) {
        continue;
      }
      const current = cards.get(artifact.originating_message_id) ?? {};
      if (
        artifact.renderer_id === HARDWARE_BLUEPRINT_RENDERER &&
        !current.design
      ) {
        const design = readStoredDesign(artifact);
        if (design) current.design = design;
      }
      if (
        artifact.renderer_id === "parametric-cad" &&
        !current.enclosureTitle
      ) {
        current.enclosureTitle = artifact.title.replace(/^CAD:\s*/i, "").trim();
      }
      if (current.design || current.enclosureTitle) {
        cards.set(artifact.originating_message_id, current);
      }
    }
  } catch {
    // History must remain readable even if a legacy artifact is missing or
    // corrupt. In that case the card falls back to its saved prose as before.
  }
  return cards;
}

function presentActiveRun(runtimeSessionId: number | null) {
  const activeRun = runtimeSessionId === null
    ? null
    : getActiveRuntimeRun(runtimeSessionId);
  if (!activeRun) return null;
  return {
    id: activeRun.id,
    instruction: activeRun.instruction,
    startedAt: activeRun.started_at,
    clientMessageId: parseRuntimeRunDispatch(activeRun).clientMessageId,
  };
}

function presentSessionBase(conversation: ConversationRow) {
  const runtime = getRuntimeSessionByConversation(conversation.id);
  return {
    ...presentConversation(conversation),
    surface: runtime?.surface ?? null,
    gardenId: runtime?.garden_id ?? null,
    pageSlug: runtime?.page_slug ?? null,
    status: runtime?.last_runtime_status ?? "idle",
    activeDirectory: runtime?.active_directory ?? null,
    filesystemMode: runtime?.filesystem_mode ?? "restricted",
    capabilityMode: runtime?.capability_mode ?? "knowledge",
    activeRun: presentActiveRun(runtime?.id ?? null),
  };
}

/** Small row used by history rails and restore selection. Never embeds a transcript. */
export function presentHermesSessionSummary(
  conversation: ConversationRow,
  activity: { messageCount?: number; externalAgentActive?: boolean } = {},
) {
  return {
    ...presentSessionBase(conversation),
    messageCount: activity.messageCount ?? 0,
    externalAgentActive: activity.externalAgentActive === true,
  };
}

/** Full transcript for the one conversation the reader explicitly opens. */
export function presentHermesSessionDetail(conversation: ConversationRow) {
  const base = presentSessionBase(conversation);
  const runtime = getRuntimeSessionByConversation(conversation.id);
  const memoryUpdatedClientMessageIds = runtime
    ? memoryUpdatedClientMessageIdsForSession(runtime.id)
    : new Set<string>();
  let recoverableHardwareCards: Map<number, RecoverableHardwareCardSource> | null = null;
  const messages = projectConversationBranchMessages(
    listConversationMessages(conversation.id),
  ).map((message) => {
    const presented = presentConversationMessage(message);
    const calls = Array.isArray(presented.metadata.toolCalls)
      ? presented.metadata.toolCalls as Array<Record<string, unknown>>
      : [];
    const metadataDuration = Number(presented.metadata.responseDurationMs);
    const timestampDuration = Math.max(
      0,
      Date.parse(presented.updatedAt) - Date.parse(presented.createdAt),
    );
    const responseDurationMs = Number.isFinite(metadataDuration) && metadataDuration >= 0
      ? metadataDuration
      : presented.status !== "pending" && Number.isFinite(timestampDuration)
        ? timestampDuration
        : undefined;
    const textSelection = normalizeChatTextSelectionReference(
      presented.metadata.textSelection,
    );
    let externalAgent = externalAgentMessageFields(presented.metadata);
    if (
      presented.role === "assistant" &&
      externalAgent.hardwareBlueprintRun &&
      !externalAgent.externalAgentState
    ) {
      // New turns persist this payload directly. Query artifacts only when an
      // older Hardware Blueprint turn actually needs compatibility recovery.
      recoverableHardwareCards ??=
        recoverableHardwareCardsByMessage(conversation);
      const source = recoverableHardwareCards.get(message.id);
      if (source?.design) {
        externalAgent = {
          ...externalAgent,
          externalAgentState: hardwareBlueprintRunCardState(source.design, {
            enclosureTitle: source.enclosureTitle,
            startedAt: presented.createdAt,
            completedAt: presented.updatedAt,
          }),
        };
      }
    }
    return {
      ...presented,
      ...delegatedAgentPresentation(presented.content, externalAgent),
      ...(Array.isArray(presented.metadata.attachmentNames)
        ? { attachmentNames: presented.metadata.attachmentNames }
        : {}),
      ...(Array.isArray(presented.metadata.attachments)
        ? { attachments: presented.metadata.attachments }
        : {}),
      tools: calls.map((call, index) => ({
        toolCallId: String(call.toolCallId ?? `tool-${index}`),
        toolName: String(call.toolName ?? "tool"),
        summary: typeof call.summary === "string" ? call.summary : undefined,
        status: call.success === false ? "failed" : "completed",
      })),
      verification: presented.metadata.verification,
      proposal: presented.metadata.proposal,
      interrupted: presented.status === "aborted",
      ...(presented.role === "assistant" &&
      memoryUpdatedClientMessageIds.has(presented.clientMessageId)
        ? { memoryUpdated: true }
        : {}),
      ...(typeof presented.metadata.branchGroupId === "string"
        ? { branchGroupId: presented.metadata.branchGroupId }
        : {}),
      ...(textSelection ? { textSelection } : {}),
      ...(presented.metadata.courseCorrection === true
        ? { courseCorrection: true }
        : {}),
      ...(presented.metadata.internalAgentContinuation === true
        ? { internalAgentContinuation: true }
        : {}),
      ...(typeof presented.metadata.courseCorrectionTargetClientMessageId === "string"
        ? {
            courseCorrectionTargetClientMessageId:
              presented.metadata.courseCorrectionTargetClientMessageId,
          }
        : {}),
      ...(typeof presented.metadata.courseCorrectionOffset === "number"
        ? { courseCorrectionOffset: presented.metadata.courseCorrectionOffset }
        : {}),
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
    };
  });

  return { ...base, messages };
}
