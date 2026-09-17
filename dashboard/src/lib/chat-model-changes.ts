export interface ModelChangeMessage {
  role?: string;
  id?: string;
  clientMessageId?: string;
  createdAt?: string;
  modelChangesAfter?: string[];
  modelChangeAfter?: string;
  modelChange?: string;
  metadata?: unknown;
  delegatedAgentRun?: boolean;
  inlineSelection?: unknown;
  textSelection?: { mode?: string };
}

/** Accept both the stored metadata and the fields used by chat presentation. */
export function chatModelChangeLabels(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      return chatModelChangeLabels(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  const labels = data.modelChangesAfter ?? data.modelChangeLabels;
  if (Array.isArray(labels))
    return labels
      .filter(
        (label): label is string =>
          typeof label === "string" && Boolean(label.trim()),
      )
      .map((label) => label.slice(0, 160))
      .slice(-50);
  const label = data.modelChangeAfter ?? data.modelChangeLabel;
  if (typeof label === "string" && label.trim()) return [label.slice(0, 160)];
  return data.metadata ? chatModelChangeLabels(data.metadata) : [];
}

export function modelChangeAnchor(
  message: ModelChangeMessage,
  index: number,
): string {
  return message.clientMessageId
    ? `turn:${message.clientMessageId}`
    : message.id
      ? `message:${message.id}`
      : `row:${index}:${message.createdAt ?? ""}`;
}
