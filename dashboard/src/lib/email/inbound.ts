// Turning an inbound email into a real Breadboard chat.
//
// Same pipeline as every other surface — `createConversation` +
// `resolveConversationRuntime` + `startConversationTurn` — so a mail thread
// shows up in the Terminal's Recents, carries the same memory, capabilities
// and audit trail, and can be picked up and continued by hand. Mail is a
// channel the assistant speaks through, not a separate assistant.
//
// A correspondent maps to one conversation while the thread stays warm; after
// a long enough silence the next message opens a fresh chat, so a mail sent in
// March does not land in the middle of January's context.

import {
  createConversation,
  getConversationById,
  listConversationMessages,
  presentConversationMessage,
} from "../conversations/store.ts";
import { startConversationTurn } from "../conversations/turn-service.ts";
import { startSessionEventPump } from "../hermes/event-stream.ts";
import { requireEnabled } from "../hermes/route-core.ts";
import { resolveConversationRuntime } from "../hermes/session-service.ts";
import { emailTimings, MAX_REPLY_CHARS } from "./config.ts";
import type { ImapMessage } from "./imap.ts";
import {
  bindConversation,
  claimMessage,
  getThread,
  readSettings,
  recordInbound,
  senderIsAllowed,
  type EmailSettings,
} from "./store.ts";

export type EmailRouteOutcome =
  | { status: "replied"; reply: string; subject: string; conversationId: string }
  | { status: "ignored"; reason: string }
  | { status: "failed"; reply: string; subject: string; reason: string };

/**
 * Mail that must never be answered.
 *
 * Two robots replying to each other is the classic mail-loop failure, and it
 * is expensive here: every bounce would start a turn. These headers and
 * address shapes are the standard ways a message says "do not reply", and they
 * are checked before anything else happens.
 */
function isAutomated(message: ImapMessage): boolean {
  const from = message.from.toLowerCase();
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce|notifications?)@/.test(from)) {
    return true;
  }
  return /^(re:\s*)*(out of office|automatic reply|undeliverable|delivery status)/i.test(
    message.subject,
  );
}

function conversationTitleFor(label: string, subject: string): string {
  const cleaned = subject.replace(/^(re|fwd?)\s*:\s*/i, "").trim();
  if (cleaned) return cleaned.slice(0, 120);
  return `Email with ${label}`.slice(0, 120);
}

function replySubject(subject: string): string {
  const cleaned = subject.trim();
  if (!cleaned) return "Re: your message";
  return /^re\s*:/i.test(cleaned) ? cleaned : `Re: ${cleaned}`;
}

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
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { status: "timeout", content: "" };
}

function threadIsWarm(lastMessageAt: string, now: Date, windowMs: number): boolean {
  const last = new Date(`${lastMessageAt.replace(" ", "T")}Z`).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < windowMs;
}

export interface EmailRouteDependencies {
  settings?: EmailSettings;
  ownerAddress?: string | null;
  now?: () => Date;
}

/**
 * Route one inbound message. Returns the text to send back, or an `ignored`
 * outcome when the message must not produce a reply at all.
 *
 * Silence rather than a refusal for an unknown sender: an address that is not
 * on the list should not learn that an assistant is reading this mailbox.
 */
export async function routeEmailMessage(
  message: ImapMessage,
  deps: EmailRouteDependencies = {},
): Promise<EmailRouteOutcome> {
  const settings = deps.settings ?? readSettings();
  const now = deps.now?.() ?? new Date();
  const ownerAddress = deps.ownerAddress ?? settings.address;

  if (settings.ownerUserId === null) return { status: "ignored", reason: "no_owner" };
  if (isAutomated(message)) return { status: "ignored", reason: "automated" };
  if (!senderIsAllowed(message.from, settings, ownerAddress)) {
    return { status: "ignored", reason: "not_allowed" };
  }

  const text = message.text.trim();
  if (!text) return { status: "ignored", reason: "empty" };

  // The second barrier behind the \Seen flag: a message that already produced
  // a turn must never produce another, however it came back around.
  if (!claimMessage(message.messageId)) {
    return { status: "ignored", reason: "already_handled" };
  }

  const label = message.fromName || message.from;
  const subject = replySubject(message.subject);

  try {
    // Fail before creating anything when the runtime is off, so a stopped
    // runtime answers with a reason instead of leaving an empty chat behind.
    requireEnabled();

    const thread = recordInbound({
      address: message.from,
      userId: settings.ownerUserId,
      label,
      messageId: message.messageId,
      subject: message.subject,
    });

    const previous =
      thread.conversation_id !== null ? getConversationById(thread.conversation_id) : null;
    const warm =
      previous !== null &&
      previous.user_id === settings.ownerUserId &&
      previous.surface === "dashboard_terminal" &&
      threadIsWarm(thread.last_message_at, now, emailTimings().newThreadAfterMs)
        ? previous
        : null;

    const conversation =
      warm ??
      createConversation({
        userId: settings.ownerUserId,
        title: conversationTitleFor(label, message.subject),
        surface: "dashboard_terminal",
        scopeKind: "global",
      });

    bindConversation(message.from, conversation.id);

    // Mirror the browser's ordering: attach the pump that persists the
    // assistant turn before the prompt is dispatched, so no early output is
    // missed.
    const runtime = await resolveConversationRuntime({
      conversation,
      surface: "dashboard_terminal",
      activeGardenSlug: null,
      activePageSlug: null,
    });
    startSessionEventPump(runtime);

    const clientMessageId = `email-${message.messageId}`;
    // The subject is context the body often relies on ("see below", "this
    // one"), so it is passed along rather than dropped as metadata.
    const prompt = message.subject.trim()
      ? `Subject: ${message.subject.trim()}\n\n${text}`
      : text;

    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text: prompt,
      surface: "dashboard_terminal",
    });

    if (!result.accepted) {
      if ("blocked" in result) {
        return {
          status: "failed",
          reason: "awaiting_permission",
          subject,
          reply:
            "That needs a permission decision I can only take in the Breadboard app. " +
            "Open the chat there to approve it and I will carry on.",
        };
      }
      if ("clarified" in result) {
        return {
          status: "replied",
          reply: result.message,
          subject,
          conversationId: conversation.public_id,
        };
      }
      return {
        status: "failed",
        reason: "not_accepted",
        subject,
        reply: "Breadboard could not start that turn. Send it again in a moment.",
      };
    }

    const reply = await awaitAssistantReply(
      conversation.id,
      clientMessageId,
      emailTimings().turnTimeoutMs,
    );

    if (reply.status === "complete" && reply.content.trim()) {
      return {
        status: "replied",
        reply: reply.content.trim().slice(0, MAX_REPLY_CHARS),
        subject,
        conversationId: conversation.public_id,
      };
    }
    if (reply.status === "timeout") {
      return {
        status: "failed",
        reason: "timeout",
        subject,
        // Say where the answer went. A mail that goes unanswered with no
        // explanation is worse than one that says the work is still running.
        reply:
          "This one is taking longer than I can hold a mail open for. " +
          "It is still running — the answer will be in the chat in the Breadboard app.",
      };
    }
    return {
      status: "failed",
      reason: reply.status,
      subject,
      reply: "That turn did not finish. The chat is in the Breadboard app if you want to retry it.",
    };
  } catch (cause) {
    return {
      status: "failed",
      reason: "error",
      subject,
      reply:
        cause instanceof Error && cause.message
          ? `I could not answer that: ${cause.message}`
          : "I could not answer that.",
    };
  }
}
