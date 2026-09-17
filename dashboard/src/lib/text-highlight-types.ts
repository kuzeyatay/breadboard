/** Shared by the dashboard, Quartz, and the durable annotation API. */
export type HighlightEntry = Record<string, unknown> | string;
export interface HighlightMutation {
  operationId: string;
  id: string;
  value: HighlightEntry | null;
}

export const TEXT_HIGHLIGHT_PREFIXES = [
  "breadboard:garden-highlights:v1:",
  "breadboard:garden-highlight-answers:v1:",
  "breadboard:chat-highlights:",
  "breadboard:garden-chat-highlights:",
  "breadboard:garden-chat-inline-selections:",
  "breadboard:garden-chat-deleted-inline-selections:",
  "breadboard:inline-selections:",
  "breadboard:deleted-inline-selections:",
  "breadboard:pdf-highlights:",
] as const;

export function highlightEntryId(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 && value.length <= 256 ? value : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const selection = entry.selection as Record<string, unknown> | undefined;
  const id = entry.id ?? entry.requestId ?? selection?.id;
  return typeof id === "string" && id.length > 0 && id.length <= 256 ? id : null;
}

export function highlightEntries(value: unknown): HighlightEntry[] {
  return Array.isArray(value) ? value.filter(entry => highlightEntryId(entry) !== null) : [];
}
