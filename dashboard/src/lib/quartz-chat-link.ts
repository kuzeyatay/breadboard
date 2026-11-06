/** A reader mark points at a question, independently of changing message IDs. */
export interface QuartzChatLink {
  chatId: string;
  selectionId: string;
  surface: "garden" | "page";
}

export function normalizeQuartzChatLink(value: unknown): QuartzChatLink | null {
  if (!value || typeof value !== "object") return null;
  const link = value as Record<string, unknown>;
  const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (typeof link.chatId !== "string" || !id.test(link.chatId) ||
      typeof link.selectionId !== "string" || !id.test(link.selectionId) ||
      (link.surface !== "garden" && link.surface !== "page")) return null;
  return { chatId: link.chatId, selectionId: link.selectionId, surface: link.surface };
}
