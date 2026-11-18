// Turning an inbound Telegram message into a real Breadboard chat.
//
// The message goes through exactly the pipeline the browser uses —
// `createConversation` + `resolveConversationRuntime` + `startConversationTurn` —
// so the chat shows up in the Terminal's Recents, carries the same memory,
// capabilities and audit trail, and can be reopened and continued by hand. That
// is the whole point of driving the Bot API here rather than pointing it at some
// separate bot runtime with a transcript store of its own.
//
// A Telegram thread maps to one conversation per local calendar day.
// An explicit /new can still start a fresh chat within the day.

import { wakeAgentRuntime } from "../agent-runtime/wake.ts";
import {
  deliverLateAssistantReply,
  LATE_REPLY_MAX_WAIT_MS,
} from "../conversations/late-reply.ts";
import db from "../db.ts";
import { prepareTelegramAttachments } from "../messaging-attachments/prepare.ts";
import {
  completeAssistantMessage,
  createConversation,
  deleteConversation,
  getConversationById,
  listConversationMessages,
  presentConversationMessage,
  reserveConversationTurn,
  type ConversationRow,
} from "../conversations/store.ts";
import { fallbackConversationTitle } from "../conversations/title-service.ts";
import { startConversationTurn } from "../conversations/turn-service.ts";
import { startSessionEventPump } from "../hermes/event-stream.ts";
import { requireEnabled } from "../hermes/route-core.ts";
import { getHermesUserSettings } from "../hermes/runtime-store.ts";
import { authorizeRuntimeReference, resolveConversationRuntime } from "../hermes/session-service.ts";
import { getAgentRuntimeByKind } from "../agent-runtime/runtime.ts";
import { hermesMessageId } from "../hermes/message-id.ts";
import {
  acceptSteerRequest,
  failSteerRequest,
  getActiveRuntimeRun,
  parseRuntimeRunDispatch,
  reserveSteerRequest,
} from "../hermes/run-store.ts";
import { artifactDeliveryFile, getArtifactById } from "../hermes/artifact-store.ts";
import { appendConversationSteerMessage } from "../conversations/store.ts";
import { telegramImageUrls } from "./format.ts";
import { getScheduledChatJobStore } from "../schedules/instance.ts";
import { parseExplicitScheduleRequest } from "../schedules/natural-language.ts";
import { presentScheduledChatJob } from "../schedules/store.ts";
import {
  scheduledChatConfirmationText,
  scheduledChatReceiptFromJob,
} from "../schedules/types.ts";
import { telegramTimings } from "./config.ts";
import {
  contactHandle,
  contactLabel,
  conversationTitleFor,
  senderIsAllowed,
} from "./identity.ts";
import { conversationIsSameDay, messageText, HELP_TEXT } from "./inbound-policy.ts";
import {
  deliverTelegramDelegatedFollowUps,
  telegramDelegatedWorkers,
  type TelegramDelegatedFollowUp,
  type TelegramFollowUpMessage,
} from "./delegated-follow-up.ts";
import { handleInboundReview } from "../review/delivery.ts";
import type { TelegramInboundMessage } from "./gateway.ts";
import type { TelegramStore } from "./store.ts";

export type TelegramRouteOutcome =
  | {
      status: "replied";
      reply: string;
      conversationId: string;
      delegatedFollowUp?: TelegramDelegatedFollowUp;
      /** The agent turn behind this reply, so its files can follow the text. */
      turn?: TelegramTurnRef;
    }
  | { status: "ignored"; reason: string }
  | { status: "failed"; reply: string; reason: string; lateReply?: TelegramLateReply };

export interface TelegramLateReply {
  conversationId: number;
  clientMessageId: string;
}

export interface TelegramTurnRef {
  conversationId: number;
  clientMessageId: string;
}

export interface RouteDependencies {
  store: TelegramStore;
  now?: () => Date;
  /** Called once the agent run is live, so later texts can steer it. */
  onTurnStarted?: (conversation: ConversationRow) => void;
}

/**
 * Wait for the turn the pump is persisting. Polling the durable transcript (as
 * opposed to subscribing to the stream) means a reply is still delivered if this
 * process restarts mid-answer and another poll picks the conversation up.
 */
async function awaitAssistantReply(
  conversationId: number,
  clientMessageId: string,
  timeoutMs: number,
): Promise<{
  status: "complete" | "failed" | "aborted" | "timeout";
  content: string;
  orderIndex?: number;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = listConversationMessages(conversationId, { limit: 500 })
      .map(presentConversationMessage)
      .find(
        (candidate) =>
          candidate.role === "assistant" && candidate.clientMessageId === clientMessageId,
      );
    if (message && message.status !== "pending") {
      return {
        status: message.status,
        content: message.content,
        orderIndex: message.orderIndex,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return { status: "timeout", content: "" };
}

/**
 * Route one inbound Telegram message. Returns the text to send back, or an
 * `ignored` outcome when the message must not produce a reply at all.
 */
export async function routeTelegramMessage(
  message: TelegramInboundMessage,
  deps: RouteDependencies,
): Promise<TelegramRouteOutcome> {
  const { store } = deps;
  const now = deps.now?.() ?? new Date();
  const settings = store.settings();

  if (settings.ownerUserId === null) {
    return { status: "ignored", reason: "no_owner" };
  }
  const ownerUserId = settings.ownerUserId;
  // A bot's @name is public, so an unlisted sender gets silence rather than a
  // "you are not allowed" reply that would confirm the bot is live.
  if (!senderIsAllowed(message, settings.allowedUsers)) {
    return { status: "ignored", reason: "not_allowed" };
  }

  const text = messageText(message);
  if (!text) return { status: "ignored", reason: "empty" };

  // Telegram appends `@botname` to commands sent in groups.
  const command = message.hasMedia ? "" : text.trim().toLowerCase().split(/\s+/)[0]?.replace(/@[\w_]+$/, "") ?? "";
  if (command === "/help" || command === "/start") {
    return { status: "replied", reply: HELP_TEXT, conversationId: "" };
  }

  // A message arriving while a review question is open in this thread is an
  // answer to that question, not the start of a chat. Grading it here — before
  // any conversation is created — is what stops "3" from being routed to the
  // assistant as an inscrutable one-word prompt.
  const review = message.hasMedia ? null : await handleInboundReview({ chatId: message.chatId, text });
  if (review) {
    return { status: "replied", reply: review.reply, conversationId: "" };
  }

  const label = contactLabel(message);
  store.upsertChat({
    chatId: message.chatId,
    userId: ownerUserId,
    contactLabel: label,
    contactHandle: contactHandle(message),
    isGroup: message.isGroup,
  });

  const forceNew = command === "/new";
  // A reminder is infrastructure work, not an agent research task. Intercept
  // it before Hermes so the gateway never burns a turn searching for a
  // scheduler tool, and so the eventual notification can be delivered even if
  // the agent runtime is stopped at that moment.
  const scheduledReminder = !message.hasMedia && !forceNew && /\bremind(?:er)?\b/i.test(text)
    ? parseExplicitScheduleRequest(text, now)
    : null;
  let createdConversation: ConversationRow | null = null;
  let createdScheduleId: number | null = null;

  try {
    // Fail before creating anything when the runtime is off, so a stopped runtime
    // answers Telegram with a reason instead of leaving an empty chat behind.
    if (!scheduledReminder) requireEnabled();
    const attachments = await prepareTelegramAttachments(ownerUserId, message);

    // Hermes is an on-demand service: after a few quiet minutes the supervisor
    // stops it, and only a lease can start it again — which this gateway
    // process cannot take itself. Wake it (via the dashboard) before anything
    // is created, so the turn below finds a live runtime. `/new` skips the
    // wait: it only names a fresh chat, no turn runs.
    if (!forceNew && !scheduledReminder) await wakeAgentRuntime("telegram-inbound");

    const { conversation, created } = db.transaction(() => {
      // A reminder may have opened today's chat while the runtime was waking.
      // Read the current binding and claim it atomically with outbound sends.
      const now = deps.now?.() ?? new Date();
      const chat = store.getChat(message.chatId)!;
      const existing =
        !forceNew && chat.conversation_id !== null
          ? getConversationById(chat.conversation_id)
          : null;
      const dailyConversation =
        existing !== null &&
        existing.user_id === ownerUserId &&
        existing.surface === "dashboard_terminal" &&
        conversationIsSameDay(existing.created_at, now)
          ? existing
          : null;
      const initialSummary = forceNew ? null : fallbackConversationTitle(text);

      const conversation =
        dailyConversation ??
        createConversation({
          userId: ownerUserId,
          title:
            initialSummary
              ? `Telegram:${initialSummary}`.slice(0, 120)
              : conversationTitleFor(label, forceNew ? "" : text),
          surface: "dashboard_terminal",
          originLabel: "Telegram",
          scopeKind: "global",
        });
      store.bindConversation(message.chatId, conversation.id);
      return { conversation, created: !dailyConversation };
    }).immediate();
    if (created) createdConversation = conversation;

    if (forceNew) {
      return {
        status: "replied",
        reply: "Started a fresh chat. Send your first message.",
        conversationId: conversation.public_id,
      };
    }

    const clientMessageId = `telegram-${message.messageId || `${message.chatId}-${Date.now()}`}`;
    if (scheduledReminder) {
      const preference = getHermesUserSettings(ownerUserId);
      const scheduleRow = getScheduledChatJobStore().create(
        ownerUserId,
        {
          title: scheduledReminder.title,
          prompt: scheduledReminder.prompt,
          cron: scheduledReminder.cron,
          surface: "dashboard_terminal",
          model: preference.fallbackModel,
          reasoningEffort: preference.reasoningEffort,
          deliveryChannel: "telegram",
          deliveryMode: "reminder",
          oneShot: scheduledReminder.oneShot,
          runAt: scheduledReminder.runAt,
        },
        now,
      );
      createdScheduleId = scheduleRow.id;
      const receipt = scheduledChatReceiptFromJob(
        presentScheduledChatJob(scheduleRow, now),
      );
      const reply = scheduledChatConfirmationText(receipt);
      reserveConversationTurn({
        conversation,
        clientMessageId,
        surface: "dashboard_terminal",
        content: text,
        metadata: { scheduledChatReceipt: receipt },
      });
      completeAssistantMessage({
        conversationId: conversation.id,
        clientMessageId,
        content: reply,
        metadata: { scheduledChatReceipt: receipt },
      });
      return {
        status: "replied",
        reply,
        conversationId: conversation.public_id,
      };
    }

    // Mirror the browser's ordering: attach the pump that persists the assistant
    // turn before the prompt is dispatched, so no early output can be missed.
    const runtime = await resolveConversationRuntime({
      conversation,
      surface: "dashboard_terminal",
      activeGardenSlug: null,
      activePageSlug: null,
    });
    startSessionEventPump(runtime);

    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text,
      attachments,
      surface: "dashboard_terminal",
      surfaceContext: { deliveryChannel: "telegram" },
      // Messaging has no composer switch, so every inbound phone turn uses
      // Breadboard's full inventory-aware router by default.
      superAgent: true,
    });

    if (!result.accepted) {
      if ("blocked" in result) {
        return {
          status: "failed",
          reason: "awaiting_permission",
          reply:
            "That needs a permission decision I can only take in the Breadboard app. Open the chat there to approve it.",
        };
      }
      if ("clarified" in result) {
        return {
          status: "replied",
          reply: result.message,
          conversationId: conversation.public_id,
        };
      }
      return {
        status: "failed",
        reason: "not_accepted",
        reply: "Breadboard could not start that turn. Try again in a moment.",
      };
    }

    deps.onTurnStarted?.(conversation);
    const reply = await awaitAssistantReply(
      conversation.id,
      clientMessageId,
      telegramTimings().turnTimeoutMs,
    );

    if (reply.status === "complete" && reply.content.trim()) {
      return {
        status: "replied",
        reply: reply.content.trim(),
        conversationId: conversation.public_id,
        turn: { conversationId: conversation.id, clientMessageId },
        ...(reply.orderIndex !== undefined &&
        telegramDelegatedWorkers(
          listConversationMessages(conversation.id, { limit: 500 }).map(
            telegramFollowUpMessage,
          ),
          reply.orderIndex,
        ).length > 0
          ? {
              delegatedFollowUp: {
                conversationId: conversation.id,
                afterOrder: reply.orderIndex,
              },
            }
          : {}),
      };
    }
    if (reply.status === "timeout") {
      return {
        status: "failed",
        reason: "timeout",
        reply:
          "That is taking a while. I will send the answer here when it finishes; it is also in the Breadboard app.",
        lateReply: { conversationId: conversation.id, clientMessageId },
      };
    }
    return {
      status: "failed",
      reason: reply.status,
      reply:
        reply.content.trim() ||
        "That turn did not finish. Open the chat in Breadboard to see what happened.",
    };
  } catch (cause) {
    if (createdScheduleId !== null) {
      try {
        getScheduledChatJobStore().delete(ownerUserId, createdScheduleId);
      } catch {
        // If the transcript write failed, keeping the direct reminder would be
        // surprising because the sender receives the failure below.
      }
    }
    // A turn that failed before producing anything must not strand an empty
    // chat in Recents; the failure still reaches the sender as the reply below.
    // The dangling chat binding is fine — the next message finds no
    // conversation behind it and opens a fresh one.
    if (
      createdConversation &&
      listConversationMessages(createdConversation.id, {
        limit: 1,
        includePending: true,
      }).length === 0
    ) {
      try {
        deleteConversation(createdConversation);
      } catch {
        // Keeping the empty chat is better than losing the error reply.
      }
    }
    return {
      status: "failed",
      reason: "error",
      reply:
        cause instanceof Error
          ? `Breadboard could not answer: ${cause.message}`
          : "Breadboard could not answer that message.",
    };
  }
}

function telegramFollowUpMessage(
  row: ReturnType<typeof listConversationMessages>[number],
): TelegramFollowUpMessage {
  const message = presentConversationMessage(row);
  return {
    clientMessageId: message.clientMessageId,
    role: message.role,
    content: message.content,
    status: message.status,
    orderIndex: message.orderIndex,
    metadata: message.metadata,
  };
}

/**
 * Deliver the answer a timed-out inbound turn eventually produced, then any
 * delegated-agent hand-backs that answer owns. Runs detached from the inbound
 * drain so a slow turn never blocks the chat's queue of later messages.
 */
export async function deliverTelegramLateReply(
  late: TelegramLateReply,
  onReply: (content: string) => Promise<void>,
): Promise<void> {
  const conversation = getConversationById(late.conversationId);
  if (!conversation || conversation.surface !== "dashboard_terminal") return;
  const result = await deliverLateAssistantReply({
    clientMessageId: late.clientMessageId,
    listMessages: () =>
      listConversationMessages(conversation.id, { limit: 500 }).map(
        telegramFollowUpMessage,
      ),
    onReply,
    maxWaitMs: LATE_REPLY_MAX_WAIT_MS,
  });
  if (result.status === "complete" && result.orderIndex !== undefined) {
    await deliverTelegramFollowUps(
      { conversationId: conversation.id, afterOrder: result.orderIndex },
      onReply,
    );
  }
}

/** Finish and emit every private delegated-agent hand-back owned by Telegram. */
export async function deliverTelegramFollowUps(
  followUp: TelegramDelegatedFollowUp,
  onReply: (content: string) => Promise<void>,
): Promise<void> {
  const conversation = getConversationById(followUp.conversationId);
  if (!conversation || conversation.surface !== "dashboard_terminal") return;

  await deliverTelegramDelegatedFollowUps({
    ...followUp,
    listMessages: () =>
      listConversationMessages(conversation.id, { limit: 500 }).map(
        telegramFollowUpMessage,
      ),
    startContinuation: async ({ clientMessageId, text }) => {
      const result = await startConversationTurn({
        conversation,
        clientMessageId,
        text,
        surface: "dashboard_terminal",
        surfaceContext: { deliveryChannel: "telegram" },
        internalAgentContinuation: true,
        superAgent: true,
      });
      if (!result.accepted && !("replayed" in result)) {
        throw new Error("The delegated Telegram follow-up was not accepted.");
      }
    },
    onReply,
    // Max Research is intentionally long-running. Keep the transport attached
    // for up to two hours; its own runtime still owns cancellation and failure.
    maxWaitMs: 2 * 60 * 60 * 1_000,
  });
}

/**
 * Fold a text that arrives mid-answer into the running turn, the way the
 * Terminal's steer button does, so a double text changes the answer instead
 * of waiting behind it. Returns false when there is nothing to steer (the
 * turn already finished, or Hermes refused), and the caller queues the text.
 */
export async function steerTelegramTurn(
  conversation: ConversationRow,
  message: TelegramInboundMessage,
): Promise<boolean> {
  const text = messageText(message).trim();
  // Files need the full attachment pipeline, and commands are not prose.
  if (!text || message.hasMedia || text.startsWith("/")) return false;
  let session;
  try {
    session = authorizeRuntimeReference(conversation.user_id, conversation.public_id);
  } catch {
    return false;
  }
  const run = getActiveRuntimeRun(session.row.id);
  if (!run) return false;
  const dispatch = parseRuntimeRunDispatch(run);
  const clientRequestId = `telegram-steer-${message.messageId}`.slice(0, 200);
  const reserved = reserveSteerRequest({
    runtimeSessionId: session.row.id,
    runId: run.id,
    clientRequestId,
    content: text,
  });
  if (!reserved.created) return reserved.request.status === "accepted";
  try {
    const accepted = await getAgentRuntimeByKind(session.runtimeKind).steerRun({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      agentName: session.agentName,
      text,
      model: dispatch.model,
      variant: dispatch.variant,
      tools: dispatch.tools,
      system: dispatch.system,
      clientRequestId,
      messageId: dispatch.clientMessageId ? hermesMessageId(dispatch.clientMessageId) : undefined,
    });
    if (!accepted) {
      failSteerRequest(reserved.request.id, "steer_unavailable");
      return false;
    }
  } catch {
    failSteerRequest(reserved.request.id, "steer_dispatch_failed");
    return false;
  }
  acceptSteerRequest({
    requestId: reserved.request.id,
    runtimeSessionId: session.row.id,
    chatSessionId: session.row.chat_session_id,
    content: text,
    resultRunId: run.id,
    resultMode: "steer",
  });
  try {
    const pending = dispatch.clientMessageId
      ? listConversationMessages(conversation.id, { limit: 500, includePending: true })
        .map(presentConversationMessage)
        .find((row) => row.role === "assistant" && row.clientMessageId === dispatch.clientMessageId)
      : undefined;
    appendConversationSteerMessage({
      conversationId: conversation.id,
      clientMessageId: `steer:${clientRequestId}`,
      surface: "dashboard_terminal",
      content: text,
      targetClientMessageId: dispatch.clientMessageId,
      assistantContentOffset: pending?.content.length ?? 0,
    });
  } catch {
    // The correction already reached the run; the transcript row is cosmetic.
  }
  return true;
}

export interface TelegramReplyFile {
  artifactId: string;
  absolutePath: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}

/** What a phone can usefully open; HTML pages, gadgets and folders stay in the app. */
const SENDABLE_KINDS = new Set(["image", "video", "audio", "pdf", "document", "presentation", "spreadsheet", "model"]);
/** The hosted Bot API refuses uploads above 50 MB. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function sqliteTimeToIso(value: string): string {
  const parsed = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

/**
 * Files the turn produced (generated images, rendered videos, documents) plus
 * web images its answer embeds. `exclude` holds artifact ids already sent, so
 * a later call after delegated follow-ups only adds what is new.
 */
export function telegramTurnMedia(
  turn: TelegramTurnRef,
  content: string,
  exclude: ReadonlySet<string> = new Set(),
): { files: TelegramReplyFile[]; imageUrls: string[] } {
  const imageUrls = telegramImageUrls(content);
  const userMessage = listConversationMessages(turn.conversationId, { limit: 500 })
    .find((row) => row.role === "user" && presentConversationMessage(row).clientMessageId === turn.clientMessageId);
  if (!userMessage) return { files: [], imageUrls };
  const rows = db.prepare(
    `SELECT id, kind FROM hermes_artifacts
     WHERE conversation_id = ? AND created_at >= ? AND status = 'ready'
     ORDER BY created_at ASC LIMIT 40`,
  ).all(turn.conversationId, sqliteTimeToIso(userMessage.created_at)) as Array<{ id: string; kind: string }>;
  const files: TelegramReplyFile[] = [];
  for (const row of rows) {
    if (files.length >= 10) break;
    if (exclude.has(row.id) || !SENDABLE_KINDS.has(row.kind)) continue;
    const artifact = getArtifactById(row.id);
    if (!artifact) continue;
    try {
      const file = artifactDeliveryFile(artifact);
      if (file.byteSize > 0 && file.byteSize <= MAX_UPLOAD_BYTES) {
        files.push({ artifactId: row.id, ...file });
      }
    } catch {
      // A card whose file is gone is still in the app; nothing to send.
    }
  }
  return { files, imageUrls };
}
