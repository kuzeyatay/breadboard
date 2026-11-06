export interface StarredMessage {
  conversationId: string;
  messageId: string;
  clientMessageId: string;
  chatId: string;
  legacyChatId?: string | null;
  title: string;
  preview: string;
  gardenSlug: string | null;
  starredAt: string;
  sideChat?: boolean;
  workspaceChat?: boolean;
}

export interface StarredMessageContent {
  messageId: string;
  content: string;
}

export function starredMessageHref(message: StarredMessage): string {
  const gardenSlug = starredMessageWorkspace(message);
  const query = new URLSearchParams({
    [message.sideChat ? "sideChat" : gardenSlug ? "chat" : "terminalChat"]: message.sideChat ? message.conversationId : message.chatId,
    message: message.messageId,
  });
  return `${gardenSlug ? `/gardens/${encodeURIComponent(gardenSlug)}` : "/dashboard"}?${query}`;
}

/** Reader chats appear in their Garden's stars, and open through the message hub. */
export function starredMessageWorkspace(message: StarredMessage): string | undefined {
  return message.sideChat || message.workspaceChat !== false ? message.gardenSlug ?? undefined : undefined;
}

export function matchesStarredMessage(message: StarredMessage, conversationId: string, messageId: string): boolean {
  return (message.conversationId === conversationId || message.chatId === conversationId || message.legacyChatId === conversationId) &&
    (message.messageId === messageId || message.clientMessageId === messageId);
}
