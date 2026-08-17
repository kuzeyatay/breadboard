// Pure helpers a virtualized transcript needs before it can draw anything: what
// makes a row the same row across renders, and how tall to assume it is until
// it has been measured once.
//
// They live apart from the component so they can be reasoned about — and
// tested — without a DOM.

/**
 * Enough rows above and below the fold that a flick of the wheel lands on
 * mounted content, and few enough that a thousand-message chat still holds tens
 * of rows rather than hundreds.
 */
export const CHAT_OVERSCAN = 6;

export type IdentifiableMessage = {
  role?: string;
  content?: string | null;
  createdAt?: string | null;
  /** Persisted on the Hermes and garden-workspace transcripts. */
  id?: string | number | null;
  /** Assigned in the browser before a message has reached the database. */
  clientMessageId?: string | null;
};

/**
 * A row's identity, used both as the React key and as the key the virtualizer
 * files a measured height under.
 *
 * A persisted id is preferred wherever a transcript has one. Where none exists
 * the position plus the timestamp is enough: these transcripts only ever append
 * — history is loaded whole, never paged in above — and the measurement cache
 * is thrown away when the conversation changes, so a key never has to survive
 * a row moving. Content is deliberately left out, or a streaming answer would
 * change its own identity on every token and remount itself.
 */
export function chatRowKey(
  message: IdentifiableMessage | undefined,
  index: number,
): string {
  const persisted = message?.id ?? message?.clientMessageId;
  if (persisted !== undefined && persisted !== null && persisted !== "") {
    return `id:${persisted}`;
  }
  return `${index}:${message?.role ?? "unknown"}:${message?.createdAt ?? ""}`;
}

/**
 * A first guess at a row's height, used only until the row has been on screen
 * once. It is deliberately shaped like a real Breadboard message — a short
 * prompt is nearer 80px than 400 — because a wildly wrong guess is what makes a
 * virtualized transcript's scrollbar lurch as it corrects itself.
 */
export function estimateChatRowHeight(
  message: IdentifiableMessage | undefined,
  options: {
    minimum?: number;
    maximum?: number;
    charactersPerLine?: number;
    lineHeight?: number;
  } = {},
): number {
  const {
    minimum = 76,
    maximum = 900,
    charactersPerLine = 72,
    lineHeight = 24,
  } = options;
  const content = message?.content ?? "";
  if (!content) return minimum;
  // Hard line breaks cost a line each; everything else wraps.
  let lines = 0;
  for (const paragraph of content.split("\n")) {
    lines += Math.max(1, Math.ceil(paragraph.length / charactersPerLine));
  }
  const chrome = message?.role === "assistant" ? 44 : 28;
  return Math.min(maximum, Math.max(minimum, chrome + lines * lineHeight));
}
