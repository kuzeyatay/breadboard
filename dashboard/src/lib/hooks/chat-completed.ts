// Internal "Chat completed" hook trigger. The canonical conversation store
// calls this only after an assistant message has been durably committed with
// status=complete. Failed and aborted turns never enter this module.

import "server-only";

import db from "@/lib/db.ts";
import {
  listEnabledChatCompletionHooks,
  recordDelivery,
  recordHookFire,
} from "./store.ts";

const MAX_MESSAGE_CHARS = 32_000;

interface CompletedConversationRow {
  public_id: string;
  user_id: number;
  title: string;
  surface: string;
  temporary: number;
  garden_slug: string | null;
}

interface CompletedMessageRow {
  id: number;
  content: string;
  status: string;
  updated_at: string;
}

function boundedMessage(content: string): {
  text: string;
  truncated: boolean;
} {
  if (content.length <= MAX_MESSAGE_CHARS) {
    return { text: content, truncated: false };
  }
  return {
    text: content.slice(0, MAX_MESSAGE_CHARS),
    truncated: true,
  };
}

/**
 * Dispatch every matching completion hook exactly once for this assistant
 * message. The hook-created turn id prefix is an explicit recursion guard: a
 * completion hook may start a chat, but that unattended chat cannot trigger
 * another completion automation and form a loop.
 */
export function fireSuccessfulChatHooks(input: {
  conversationId: number;
  clientMessageId: string;
}): void {
  if (input.clientMessageId.startsWith("hook-")) return;

  try {
    const conversation = db
      .prepare(
        `SELECT c.public_id, c.user_id, c.title, c.surface, c.temporary,
                clusters.slug AS garden_slug
         FROM conversations c
         LEFT JOIN clusters ON clusters.id = c.default_garden_id
         WHERE c.id = ?`,
      )
      .get(input.conversationId) as CompletedConversationRow | undefined;
    if (!conversation || conversation.temporary === 1) return;

    const assistant = db
      .prepare(
        `SELECT id, content, status, updated_at
         FROM conversation_messages
         WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
      )
      .get(input.conversationId, input.clientMessageId) as
      | CompletedMessageRow
      | undefined;
    if (!assistant || assistant.status !== "complete") return;

    const user = db
      .prepare(
        `SELECT content
         FROM conversation_messages
         WHERE conversation_id = ? AND client_message_id = ? AND role = 'user'`,
      )
      .get(input.conversationId, input.clientMessageId) as
      | { content: string }
      | undefined;
    const request = boundedMessage(user?.content ?? "");
    const response = boundedMessage(assistant.content);
    const payload = {
      event: "chat.completed",
      completedAt: assistant.updated_at,
      conversation: {
        id: conversation.public_id,
        title: conversation.title,
        surface: conversation.surface,
        gardenSlug: conversation.garden_slug,
      },
      turn: {
        clientMessageId: input.clientMessageId,
        request: request.text,
        response: response.text,
        requestTruncated: request.truncated,
        responseTruncated: response.truncated,
      },
    };

    const hooks = listEnabledChatCompletionHooks(
      conversation.user_id,
      conversation.garden_slug,
      db,
    );
    for (const hook of hooks) {
      const deliveryKey = `chat.completed:${assistant.id}`;
      if (!recordDelivery(hook.id, deliveryKey, db)) continue;
      recordHookFire(hook.id, db);
      void import("./dispatch.ts")
        .then(({ dispatchHook }) => dispatchHook(hook, payload))
        .catch((error) => {
          console.error(`[hooks] chat completion dispatch failed for hook ${hook.id}`, error);
        });
    }
  } catch (error) {
    // Completion hooks are post-commit automation. They must never turn a
    // successfully persisted chat into an error for the person who sent it.
    console.error("[hooks] failed to evaluate chat completion hooks", error);
  }
}
