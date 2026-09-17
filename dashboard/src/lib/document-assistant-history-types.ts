export type DocumentAssistantKind = "word" | "markdown";

export interface DocumentAssistantChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: string;
  activities?: string[];
  revision?: string;
}

export interface DocumentAssistantHistory {
  conversationId: string | null;
  title: string | null;
  entries: DocumentAssistantChatEntry[];
  changed: boolean;
}

export const DOCUMENT_ASSISTANT_HISTORY_LIMIT = 30;

export function documentAssistantLabel(kind: "pdf" | DocumentAssistantKind): string {
  return kind === "pdf" ? "PDF Assistant" : kind === "word" ? "Word Assistant" : "Markdown Assistant";
}

/** Read the two editors' legacy browser transcripts without trusting extra metadata. */
export function parseDocumentAssistantEntries(value: unknown): DocumentAssistantChatEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(-DOCUMENT_ASSISTANT_HISTORY_LIMIT).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 160 ||
      (entry.role !== "user" && entry.role !== "assistant") || typeof entry.text !== "string" ||
      !entry.text.trim() || seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [{
      id: entry.id,
      role: entry.role,
      text: entry.text.slice(0, 100_000),
      ...(typeof entry.revision === "string" && /^[a-f0-9]{64}$/.test(entry.revision) ? { revision: entry.revision } : {}),
      ...(typeof entry.error === "string" && entry.error ? { error: entry.error.slice(0, 1_000) } : {}),
      ...(Array.isArray(entry.activities) ? {
        activities: entry.activities.filter((item): item is string => typeof item === "string").slice(0, 100).map(item => item.slice(0, 1_000)),
      } : {}),
    }];
  });
}
