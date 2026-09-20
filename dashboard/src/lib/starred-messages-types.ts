export interface StarredMessage {
  conversationId: string;
  messageId: string;
  clientMessageId: string;
  chatId: string;
  title: string;
  preview: string;
  gardenSlug: string | null;
  starredAt: string;
}

export function starredMessageHref(message: StarredMessage): string {
  const query = new URLSearchParams({
    [message.gardenSlug ? "chat" : "terminalChat"]: message.chatId,
    message: message.messageId,
  });
  return `${message.gardenSlug ? `/gardens/${encodeURIComponent(message.gardenSlug)}` : "/dashboard"}?${query}`;
}

export function matchesStarredMessage(message: StarredMessage, conversationId: string, messageId: string): boolean {
  return (message.conversationId === conversationId || message.chatId === conversationId) &&
    (message.messageId === messageId || message.clientMessageId === messageId);
}
