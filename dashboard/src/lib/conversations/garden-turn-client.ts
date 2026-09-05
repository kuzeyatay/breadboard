export interface GardenTurnCheckpointMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  internalAgentContinuation?: boolean;
  attachmentNames?: string[];
  attachments?: unknown[];
  focusedDocumentNames?: string[];
  selectedText?: string;
  inlineSelection?: unknown;
  /** Selected-text ("Ask in chat"/"Ask here") anchor for this question. */
  textSelection?: unknown;
  /** Stable Garden document references used to rebuild this turn on Retry. */
  focusedDocumentSlugs?: string[];
}

export interface GardenTurnCheckpoint {
  clientMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  conversationId: string | null;
}

/** Reserve an adjacent user/assistant pair before any turn work is dispatched. */
export async function reserveGardenTurnCheckpoint(
  sessionId: number,
  clientMessageId: string,
  message: GardenTurnCheckpointMessage,
): Promise<GardenTurnCheckpoint> {
  const response = await fetch(`/api/chat-sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientMessageId, ...message }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string | { message?: string };
    userMessage?: { id?: string; clientMessageId?: string };
    assistantMessage?: { id?: string; clientMessageId?: string };
    conversationId?: string;
  };
  const userMessageId = body.userMessage?.id;
  const assistantMessageId = body.assistantMessage?.id;
  if (!response.ok || !userMessageId || !assistantMessageId) {
    const reason =
      typeof body.error === "string"
        ? body.error
        : typeof body.error?.message === "string"
          ? body.error.message
          : "Chat history could not be saved.";
    throw new Error(reason);
  }
  return {
    clientMessageId:
      body.userMessage?.clientMessageId ?? clientMessageId,
    userMessageId,
    assistantMessageId,
    conversationId:
      typeof body.conversationId === "string" ? body.conversationId : null,
  };
}

/** Persist Stop before the runtime has necessarily announced its session id. */
export async function abortGardenTurnCheckpoint(
  sessionId: number,
  clientMessageId: string,
): Promise<void> {
  await fetch(`/api/chat-sessions/${sessionId}/turns`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientMessageId }),
  }).catch(() => undefined);
}
