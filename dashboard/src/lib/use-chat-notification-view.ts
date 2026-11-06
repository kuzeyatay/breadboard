"use client";

import { useLayoutEffect } from "react";
import { registerChatNotificationTarget, type ChatNotificationTarget } from "./chat-notification-inbox";

/** Each visible surface owns its registration, including two chats on one page. */
export function useChatNotificationView(target: ChatNotificationTarget | null): void {
  const surface = target?.surface;
  const chatId = target?.chatId;
  const gardenSlug = target?.gardenSlug;
  const conversationId = target?.conversationId;
  // Register before passive inbox effects can announce a newly visible answer.
  // Depend on identity fields so streaming tokens do not release/recreate it.
  useLayoutEffect(() => {
    if (!surface || !chatId) return;
    return registerChatNotificationTarget({ surface, chatId, gardenSlug, conversationId });
  }, [surface, chatId, gardenSlug, conversationId]);
}
