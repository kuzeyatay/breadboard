export const CHAT_HIGHLIGHT_COLORS = [
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "pink", label: "Pink" },
  { id: "purple", label: "Purple" },
] as const;

export type ChatHighlightColor = (typeof CHAT_HIGHLIGHT_COLORS)[number]["id"];

export const DEFAULT_CHAT_HIGHLIGHT_COLOR: ChatHighlightColor = "blue";

export function isChatHighlightColor(value: unknown): value is ChatHighlightColor {
  return CHAT_HIGHLIGHT_COLORS.some((color) => color.id === value);
}
