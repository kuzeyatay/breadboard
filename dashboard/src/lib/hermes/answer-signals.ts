// What happened to an answer after it was given.
//
// The thumbs on an assistant message used to write `up` or `down` into
// `localStorage` under a hash of the message *content*, and nothing anywhere
// read it back. That is a UI state bit, not feedback: it could not be joined to
// the turn that produced it, it collided whenever two answers happened to share
// their text, it was lost on another machine, and no part of Breadboard could
// ever learn anything from it.
//
// A signal here is the opposite of that in three specific ways.
//
//   * It is keyed to `conversation_messages.id`, so it joins to the prompt, the
//     surface, the metadata and the token usage of the turn it judges.
//   * It carries the turn's *conditions* (see `answer-conditions.ts`). A rating
//     with no record of what varied is unattributable: you know the answer was
//     bad and nothing about why, which is exactly how a feedback loop turns
//     into a prompt full of superstition.
//   * Its kind is open. An explicit thumb is rare and deliberate; copying an
//     answer, regenerating it, editing it or retrying it are common and
//     unprompted, and they say more in aggregate than the thumb does. They all
//     land in this one table so the analysis has a single thing to read.
//
// Nothing in here changes how an answer is produced. Signals are recorded, and
// `answer-signal-analysis.ts` reads them; the loop from signal back to behavior
// is deliberately routed through a human (see `proposeStandingPreferences`).

import type DatabaseType from "better-sqlite3";

import db from "../db.ts";

type Db = DatabaseType.Database;

/**
 * The explicit judgements. Mutually exclusive: an answer is rated up, rated
 * down, or unrated, and recording one clears the other rather than leaving a
 * message that is somehow both.
 */
export const RATING_KINDS = ["rated_up", "rated_down"] as const;

/**
 * The implicit ones, all of which already happen without anybody deciding to
 * give feedback. `copied` and `spoken` read as mild approval — the answer was
 * worth taking somewhere else. `regenerated`, `edited` and `retried` read as
 * dissatisfaction with what arrived, which is why they are worth more than
 * their frequency suggests: nobody regenerates an answer they were happy with.
 */
export const IMPLICIT_KINDS = [
  "copied",
  "spoken",
  "regenerated",
  "edited",
  "retried",
] as const;

export const SIGNAL_KINDS = [...RATING_KINDS, ...IMPLICIT_KINDS] as const;

export type RatingKind = (typeof RATING_KINDS)[number];
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/**
 * Why an answer was rated down.
 *
 * A bare dislike is uninterpretable and always will be: it says an answer was
 * bad and nothing about which part, so every downstream reading of it is a
 * guess. These four are chosen to be attributable rather than exhaustive —
 * each one points at a different mechanism, so a cluster of them names the
 * thing to go and change.
 *
 *   wrong         — the content was incorrect. Points at retrieval, grounding.
 *   too_long      — right, but buried. Points at the answer-depth gate.
 *   missed_point  — answered a different question. Points at scope reading.
 *   style         — right and well-sized, but the wrong register or shape.
 */
export const SIGNAL_REASONS = ["wrong", "too_long", "missed_point", "style"] as const;

export type SignalReason = (typeof SIGNAL_REASONS)[number];

/**
 * A guard, not a policy. Signals are small and one per message per kind, so
 * the table grows with use rather than with time; this only keeps a runaway
 * client from turning an analysis query into a table scan of millions.
 */
export const MAX_SIGNAL_SCAN = 20_000;

export interface AnswerSignalRow {
  id: number;
  user_id: number;
  conversation_id: number;
  message_id: number;
  signal_kind: SignalKind;
  reason: SignalReason | null;
  conditions: string | null;
  occurrences: number;
  created_at: string;
  updated_at: string;
}

export interface AnswerSignal {
  id: number;
  conversationId: number;
  messageId: number;
  kind: SignalKind;
  reason: SignalReason | null;
  conditions: Record<string, unknown>;
  occurrences: number;
  createdAt: string;
  updatedAt: string;
}

export function isRatingKind(value: unknown): value is RatingKind {
  return typeof value === "string" && (RATING_KINDS as readonly string[]).includes(value);
}

export function isSignalKind(value: unknown): value is SignalKind {
  return typeof value === "string" && (SIGNAL_KINDS as readonly string[]).includes(value);
}

export function isSignalReason(value: unknown): value is SignalReason {
  return typeof value === "string" && (SIGNAL_REASONS as readonly string[]).includes(value);
}

export function ensureAnswerSignalSchema(database: Db): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS answer_signals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      -- The join that makes a signal mean something. A deleted message takes
      -- its signals with it: a rating of an answer nobody can read is not
      -- evidence of anything, and keeping it would let the benchmark nominate
      -- scenarios out of text that no longer exists.
      message_id      INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
      signal_kind     TEXT    NOT NULL,
      reason          TEXT,
      -- The turn's conditions, as JSON, frozen at the moment of the signal.
      conditions      TEXT,
      occurrences     INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per message per kind. Copying an answer four times is one
    -- behaviour with a count, not four pieces of evidence: without this, the
    -- aggregate is dominated by whoever double-clicks.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_signals_unique
      ON answer_signals(message_id, signal_kind);

    CREATE INDEX IF NOT EXISTS idx_answer_signals_user_recent
      ON answer_signals(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_answer_signals_message
      ON answer_signals(message_id);
  `);
}

let schemaReady = false;

function handle(database?: Db): Db {
  const target = database ?? db;
  if (database || !schemaReady) {
    ensureAnswerSignalSchema(target);
    if (!database) schemaReady = true;
  }
  return target;
}

function parseConditions(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function presentAnswerSignal(row: AnswerSignalRow): AnswerSignal {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    kind: row.signal_kind,
    reason: row.reason,
    conditions: parseConditions(row.conditions),
    occurrences: row.occurrences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Record one signal against one answer.
 *
 * Writing a rating clears the opposite rating in the same transaction, so the
 * mutual exclusion is a property of the table rather than of whichever caller
 * remembered to do it. Repeating a signal refreshes it and bumps the count:
 * that the same answer was copied again a week later is information, and it is
 * worth more as a timestamp than as a second row.
 */
export function recordAnswerSignal(
  input: {
    userId: number;
    conversationId: number;
    messageId: number;
    kind: SignalKind;
    reason?: SignalReason | null;
    /**
     * Any JSON-serialisable object. Typed loosely on purpose: the canonical
     * snapshot is `AnswerConditions`, but importing it here would point this
     * module at the classifiers it exists to stay independent of, and the
     * column stores whatever shape the caller froze.
     */
    conditions?: object | null;
  },
  database?: Db,
): AnswerSignal | null {
  if (!isSignalKind(input.kind)) return null;
  const target = handle(database);
  // A reason only means something on a judgement. Attaching one to a copy
  // would put uninterpretable rows in front of the analysis.
  const reason =
    isRatingKind(input.kind) && isSignalReason(input.reason) ? input.reason : null;
  const conditions = input.conditions ? JSON.stringify(input.conditions) : null;

  const write = target.transaction(() => {
    if (isRatingKind(input.kind)) {
      const others = RATING_KINDS.filter((kind) => kind !== input.kind);
      target
        .prepare(
          `DELETE FROM answer_signals
           WHERE message_id = ? AND signal_kind IN (${others.map(() => "?").join(", ")})`,
        )
        .run(input.messageId, ...others);
    }
    target
      .prepare(
        `INSERT INTO answer_signals
           (user_id, conversation_id, message_id, signal_kind, reason, conditions)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id, signal_kind) DO UPDATE SET
           occurrences = occurrences + 1,
           reason      = excluded.reason,
           -- Conditions are only overwritten when the new signal carries them,
           -- so a later implicit signal cannot blank the snapshot a rating took.
           conditions  = COALESCE(excluded.conditions, answer_signals.conditions),
           updated_at  = datetime('now')`,
      )
      .run(
        input.userId,
        input.conversationId,
        input.messageId,
        input.kind,
        reason,
        conditions,
      );
    return target
      .prepare("SELECT * FROM answer_signals WHERE message_id = ? AND signal_kind = ?")
      .get(input.messageId, input.kind) as AnswerSignalRow | undefined;
  });

  const row = write();
  return row ? presentAnswerSignal(row) : null;
}

/** The rating currently standing against one answer, if any. */
export function getAnswerRating(
  userId: number,
  messageId: number,
  database?: Db,
): RatingKind | null {
  const target = handle(database);
  const row = target
    .prepare(
      `SELECT signal_kind FROM answer_signals
       WHERE user_id = ? AND message_id = ? AND signal_kind IN (?, ?)
       LIMIT 1`,
    )
    .get(userId, messageId, ...RATING_KINDS) as { signal_kind: RatingKind } | undefined;
  return row?.signal_kind ?? null;
}

/**
 * Take the rating off an answer. Pressing the same thumb twice means "I did not
 * mean that", which has to be able to remove the row rather than record a
 * second opinion — otherwise a misclick is permanent evidence.
 */
export function clearAnswerRating(
  userId: number,
  messageId: number,
  database?: Db,
): boolean {
  const target = handle(database);
  const result = target
    .prepare(
      `DELETE FROM answer_signals
       WHERE user_id = ? AND message_id = ? AND signal_kind IN (?, ?)`,
    )
    .run(userId, messageId, ...RATING_KINDS);
  return result.changes > 0;
}

/** Ratings standing against a whole conversation, for transcript hydration. */
export function listConversationRatings(
  userId: number,
  conversationId: number,
  database?: Db,
): Record<number, RatingKind> {
  const target = handle(database);
  const rows = target
    .prepare(
      `SELECT message_id, signal_kind FROM answer_signals
       WHERE user_id = ? AND conversation_id = ? AND signal_kind IN (?, ?)`,
    )
    .all(userId, conversationId, ...RATING_KINDS) as {
    message_id: number;
    signal_kind: RatingKind;
  }[];
  const ratings: Record<number, RatingKind> = {};
  for (const row of rows) ratings[row.message_id] = row.signal_kind;
  return ratings;
}

export function listAnswerSignals(
  userId: number,
  options: { kinds?: readonly SignalKind[]; limit?: number; since?: string } = {},
  database?: Db,
): AnswerSignal[] {
  const target = handle(database);
  const limit = Math.max(1, Math.min(MAX_SIGNAL_SCAN, options.limit ?? 2_000));
  const kinds = options.kinds?.length ? options.kinds : SIGNAL_KINDS;
  const placeholders = kinds.map(() => "?").join(", ");
  const rows = target
    .prepare(
      `SELECT * FROM answer_signals
       WHERE user_id = ?
         AND signal_kind IN (${placeholders})
         AND (? IS NULL OR created_at >= ?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, ...kinds, options.since ?? null, options.since ?? null, limit) as
    AnswerSignalRow[];
  return rows.map(presentAnswerSignal);
}

/** Remove one signal by id, scoped to its owner so a guessed id reads as absent. */
export function forgetAnswerSignal(
  userId: number,
  id: number,
  database?: Db,
): boolean {
  const target = handle(database);
  const result = target
    .prepare("DELETE FROM answer_signals WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return result.changes > 0;
}
