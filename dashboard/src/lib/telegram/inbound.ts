// Turning an inbound Telegram message into a real Breadboard chat.
//
// The message goes through exactly the pipeline the browser uses —
// `createConversation` + `resolveConversationRuntime` + `startConversationTurn` —
// so the chat shows up in the Terminal's Recents, carries the same memory,
// capabilities and audit trail, and can be reopened and continued by hand. That
// is the whole point of driving the Bot API here rather than pointing it at some
// separate bot runtime with a transcript store of its own.
//
// A Telegram thread maps to one conversation while it stays warm; after a quiet
// period (or an explicit /new) the next message opens a fresh chat.

import { wakeAgentRuntime } from "../agent-runtime/wake.ts";
import {
  createConversation,
  deleteConversation,
  getConversationById,
  listConversationMessages,
  presentConversationMessage,
  type ConversationRow,
} from "../conversations/store.ts";
import { startConversationTurn } from "../conversations/turn-service.ts";
import { startSessionEventPump } from "../hermes/event-stream.ts";
import { requireEnabled } from "../hermes/route-core.ts";
import { resolveConversationRuntime } from "../hermes/session-service.ts";
import { telegramTimings } from "./config.ts";
import {
  contactHandle,
  contactLabel,
  conversationTitleFor,
  senderIsAllowed,
} from "./identity.ts";
import { conversationIsWarm, messageText, HELP_TEXT, MAX_REPLY_CHARS } from "./inbound-policy.ts";
import { handleInboundReview } from "../review/delivery.ts";
import type { TelegramInboundMessage } from "./gateway.ts";
import type { TelegramStore } from "./store.ts";

export type TelegramRouteOutcome =
  | { status: "replied"; reply: string; conversationId: string }
  | { status: "ignored"; reason: string }
  | { status: "failed"; reply: string; reason: string };

export interface RouteDependencies {
  store: TelegramStore;
  now?: () => Date;
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
): Promise<{ status: "complete" | "failed" | "aborted" | "timeout"; content: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = listConversationMessages(conversationId, { limit: 500 })
      .map(presentConversationMessage)
      .find(
        (candidate) =>
          candidate.role === "assistant" && candidate.clientMessageId === clientMessageId,
      );
    if (message && message.status !== "pending") {
      return { status: message.status, content: message.content };
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
  // A bot's @name is public, so an unlisted sender gets silence rather than a
  // "you are not allowed" reply that would confirm the bot is live.
  if (!senderIsAllowed(message, settings.allowedUsers)) {
    return { status: "ignored", reason: "not_allowed" };
  }

  const text = messageText(message);
  if (!text) return { status: "ignored", reason: "empty" };

  // Telegram appends `@botname` to commands sent in groups.
  const command = text.trim().toLowerCase().split(/\s+/)[0]?.replace(/@[\w_]+$/, "") ?? "";
  if (command === "/help" || command === "/start") {
    return { status: "replied", reply: HELP_TEXT, conversationId: "" };
  }

  // A message arriving while a review question is open in this thread is an
  // answer to that question, not the start of a chat. Grading it here — before
  // any conversation is created — is what stops "3" from being routed to the
  // assistant as an inscrutable one-word prompt.
  const review = await handleInboundReview({ chatId: message.chatId, text });
  if (review) {
    return { status: "replied", reply: review.reply, conversationId: "" };
  }

  const label = contactLabel(message);
  const chat = store.upsertChat({
    chatId: message.chatId,
    userId: settings.ownerUserId,
    contactLabel: label,
    contactHandle: contactHandle(message),
    isGroup: message.isGroup,
  });

  const forceNew = command === "/new";
  let createdConversation: ConversationRow | null = null;

  try {
    // Fail before creating anything when the runtime is off, so a stopped runtime
    // answers Telegram with a reason instead of leaving an empty chat behind.
    requireEnabled();

    // Hermes is an on-demand service: after a few quiet minutes the supervisor
    // stops it, and only a lease can start it again — which this gateway
    // process cannot take itself. Wake it (via the dashboard) before anything
    // is created, so the turn below finds a live runtime. `/new` skips the
    // wait: it only names a fresh chat, no turn runs.
    if (!forceNew) await wakeAgentRuntime("telegram-inbound");

    const existing =
      !forceNew && chat.conversation_id !== null
        ? getConversationById(chat.conversation_id)
        : null;
    const warm =
      existing !== null &&
      existing.user_id === settings.ownerUserId &&
      existing.surface === "dashboard_terminal" &&
      conversationIsWarm(chat.last_message_at, now)
        ? existing
        : null;

    const conversation =
      warm ??
      createConversation({
        userId: settings.ownerUserId,
        title: conversationTitleFor(label, forceNew ? "" : text),
        surface: "dashboard_terminal",
        scopeKind: "global",
      });
    if (!warm) createdConversation = conversation;

    store.bindConversation(message.chatId, conversation.id);

    if (forceNew) {
      return {
        status: "replied",
        reply: "Started a fresh chat. Send your first message.",
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

    const clientMessageId = `telegram-${message.messageId || `${message.chatId}-${Date.now()}`}`;
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text,
      surface: "dashboard_terminal",
      surfaceContext: { deliveryChannel: "telegram" },
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

    const reply = await awaitAssistantReply(
      conversation.id,
      clientMessageId,
      telegramTimings().turnTimeoutMs,
    );

    if (reply.status === "complete" && reply.content.trim()) {
      return {
        status: "replied",
        reply: reply.content.trim().slice(0, MAX_REPLY_CHARS),
        conversationId: conversation.public_id,
      };
    }
    if (reply.status === "timeout") {
      return {
        status: "failed",
        reason: "timeout",
        reply:
          "That is taking a while. The answer will finish in the Breadboard app — open the chat there to read it.",
      };
    }
    return {
      status: "failed",
      reason: reply.status,
      reply:
        reply.content.trim().slice(0, MAX_REPLY_CHARS) ||
        "That turn did not finish. Open the chat in Breadboard to see what happened.",
    };
  } catch (cause) {
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
