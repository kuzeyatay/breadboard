import type { ConversationRow } from "../conversations/store.ts";
import { conversationOrigin } from "./session-surface.ts";
import {
  listConversationMessages,
  presentConversation,
  presentConversationMessage,
} from "../conversations/store.ts";
import {
  delegatedAgentPresentation,
  externalAgentMessageFields,
} from "../conversations/external-agent-runs.ts";
import {
  carriedExternalAgentsForContinuation,
  withCarriedExternalAgents,
} from "../conversations/delegated-agent-provenance.ts";
import { projectConversationBranchMessages } from "../conversations/branch-history.ts";
import {
  presentMessageVersions,
  readMessageVersions,
} from "../conversations/message-versions.ts";
import {
  scoreReview,
  summarizeReviewScores,
} from "../humanizer/review.ts";
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
import {
  generativeUiResourcesFromVerification,
  normalizeGenerativeUiResources,
} from "../generative-ui/contracts.ts";
import { normalizeScheduledChatReceipt } from "../schedules/types.ts";
import {
  normalizeFocusedDocumentNames,
  normalizeFocusedDocumentSlugs,
} from "../garden-document-focus.ts";

// Creating a brand-new conversation and dispatching its first turn are two
// requests. The durable placeholder between them is stored as aborted so a
// process crash cannot leave the conversation permanently busy, but a viewer
// can legitimately reopen the chat while the original request is still doing
// title/runtime setup. During that bounded hand-off window it is working, not
// interrupted. Five minutes is deliberately much longer than a cold runtime
// start while still converging to the recoverable Retry state after a crash.
const PRE_DISPATCH_RESTORE_WINDOW_MS = 5 * 60 * 1_000;

function sqliteTimestampMs(value: string): number {
  return Date.parse(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
}

function isRecoveringPreDispatchTurn(input: {
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  responseStartedAt?: string;
  nowMs?: number;
}): boolean {
  if (
    input.status !== "aborted" ||
    input.metadata.preDispatchReserved !== true ||
    input.metadata.error !== "turn_dispatch_pending"
  ) {
    return false;
  }
  const startedAtMs = input.responseStartedAt
    ? Date.parse(input.responseStartedAt)
    : sqliteTimestampMs(input.createdAt);
  if (!Number.isFinite(startedAtMs)) return false;
  const elapsedMs = (input.nowMs ?? Date.now()) - startedAtMs;
  return elapsedMs >= -60_000 && elapsedMs <= PRE_DISPATCH_RESTORE_WINDOW_MS;
}

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
  const dispatch = parseRuntimeRunDispatch(activeRun);
  return {
    id: activeRun.id,
    instruction: activeRun.instruction,
    startedAt: activeRun.started_at,
    clientMessageId: dispatch.clientMessageId,
    superAgent: dispatch.capabilities?.superAgent === true,
  };
}

function presentSessionBase(conversation: ConversationRow) {
  const runtime = getRuntimeSessionByConversation(conversation.id);
  const origin = conversationOrigin(conversation);
  return {
    ...presentConversation(conversation),
    surface: conversation.surface,
    originLabel: origin.originLabel,
    gardenId: runtime?.garden_id ?? origin.gardenSlug,
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
  activity: { messageCount?: number; externalAgentActive?: boolean; transcriptVersion?: string; pendingMessageCount?: number } = {},
) {
  return {
    ...presentSessionBase(conversation),
    messageCount: activity.messageCount ?? 0,
    transcriptVersion: activity.transcriptVersion ?? "",
    pendingMessageCount: activity.pendingMessageCount ?? 0,
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
  const conversationMessages = projectConversationBranchMessages(
    listConversationMessages(conversation.id),
  );
  const messages = conversationMessages.map((message, messageIndex) => {
    const presented = presentConversationMessage(message);
    // Metadata is the persistence envelope. Project the fields the client
    // actually consumes below, but do not also ship that envelope wholesale:
    // tool traces and attachments can make it several megabytes per chat.
    const { metadata, ...presentedMessage } = presented;
    const calls = Array.isArray(metadata.toolCalls)
      ? metadata.toolCalls as Array<Record<string, unknown>>
      : [];
    const progressNotes = Array.isArray(metadata.progressNotes)
      ? metadata.progressNotes.filter(
          (note): note is string =>
            typeof note === "string" && Boolean(note.trim()),
        )
      : [];
    const responseStartedAt =
      typeof metadata.responseStartedAt === "string" &&
      Number.isFinite(Date.parse(metadata.responseStartedAt))
        ? metadata.responseStartedAt
        : undefined;
    const recoveringPreDispatch = isRecoveringPreDispatchTurn({
      status: presented.status,
      metadata,
      createdAt: presented.createdAt,
      responseStartedAt,
    });
    const rawPreDispatchRecovery =
      metadata.preDispatchRecovery &&
      typeof metadata.preDispatchRecovery === "object" &&
      !Array.isArray(metadata.preDispatchRecovery)
        ? metadata.preDispatchRecovery as Record<string, unknown>
        : {};
    const preDispatchRecovery = {
      agentMode: rawPreDispatchRecovery.agentMode !== false,
      ...(typeof rawPreDispatchRecovery.model === "string"
        ? { model: rawPreDispatchRecovery.model }
        : {}),
      ...(typeof rawPreDispatchRecovery.reasoningEffort === "string"
        ? { reasoningEffort: rawPreDispatchRecovery.reasoningEffort }
        : {}),
      superAgent: rawPreDispatchRecovery.superAgent === true,
      adhdMode: rawPreDispatchRecovery.adhdMode === true,
      personalize: rawPreDispatchRecovery.personalize !== false,
      yoloMode: rawPreDispatchRecovery.yoloMode === true,
    };
    const messagePending =
      presented.status === "pending" || recoveringPreDispatch;
    const metadataDuration = Number(metadata.responseDurationMs);
    const timestampDuration = Math.max(
      0,
      Date.parse(presented.updatedAt) - Date.parse(presented.createdAt),
    );
    const responseDurationMs = Number.isFinite(metadataDuration) && metadataDuration >= 0
      ? metadataDuration
      : !messagePending && Number.isFinite(timestampDuration)
        ? timestampDuration
        : undefined;
    const responseCompletedAt =
      typeof metadata.responseCompletedAt === "string" &&
      Number.isFinite(Date.parse(metadata.responseCompletedAt))
        ? metadata.responseCompletedAt
        : !messagePending
          ? presented.updatedAt
          : undefined;
    const textSelection = normalizeChatTextSelectionReference(
      metadata.textSelection,
    );
    const focusedDocumentNames = normalizeFocusedDocumentNames(
      metadata.focusedDocumentNames,
    );
    const focusedDocumentSlugs = normalizeFocusedDocumentSlugs(
      metadata.focusedDocumentSlugs,
    );
    const scheduledChatReceipt = normalizeScheduledChatReceipt(
      metadata.scheduledChatReceipt,
    );
    const persistedUiResources = normalizeGenerativeUiResources(metadata.uiResources);
    const uiResources = persistedUiResources.length > 0
      ? persistedUiResources
      : generativeUiResourcesFromVerification(metadata.verification);
    const normalizeModelChangeLabel = (value: unknown) =>
      typeof value === "string"
        ? value
            .replace(/[-\u2013\u2014]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160)
        : "";
    const persistedModelChanges = Array.isArray(
      metadata.modelChangeLabels,
    )
      ? metadata.modelChangeLabels
          .map(normalizeModelChangeLabel)
          .filter(Boolean)
      : [];
    const legacyModelChange = normalizeModelChangeLabel(
      metadata.modelChangeLabel,
    );
    const modelChangesAfter = persistedModelChanges.length
      ? persistedModelChanges
      : legacyModelChange
        ? [legacyModelChange]
        : [];
    const modelChangeAfter = modelChangesAfter.at(-1) ?? "";
    // Always at least one version, so nothing downstream has to branch on
    // "has this answer ever been rewritten".
    const contentVersions = readMessageVersions(message);
    const activeContentVersion = contentVersions.versions[contentVersions.activeIndex];
    const humanizerScore =
      contentVersions.derived && activeContentVersion
        ? activeContentVersion.review ??
          summarizeReviewScores(
            scoreReview(
              contentVersions.versions[activeContentVersion.derivedFrom ?? 0]?.content ??
                contentVersions.versions[0].content,
              activeContentVersion.content,
            ),
          )
        : null;
    // Old synthesis turns may have finished after the in-memory launch queue
    // was lost, leaving `verification.externalAgents` empty even though the
    // durable hidden worker turn is intact. The preceding hand-back marker
    // names that exact worker, so transcript restore can repair the evidence
    // view without mutating history or guessing from adjacent user requests.
    const previousMessage = conversationMessages[messageIndex - 1];
    const carriedDelegations =
      presented.role === "assistant" &&
      previousMessage?.role === "user" &&
      previousMessage.content.includes("<!-- agent-launch-result:")
        ? carriedExternalAgentsForContinuation({
            continuationText: previousMessage.content,
            messages: conversationMessages,
          })
        : [];
    const verification = contentVersions.derived
      ? undefined
      : withCarriedExternalAgents(metadata.verification, carriedDelegations);
    let externalAgent = externalAgentMessageFields(metadata);
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
      ...presentedMessage,
      ...delegatedAgentPresentation(presented.content, externalAgent),
      ...(Array.isArray(metadata.attachmentNames)
        ? { attachmentNames: metadata.attachmentNames }
        : {}),
      ...(Array.isArray(metadata.attachments)
        ? { attachments: metadata.attachments }
        : {}),
      ...(focusedDocumentNames.length ? { focusedDocumentNames } : {}),
      ...(focusedDocumentSlugs.length ? { focusedDocumentSlugs } : {}),
      ...(progressNotes.length ? { progressNotes } : {}),
      ...(typeof metadata.reasoning === "string" && metadata.reasoning.trim()
        ? { reasoning: metadata.reasoning }
        : {}),
      tools: calls.map((call, index) => ({
        toolCallId: String(call.toolCallId ?? `tool-${index}`),
        toolName: String(call.toolName ?? "tool"),
        summary: typeof call.summary === "string" ? call.summary : undefined,
        status: call.success === false ? "failed" : "completed",
      })),
      // Evidence was gathered about the wording the model produced. A version
      // rewritten afterwards is a different set of sentences, and letting it
      // inherit "verified" would be a claim nobody checked — so a derived
      // version carries none, and switching back to the original restores it.
      verification,
      ...(contentVersions.versions.length > 1
        ? { contentVersions: presentMessageVersions(contentVersions) }
        : {}),
      ...(humanizerScore
        ? {
            humanizerReview: {
              ...humanizerScore,
              adopted: true,
              disposition: "adopted" as const,
            },
          }
        : {}),
      proposal: metadata.proposal,
      pending: messagePending,
      failed: presented.status === "failed",
      interrupted: presented.status === "aborted" && !recoveringPreDispatch,
      ...(presented.role === "assistant" && recoveringPreDispatch
        ? { preDispatchRecovery }
        : {}),
      // A turn that paused for permission before dispatch is only actionable
      // while its approval card is on screen — client state that navigation
      // throws away. Surfacing the persisted request lets the transcript
      // restore rebuild the card instead of showing a dead blank turn.
      ...(presented.role === "assistant" &&
      presented.status === "failed" &&
      metadata.error === "awaiting_permission" &&
      Array.isArray(metadata.pendingPermissions) &&
      metadata.pendingPermissions.length > 0
        ? { pendingPermissions: metadata.pendingPermissions }
        : {}),
      ...(presented.role === "assistant" &&
      memoryUpdatedClientMessageIds.has(presented.clientMessageId)
        ? { memoryUpdated: true }
        : {}),
      ...(typeof metadata.branchGroupId === "string"
        ? { branchGroupId: metadata.branchGroupId }
        : {}),
      ...(textSelection ? { textSelection } : {}),
      ...(presented.role === "assistant" && scheduledChatReceipt
        ? { scheduledChatReceipt }
        : {}),
      ...(metadata.courseCorrection === true
        ? { courseCorrection: true }
        : {}),
      ...(metadata.clarificationAnswer === true
        ? { clarificationAnswer: true }
        : {}),
      ...(metadata.internalAgentContinuation === true
        ? { internalAgentContinuation: true }
        : {}),
      ...(metadata.deliveryChannel === "telegram" ||
      metadata.deliveryChannel === "whatsapp"
        ? { deliveryChannel: metadata.deliveryChannel }
        : {}),
      ...(typeof metadata.courseCorrectionTargetClientMessageId === "string"
        ? {
            courseCorrectionTargetClientMessageId:
              metadata.courseCorrectionTargetClientMessageId,
          }
        : {}),
      ...(typeof metadata.courseCorrectionOffset === "number"
        ? { courseCorrectionOffset: metadata.courseCorrectionOffset }
        : {}),
      ...(modelChangesAfter.length ? { modelChangesAfter } : {}),
      ...(modelChangeAfter ? { modelChangeAfter } : {}),
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
      ...(responseStartedAt ? { responseStartedAt } : {}),
      ...(responseCompletedAt ? { responseCompletedAt } : {}),
      ...(uiResources.length ? { uiResources } : {}),
    };
  });

  return { ...base, messages };
}
