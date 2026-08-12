// The marker colors a chat — or an artifact — can be highlighted with.
//
// A row stores the slug, never the color: the palette below is free to change
// with the theme without rewriting anyone's history, and the server can
// validate a highlight without knowing anything about how it is painted.
//
// Both halves of the app read this list — the rail and the artifact archive
// paint from it, and the PATCH routes reject anything that is not in it.

export interface ChatHighlight {
  id: string;
  label: string;
  /** Solid edge marker; the row tints its background from the same value. */
  color: string;
}

export const CHAT_HIGHLIGHTS: readonly ChatHighlight[] = [
  { id: "butter", label: "Butter", color: "#e0a33c" },
  { id: "rose", label: "Rose", color: "#cf6b7c" },
  { id: "sage", label: "Sage", color: "#6f9e70" },
  { id: "sky", label: "Sky", color: "#5b8fc9" },
  { id: "lilac", label: "Lilac", color: "#9b7fc6" },
];

export function isChatHighlight(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CHAT_HIGHLIGHTS.some((highlight) => highlight.id === value)
  );
}

export function chatHighlight(id: string | null): ChatHighlight | null {
  if (!id) return null;
  return CHAT_HIGHLIGHTS.find((highlight) => highlight.id === id) ?? null;
}
