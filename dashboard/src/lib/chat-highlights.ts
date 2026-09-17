export const CHAT_HIGHLIGHT_COLORS = [
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "pink", label: "Pink" },
  { id: "purple", label: "Purple" },
] as const;

export type ChatHighlightColor = (typeof CHAT_HIGHLIGHT_COLORS)[number]["id"];

export const DEFAULT_CHAT_HIGHLIGHT_COLOR: ChatHighlightColor = "blue";

export const MAX_CHAT_HIGHLIGHT_NOTE_LENGTH = 4_000;

export function isChatHighlightColor(value: unknown): value is ChatHighlightColor {
  return CHAT_HIGHLIGHT_COLORS.some((color) => color.id === value);
}

export function normalizeChatHighlightNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const note = value.trim().slice(0, MAX_CHAT_HIGHLIGHT_NOTE_LENGTH);
  return note || undefined;
}
