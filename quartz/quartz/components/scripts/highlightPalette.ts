// The highlighter's colour set, shared by the server-rendered menu and the
// client script so the swatches, the stored colour ids, and the CSS variables
// in styles/highlighter.scss can never drift apart.

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple"

export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string }[] = [
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "pink", label: "Pink" },
  { id: "purple", label: "Purple" },
]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow"

export const isHighlightColor = (value: unknown): value is HighlightColor =>
  HIGHLIGHT_COLORS.some((color) => color.id === value)
