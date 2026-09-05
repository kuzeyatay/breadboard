import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  ConversationStoreError,
  getConversationForLegacyChatSession,
  getConversationForUser,
  type ConversationRow,
} from "../conversations/store.ts";
import type { ChatNotificationTarget } from "../chat-notification-inbox.ts";
import { ApiError } from "../hermes/route-core.ts";

export interface ResolvedNotificationReply {
  conversation: ConversationRow;
  activeGardenSlug: string | null;
}

/** Resolve an untrusted notification target to one conversation owned by the caller. */
export function resolveNotificationReply(
  target: ChatNotificationTarget,
  userId: number,
  database: Database.Database = db,
): ResolvedNotificationReply {
  try {
    if (target.surface === "dashboard_terminal") {
      const conversation = getConversationForUser(target.chatId, userId, database);
      if (conversation.surface !== "dashboard_terminal") {
        throw new ApiError(
          404,
          "conversation_not_found",
          "Conversation not found.",
        );
      }
      return { conversation, activeGardenSlug: null };
    }

    if (target.surface !== "garden_chat") {
      throw new ApiError(
        400,
        "notification_reply_unsupported",
        "This notification does not accept replies.",
      );
    }

    const chatSessionId = Number(target.chatId);
    if (!Number.isSafeInteger(chatSessionId) || chatSessionId < 1) {
      throw new ApiError(
        400,
        "invalid_chat_id",
        "This chat is no longer available for replies.",
      );
    }
    const conversation = getConversationForLegacyChatSession(
      chatSessionId,
      userId,
      database,
    );
    const garden = database
      .prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
      .get(conversation.default_garden_id, userId) as { slug: string } | undefined;
    if (!garden || garden.slug !== target.gardenSlug) {
      throw new ApiError(
        404,
        "conversation_not_found",
        "Conversation not found.",
      );
    }
    return { conversation, activeGardenSlug: garden.slug };
  } catch (error) {
    if (error instanceof ConversationStoreError) {
      throw new ApiError(error.status, error.code, error.message);
    }
    throw error;
  }
}
