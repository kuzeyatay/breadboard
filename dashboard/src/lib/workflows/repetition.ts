// What the user keeps asking for.
//
// A proposal is only worth making if there is something to point at. An agent
// that offers to automate a thing you did once is guessing; one that can say
// "you have asked me this on four separate days" is reporting. So the evidence
// is computed here, from the user's own request history, and handed to the
// agent rather than left for it to assert.
//
// The method is the same shape as the memory tree's clustering: strip a
// request down to the words that carry it, group requests that share those
// words, and count the distinct days each group spans. Days matter more than
// occurrences — asking three times in one afternoon is one task going badly,
// while asking once a week for three weeks is a routine.

import type Database from "better-sqlite3";

import db from "../db.ts";

/** Words that appear in every request and so distinguish none of them. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "for", "to", "of", "in",
  "on", "at", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "can", "could", "would", "should", "will", "please", "thanks", "thank",
  "you", "your", "me", "my", "i", "we", "it", "that", "this", "these", "those",
  "do", "does", "did", "done", "get", "got", "make", "made", "give", "let",
  "just", "now", "again", "also", "some", "any", "all", "what", "how", "why",
  "when", "where", "which", "who", "help", "need", "want", "like", "hey", "hi",
]);

/** Below this a "pattern" is a coincidence. */
const MIN_OCCURRENCES = 3;
/** And it has to have happened on more than one day to be a routine. */
const MIN_DISTINCT_DAYS = 2;
const SIMILARITY = 0.34;
/** How far back to look. Older than this is not current behaviour. */
const WINDOW_DAYS = 90;
const MAX_MESSAGES = 600;

export interface RepetitionSignal {
  /** The shared vocabulary that defines the group. */
  terms: string[];
  occurrences: number;
  distinctDays: number;
  firstSeen: string;
  lastSeen: string;
  /** A few of the actual requests, so the agent quotes rather than paraphrases. */
  examples: string[];
}

function salientTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Requests the user has made repeatedly, most repeated first.
 *
 * Read-only and cheap enough to run when an agent asks for it. Returns an
 * empty list rather than throwing when there is no history to read, which is
 * the normal state for a new account.
 */
export function repetitionSignals(
  userId: number,
  options: { limit?: number } = {},
  database: Database.Database = db,
): RepetitionSignal[] {
  let rows: Array<{ content: string; created_at: string }>;
  try {
    rows = database
      .prepare(
        `SELECT m.content AS content, m.created_at AS created_at
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND m.role = 'user'
           AND m.created_at >= datetime('now', ?)
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(userId, `-${WINDOW_DAYS} days`, MAX_MESSAGES) as Array<{
      content: string;
      created_at: string;
    }>;
  } catch {
    return [];
  }

  interface Cluster {
    terms: Set<string>;
    members: Array<{ text: string; at: string }>;
  }

  const clusters: Cluster[] = [];
  for (const row of rows) {
    const text = (row.content ?? "").trim();
    // Very short messages ("yes", "go on") carry no subject to cluster on, and
    // very long ones are usually a paste rather than a request.
    if (text.length < 12 || text.length > 2000) continue;
    const terms = salientTerms(text);
    if (terms.size < 2) continue;

    let best: Cluster | null = null;
    let bestScore = SIMILARITY;
    for (const cluster of clusters) {
      const score = similarity(terms, cluster.terms);
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best) {
      best.members.push({ text, at: row.created_at });
      for (const term of terms) best.terms.add(term);
    } else {
      clusters.push({ terms: new Set(terms), members: [{ text, at: row.created_at }] });
    }
  }

  const signals: RepetitionSignal[] = [];
  for (const cluster of clusters) {
    if (cluster.members.length < MIN_OCCURRENCES) continue;
    const days = new Set(cluster.members.map((member) => member.at.slice(0, 10)));
    if (days.size < MIN_DISTINCT_DAYS) continue;

    const times = cluster.members.map((member) => member.at).sort();
    // Name the group by the terms most of its members actually share, not by
    // everything anyone in it said.
    const counts = new Map<string, number>();
    for (const member of cluster.members) {
      for (const term of salientTerms(member.text)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
    const terms = Array.from(counts.entries())
      .filter(([, count]) => count >= Math.ceil(cluster.members.length / 2))
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 6)
      .map(([term]) => term);
    if (terms.length === 0) continue;

    signals.push({
      terms,
      occurrences: cluster.members.length,
      distinctDays: days.size,
      firstSeen: times[0],
      lastSeen: times[times.length - 1],
      examples: cluster.members.slice(0, 3).map((member) => member.text.slice(0, 200)),
    });
  }

  return signals
    .sort(
      (left, right) =>
        right.distinctDays - left.distinctDays || right.occurrences - left.occurrences,
    )
    .slice(0, Math.max(1, Math.min(10, options.limit ?? 5)));
}

/** The evidence lines a proposal carries, phrased for a person to read. */
export function evidenceLines(signal: RepetitionSignal): string[] {
  return [
    `Asked ${signal.occurrences} times across ${signal.distinctDays} separate days ` +
      `(${signal.firstSeen.slice(0, 10)} to ${signal.lastSeen.slice(0, 10)}).`,
    `Recurring subject: ${signal.terms.join(", ")}.`,
    ...signal.examples.map((example) => `You said: "${example}"`),
  ];
}
