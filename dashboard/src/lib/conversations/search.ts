// Ranking for the terminal's chat search.
//
// Two kinds of query have to work through one box: a remembered word ("kirchhoff")
// and a description of a chat whose words nobody remembers ("the one where I was
// arguing about the sidebar layout"). Exact hits therefore win on their own
// weight, while a description still surfaces chats through token overlap — the
// same reason the threshold is coverage-based instead of all-terms-must-match.
//
// Deliberately dependency-free and pure so it can be unit-tested and shared by
// the route without pulling SQLite into the test.

export interface ConversationSearchMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationSearchCandidate {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  messages: ConversationSearchMessage[];
}

export interface ConversationSearchHit {
  id: string;
  title: string;
  updatedAt: string;
  pinned: boolean;
  score: number;
  /** Where the strongest evidence came from, so the UI can say why it matched. */
  matchedOn: "title" | "message";
  snippet: string;
}

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "asked",
  "at", "back", "be", "been", "before", "being", "but", "by", "can", "chat",
  "chats", "conversation", "conversations", "could", "did", "do", "does", "for",
  "from", "get", "had", "has", "have", "he", "her", "here", "him", "his", "how",
  "i", "if", "in", "into", "is", "it", "its", "just", "like", "me", "mine",
  "more", "my", "of", "on", "one", "or", "our", "out", "over", "said", "she",
  "should", "so", "some", "something", "still", "stuff", "talked", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "thing",
  "things", "this", "those", "to", "up", "us", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "why", "will", "with", "would",
  "you", "your",
]);

// Enough transcript to search without holding a whole chat in memory per hit.
const MAX_MESSAGES_SCANNED = 60;
const MAX_MESSAGE_CHARS = 2_000;
const SNIPPET_RADIUS = 70;

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length > 1,
  );
}

/** Query terms, with stop words removed unless that would leave nothing. */
export function conversationSearchTerms(rawQuery: string): string[] {
  const tokens = tokenize(rawQuery);
  const meaningful = tokens.filter((token) => !STOP_WORDS.has(token));
  const chosen = meaningful.length > 0 ? meaningful : tokens;
  return Array.from(new Set(chosen)).slice(0, 12);
}

function recencyBonus(updatedAt: string, now: number): number {
  const timestamp = Date.parse(updatedAt.includes("T") ? updatedAt : `${updatedAt}Z`);
  if (!Number.isFinite(timestamp)) return 0;
  const days = (now - timestamp) / 86_400_000;
  if (days < 1) return 2;
  if (days < 7) return 1.5;
  if (days < 30) return 1;
  if (days < 90) return 0.5;
  return 0;
}

function snippetAround(haystack: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, index + length + SNIPPET_RADIUS);
  const body = haystack.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < haystack.length ? "…" : ""}`;
}

function firstMessageSnippet(candidate: ConversationSearchCandidate): string {
  const first =
    candidate.messages.find((message) => message.role === "user" && message.content.trim()) ??
    candidate.messages.find((message) => message.content.trim());
  if (!first) return "";
  const body = first.content.replace(/\s+/g, " ").trim();
  return body.length > 160 ? `${body.slice(0, 160)}…` : body;
}

export function searchConversations(
  candidates: readonly ConversationSearchCandidate[],
  rawQuery: string,
  options: { limit?: number; now?: number } = {},
): ConversationSearchHit[] {
  const phrase = rawQuery.trim().toLowerCase();
  const terms = conversationSearchTerms(rawQuery);
  if (!phrase || terms.length === 0) return [];
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(50, options.limit ?? 25));
  const usePhrase = phrase.length >= 3 && /\s/.test(phrase);

  const hits: ConversationSearchHit[] = [];

  for (const candidate of candidates) {
    const title = candidate.title ?? "";
    const lowerTitle = title.toLowerCase();
    const messages = candidate.messages
      .slice(-MAX_MESSAGES_SCANNED)
      .map((message) => ({
        role: message.role,
        content: (message.content ?? "").slice(0, MAX_MESSAGE_CHARS),
      }));

    let score = 0;
    let matchedTerms = 0;
    let titleMatched = false;
    let snippet = "";

    if (lowerTitle.includes(phrase)) {
      score += 14;
      titleMatched = true;
    } else if (usePhrase) {
      const carrier = messages.find((message) =>
        message.content.toLowerCase().includes(phrase),
      );
      if (carrier) {
        score += 8;
        const index = carrier.content.toLowerCase().indexOf(phrase);
        snippet = snippetAround(carrier.content, index, phrase.length);
      }
    }

    for (const term of terms) {
      const inTitle = lowerTitle.includes(term);
      if (inTitle) {
        score += 5;
        titleMatched = true;
      }
      const carrier = messages.find((message) =>
        message.content.toLowerCase().includes(term),
      );
      if (carrier) {
        score += 2;
        if (!snippet) {
          const index = carrier.content.toLowerCase().indexOf(term);
          snippet = snippetAround(carrier.content, index, term.length);
        }
      }
      if (inTitle || carrier) matchedTerms += 1;
    }

    // A description only has to be mostly right; a single stray word must not
    // drag in every chat that happens to use it.
    const coverage = matchedTerms / terms.length;
    if (score === 0 || (coverage < 0.5 && matchedTerms < 3)) continue;

    score += coverage * 3;
    score += recencyBonus(candidate.updatedAt, now);
    if (candidate.pinned) score += 0.75;

    hits.push({
      id: candidate.id,
      title,
      updatedAt: candidate.updatedAt,
      pinned: Boolean(candidate.pinned),
      score: Math.round(score * 100) / 100,
      matchedOn: titleMatched ? "title" : "message",
      snippet: snippet || firstMessageSnippet(candidate),
    });
  }

  return hits
    .sort((left, right) =>
      right.score - left.score ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.title.localeCompare(right.title),
    )
    .slice(0, limit);
}
