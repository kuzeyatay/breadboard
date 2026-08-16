// Turning an inbound WhatsApp message into a real Breadboard chat.
//
// This is the reason Breadboard drives the Baileys bridge directly instead of
// running `hermes gateway`: the gateway would answer from its own private
// session store, so nothing would ever appear in the app. Here the message goes
// through exactly the pipeline the browser uses — `createConversation` +
// `resolveConversationRuntime` + `startConversationTurn` — so the chat shows up
// in the Terminal's Recents, carries the same memory, capabilities and audit
// trail, and can be reopened and continued by hand.
//
// A WhatsApp thread maps to one conversation while it stays warm; after a quiet
// period (or an explicit `/new`) the next message opens a fresh chat.

import {
  createConversation,
  getConversationById,
  listConversationMessages,
  presentConversationMessage,
} from "../conversations/store.ts";
import { startConversationTurn } from "../conversations/turn-service.ts";
import { startSessionEventPump } from "../hermes/event-stream.ts";
import { requireEnabled } from "../hermes/route-core.ts";
import { getHermesUserSettings } from "../hermes/runtime-store.ts";
import { resolveConversationRuntime } from "../hermes/session-service.ts";
import { whatsAppReplyPrefix, whatsAppTimings } from "./config.ts";
import {
  contactLabel,
  conversationTitleFor,
  isGroupChat,
  normalizeWhatsAppIdentifier,
  senderIsAllowed,
} from "./identity.ts";
import {
  conversationIsWarm,
  messageText,
  HELP_TEXT,
  MAX_REPLY_CHARS,
} from "./inbound-policy.ts";
import { handleInboundReview } from "../review/delivery.ts";
import type { WhatsAppInboundMessage } from "./bridge.ts";
import type { WhatsAppStore } from "./store.ts";

export type WhatsAppRouteOutcome =
  | { status: "replied"; reply: string; conversationId: string }
  | { status: "ignored"; reason: string }
  | { status: "failed"; reply: string; reason: string };

export interface RouteDependencies {
  store: WhatsAppStore;
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
 * Route one inbound WhatsApp message. Returns the text to send back, or an
 * `ignored` outcome when the message must not produce a reply at all.
 */
export async function routeWhatsAppMessage(
  message: WhatsAppInboundMessage,
  deps: RouteDependencies,
): Promise<WhatsAppRouteOutcome> {
  const { store } = deps;
  const now = deps.now?.() ?? new Date();
  const settings = store.settings();

  if (settings.ownerUserId === null) {
    return { status: "ignored", reason: "no_owner" };
  }
  if (!senderIsAllowed(message.senderId, settings.allowedNumbers, settings.mode)) {
    return { status: "ignored", reason: "not_allowed" };
  }

  const prefix = whatsAppReplyPrefix();
  if (prefix && message.body.startsWith(prefix)) {
    // Our own reply came back as an inbound self-chat message.
    return { status: "ignored", reason: "own_reply" };
  }

  const text = messageText(message);
  if (!text) return { status: "ignored", reason: "empty" };

  const command = text.trim().toLowerCase();
  if (command === "/help") {
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
    contactNumber: normalizeWhatsAppIdentifier(message.senderId || message.chatId),
    isGroup: message.isGroup || isGroupChat(message.chatId),
  });

  const forceNew = command === "/new";

  try {
    // Fail before creating anything when the runtime is off, so a stopped runtime
    // answers WhatsApp with a reason instead of leaving an empty chat behind.
    requireEnabled();

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

    // WhatsApp has no model picker, so the owner's saved Intelligence choice is
    // the selection. Without this the turn falls through to the hardcoded
    // DEFAULT_MODEL, which answers from a different model than every other
    // surface — and fails outright when that model is the one the user moved
    // away from. `getHermesUserSettings` returns DEFAULT_MODEL when nothing is
    // stored, so an owner who never chose keeps the old behaviour.
    const preference = getHermesUserSettings(settings.ownerUserId);

    const clientMessageId = `whatsapp-${message.messageId || `${message.chatId}-${Date.now()}`}`;
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text,
      surface: "dashboard_terminal",
      // The chat is a Terminal chat like any other, so the surface alone would
      // have the agent answering as if the reader were looking at the app.
      surfaceContext: { deliveryChannel: "whatsapp" },
      model: preference.defaultModel,
      reasoningEffort: preference.reasoningEffort,
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
      whatsAppTimings().turnTimeoutMs,
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
          "That is taking longer than WhatsApp can wait on. The answer will finish in the Breadboard app.",
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
