/** A reader mark points at a question, independently of changing message IDs. */
export interface QuartzChatLink {
  chatId: string;
  /** Empty when the link names an answer instead (a Thought Topology chat node). */
  selectionId: string;
  surface: "garden" | "page";
  /** The answer to scroll to: its message id or client message id. */
  messageId?: string;
}

export function normalizeQuartzChatLink(value: unknown): QuartzChatLink | null {
  if (!value || typeof value !== "object") return null;
  const link = value as Record<string, unknown>;
  const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const messageId = typeof link.messageId === "string" && id.test(link.messageId) ? link.messageId : undefined;
  const selectionId = typeof link.selectionId === "string" && id.test(link.selectionId) ? link.selectionId : "";
  if (typeof link.chatId !== "string" || !id.test(link.chatId) || (!selectionId && !messageId) ||
      (link.surface !== "garden" && link.surface !== "page")) return null;
  return { chatId: link.chatId, selectionId, surface: link.surface, ...(messageId ? { messageId } : {}) };
}
