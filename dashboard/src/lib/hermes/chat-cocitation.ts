// Pages the user's own Garden chats cite together.
//
// When one answer links two pages of a Garden, the user was studying them as
// one question. Repeated across conversations, that is a connection the
// embedding map often misses: Math 2's map had 3 links while its chats cited
// 325 page pairs together more than once. These links stay agent-side; the
// Thought Topology artifact is published through Quartz, and chat text must
// never reach it.

import db from "../db.ts";

export interface ChatCocitation {
  /** Page relPaths without ".md", lowercased, sorted so left < right. */
  left: string;
  right: string;
  conversations: number;
  /** The wordiest of the user's questions behind recent answers citing both. */
  question: string;
}

/** An answer citing more pages than this is a reading list, not a connection. */
const MAX_PAGES_PER_ANSWER = 6;
const MIN_CONVERSATIONS = 2;
const CACHE_MS = 5 * 60_000;
const QUESTION_CHARS = 240;

const cache = new Map<string, { at: number; marker: number; links: ChatCocitation[] }>();

/** Note slugs an answer links in this Garden, from `[title](/garden/<slug>?note=<path>)`. */
export function citedNotes(content: string, gardenSlug: string): string[] {
  const notes = new Set<string>();
  for (const match of content.matchAll(/\]\(\/garden\/([^?)\s]+)\?note=([^)#&\s]+)/g)) {
    let garden: string;
    let note: string;
    try {
      garden = decodeURIComponent(match[1]);
      note = decodeURIComponent(match[2]);
    } catch {
      continue;
    }
    if (garden !== gardenSlug) continue;
    const key = note.replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "").toLocaleLowerCase();
    if (key) notes.add(key);
  }
  return [...notes];
}

/** Never throws: chat links enrich the graph, and their absence must not break it. */
export function chatCocitations(userId: number | null | undefined, gardenSlug: string): ChatCocitation[] {
  try {
    return readChatCocitations(userId, gardenSlug);
  } catch (error) {
    console.warn(`[chat-cocitation] skipped for ${gardenSlug}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function readChatCocitations(userId: number | null | undefined, gardenSlug: string): ChatCocitation[] {
  if (!Number.isInteger(userId)) return [];
  const pattern = `%](/garden/${encodeURIComponent(gardenSlug)}?note=%`;
  // New answers move this marker; between them the cache answers for free.
  const marker = Number(
    (db.prepare("SELECT MAX(id) AS id FROM conversation_messages").get() as { id: number | null })?.id ?? 0,
  );
  const key = `${userId}\u0000${gardenSlug}`;
  const cached = cache.get(key);
  if (cached && cached.marker === marker && Date.now() - cached.at < CACHE_MS) return cached.links;

  const answers = db
    .prepare(
      `SELECT m.conversation_id AS conversationId, m.order_index AS orderIndex, m.content AS content
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND COALESCE(c.temporary, 0) = 0
          AND m.role = 'assistant' AND m.content LIKE ?
        ORDER BY m.id DESC
        LIMIT 2000`,
    )
    .all(userId, pattern) as Array<{ conversationId: number; orderIndex: number; content: string }>;
  const questionFor = db.prepare(
    `SELECT content FROM conversation_messages
      WHERE conversation_id = ? AND role = 'user' AND order_index < ?
      ORDER BY order_index DESC LIMIT 1`,
  );

  type AnswerRef = { conversationId: number; orderIndex: number };
  const pairs = new Map<string, { conversations: Set<number>; answers: AnswerRef[] }>();
  for (const answer of answers) {
    const notes = citedNotes(answer.content ?? "", gardenSlug).sort();
    if (notes.length < 2 || notes.length > MAX_PAGES_PER_ANSWER) continue;
    for (let i = 0; i < notes.length; i += 1) {
      for (let j = i + 1; j < notes.length; j += 1) {
        const pairKey = `${notes[i]}\u0000${notes[j]}`;
        const entry = pairs.get(pairKey) ?? { conversations: new Set<number>(), answers: [] };
        entry.conversations.add(answer.conversationId);
        if (entry.answers.length < 5) entry.answers.push(answer); // newest first
        pairs.set(pairKey, entry);
      }
    }
  }

  const links: ChatCocitation[] = [];
  for (const [pairKey, entry] of pairs) {
    if (entry.conversations.size < MIN_CONVERSATIONS) continue;
    const [left, right] = pairKey.split("\u0000");
    // A follow-up like "do 7 now" explains nothing; the wordiest of the
    // recent questions is the one that names the topic.
    const questions = entry.answers.map((answer) =>
      String((questionFor.get(answer.conversationId, answer.orderIndex) as { content: string } | undefined)?.content ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const question = questions.reduce((best, next) => (next.split(" ").length > best.split(" ").length ? next : best), "");
    links.push({
      left,
      right,
      conversations: entry.conversations.size,
      question: question.slice(0, QUESTION_CHARS),
    });
  }
  links.sort((a, b) => b.conversations - a.conversations || a.left.localeCompare(b.left));
  cache.set(key, { at: Date.now(), marker, links });
  return links;
}
