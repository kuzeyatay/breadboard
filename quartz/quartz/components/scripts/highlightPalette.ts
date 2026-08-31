// The highlighter's colour set, shared by the server-rendered menu and the
// client script so the swatches, the stored colour ids, and the CSS variables
// in styles/highlighter.scss can never drift apart.

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple"

export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string }[] = [
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "pink", label: "Pink" },
  { id: "purple", label: "Purple" },
  // Yellow is reserved for Ask here, just as it is in Terminal. It remains in
  // this shared list so persisted inline highlights still validate normally.
  { id: "yellow", label: "Yellow" },
]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow"

export const isHighlightColor = (value: unknown): value is HighlightColor =>
  HIGHLIGHT_COLORS.some((color) => color.id === value)
