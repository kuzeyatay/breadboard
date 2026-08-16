// SQLite-backed persistence for spaced repetition. A plain class over an
// injected database handle (matching ../schedules/store.ts) so it can be
// unit-tested against an in-memory database, and it owns the only place where a
// card's FSRS state is advanced.

import type DatabaseType from "better-sqlite3";

import { ensureReviewSchema } from "./schema.ts";
import {
  applyGrade,
  newCardState,
  type StoredCardState,
  type StoredReviewLog,
} from "./scheduling.ts";
import {
  clampDailyLimit,
  clampDesiredRetention,
  clampSendHour,
  DEFAULT_REVIEW_USER_SETTINGS,
  isReviewChannel,
  type ReviewCardSummary,
  type ReviewChannel,
  type ReviewGardenSettings,
  type ReviewGradeValue,
  type ReviewStats,
  type ReviewUserSettings,
} from "./types.ts";

type Db = DatabaseType.Database;

export interface ReviewCardRow extends StoredCardState {
  id: number;
  user_id: number;
  garden_slug: string;
  page_slug: string;
  page_title: string;
  question: string;
  answer: string;
  source_hash: string;
  suspended: number;
}

export interface ReviewDeliveryRow {
  id: number;
  card_id: number;
  user_id: number;
  channel: string;
  chat_id: string;
  question: string;
  status: string;
  sent_at: string;
  answered_at: string | null;
  answer_text: string | null;
  rating: number | null;
}

/** A card ready to send, joined with everything the message needs. */
export interface DueCard {
  card: ReviewCardRow;
  gardenSlug: string;
}

export class ReviewStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureReviewSchema(db);
  }

  // ------------------------------------------------------------ user settings

  userSettings(userId: number): ReviewUserSettings {
    const row = this.db
      .prepare(
        `SELECT channel, daily_limit, send_hour, desired_retention
           FROM review_user_settings WHERE user_id = ?`,
      )
      .get(userId) as
      | {
          channel: string;
          daily_limit: number;
          send_hour: number;
          desired_retention: number;
        }
      | undefined;
    if (!row) return { ...DEFAULT_REVIEW_USER_SETTINGS };
    return {
      channel: isReviewChannel(row.channel) ? row.channel : "off",
      dailyLimit: row.daily_limit,
      sendHour: row.send_hour,
      desiredRetention: row.desired_retention,
    };
  }

  setUserSettings(userId: number, input: Partial<ReviewUserSettings>): ReviewUserSettings {
    const current = this.userSettings(userId);
    const next: ReviewUserSettings = {
      channel: input.channel !== undefined && isReviewChannel(input.channel)
        ? input.channel
        : current.channel,
      dailyLimit: input.dailyLimit !== undefined
        ? clampDailyLimit(input.dailyLimit, current.dailyLimit)
        : current.dailyLimit,
      sendHour: input.sendHour !== undefined
        ? clampSendHour(input.sendHour, current.sendHour)
        : current.sendHour,
      desiredRetention: input.desiredRetention !== undefined
        ? clampDesiredRetention(input.desiredRetention, current.desiredRetention)
        : current.desiredRetention,
    };
    this.db
      .prepare(
        `INSERT INTO review_user_settings
           (user_id, channel, daily_limit, send_hour, desired_retention, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           channel = excluded.channel,
           daily_limit = excluded.daily_limit,
           send_hour = excluded.send_hour,
           desired_retention = excluded.desired_retention,
           updated_at = excluded.updated_at`,
      )
      .run(userId, next.channel, next.dailyLimit, next.sendHour, next.desiredRetention);
    return next;
  }

  // ---------------------------------------------------------- garden settings

  gardenSettings(userId: number, gardenSlug: string): ReviewGardenSettings {
    const row = this.db
      .prepare(
        `SELECT enabled, daily_limit, last_seeded_at
           FROM review_gardens WHERE user_id = ? AND garden_slug = ?`,
      )
      .get(userId, gardenSlug) as
      | { enabled: number; daily_limit: number; last_seeded_at: string | null }
      | undefined;
    const counts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN suspended = 0 AND due <= datetime('now') THEN 1 ELSE 0 END) AS due
         FROM review_cards WHERE user_id = ? AND garden_slug = ?`,
      )
      .get(userId, gardenSlug) as { total: number; due: number | null };
    return {
      gardenSlug,
      enabled: row?.enabled === 1,
      dailyLimit: row?.daily_limit ?? 3,
      cardCount: counts.total ?? 0,
      dueCount: counts.due ?? 0,
      lastSeededAt: row?.last_seeded_at ?? null,
    };
  }

  setGardenSettings(
    userId: number,
    gardenSlug: string,
    input: { enabled?: boolean; dailyLimit?: number },
  ): ReviewGardenSettings {
    const current = this.gardenSettings(userId, gardenSlug);
    const enabled = input.enabled ?? current.enabled;
    const dailyLimit = input.dailyLimit !== undefined
      ? clampDailyLimit(input.dailyLimit, current.dailyLimit)
      : current.dailyLimit;
    this.db
      .prepare(
        `INSERT INTO review_gardens (user_id, garden_slug, enabled, daily_limit, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, garden_slug) DO UPDATE SET
           enabled = excluded.enabled,
           daily_limit = excluded.daily_limit,
           updated_at = excluded.updated_at`,
      )
      .run(userId, gardenSlug, enabled ? 1 : 0, dailyLimit);
    return { ...current, enabled, dailyLimit };
  }

  enabledGardens(userId: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT garden_slug FROM review_gardens
            WHERE user_id = ? AND enabled = 1 ORDER BY garden_slug`,
        )
        .all(userId) as Array<{ garden_slug: string }>
    ).map((r) => r.garden_slug);
  }

  markSeeded(userId: number, gardenSlug: string): void {
    this.db
      .prepare(
        `UPDATE review_gardens SET last_seeded_at = datetime('now'), updated_at = datetime('now')
          WHERE user_id = ? AND garden_slug = ?`,
      )
      .run(userId, gardenSlug);
  }

  // ------------------------------------------------------------------- cards

  /**
   * Insert a card, or refresh the question of one whose note has changed.
   *
   * An existing card keeps its FSRS columns even when the note is rewritten —
   * losing months of scheduling because a build touched the markdown is exactly
   * the failure mode that keeps this state out of frontmatter.
   */
  upsertCard(input: {
    userId: number;
    gardenSlug: string;
    pageSlug: string;
    pageTitle: string;
    question: string;
    answer: string;
    sourceHash: string;
    now?: Date;
  }): { id: number; created: boolean; refreshed: boolean } {
    const existing = this.db
      .prepare(
        `SELECT id, source_hash FROM review_cards
          WHERE user_id = ? AND garden_slug = ? AND page_slug = ?`,
      )
      .get(input.userId, input.gardenSlug, input.pageSlug) as
      | { id: number; source_hash: string }
      | undefined;

    if (existing) {
      if (existing.source_hash === input.sourceHash) {
        return { id: existing.id, created: false, refreshed: false };
      }
      this.db
        .prepare(
          `UPDATE review_cards
              SET page_title = ?, question = ?, answer = ?, source_hash = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(input.pageTitle, input.question, input.answer, input.sourceHash, existing.id);
      return { id: existing.id, created: false, refreshed: true };
    }

    const state = newCardState(input.now ?? new Date());
    const result = this.db
      .prepare(
        `INSERT INTO review_cards
           (user_id, garden_slug, page_slug, page_title, question, answer, source_hash,
            due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
            reps, lapses, state, last_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId,
        input.gardenSlug,
        input.pageSlug,
        input.pageTitle,
        input.question,
        input.answer,
        input.sourceHash,
        state.due,
        state.stability,
        state.difficulty,
        state.elapsed_days,
        state.scheduled_days,
        state.learning_steps,
        state.reps,
        state.lapses,
        state.state,
        state.last_review,
      );
    return { id: Number(result.lastInsertRowid), created: true, refreshed: false };
  }

  card(cardId: number): ReviewCardRow | null {
    return (
      (this.db.prepare(`SELECT * FROM review_cards WHERE id = ?`).get(cardId) as
        | ReviewCardRow
        | undefined) ?? null
    );
  }

  /**
   * The cards due now, newest-material-first within each garden, capped per
   * garden by that garden's own limit and overall by `limit`.
   *
   * Ordering is by due date so the longest-overdue card is asked first; a card
   * that has lapsed repeatedly therefore keeps priority over fresh material.
   */
  due(userId: number, options: { limit: number; gardenSlugs?: string[]; now?: Date }): ReviewCardRow[] {
    const now = (options.now ?? new Date()).toISOString();
    const slugs = options.gardenSlugs ?? this.enabledGardens(userId);
    if (slugs.length === 0) return [];
    const placeholders = slugs.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT * FROM review_cards
          WHERE user_id = ?
            AND suspended = 0
            AND garden_slug IN (${placeholders})
            AND due <= ?
          ORDER BY due ASC
          LIMIT ?`,
      )
      .all(userId, ...slugs, now, options.limit) as ReviewCardRow[];
  }

  listCards(userId: number, gardenSlug: string, limit = 100): ReviewCardSummary[] {
    return (
      this.db
        .prepare(
          `SELECT id, garden_slug, page_slug, page_title, question, due, state, reps, lapses, suspended
             FROM review_cards
            WHERE user_id = ? AND garden_slug = ?
            ORDER BY due ASC LIMIT ?`,
        )
        .all(userId, gardenSlug, limit) as Array<{
        id: number;
        garden_slug: string;
        page_slug: string;
        page_title: string;
        question: string;
        due: string;
        state: number;
        reps: number;
        lapses: number;
        suspended: number;
      }>
    ).map((r) => ({
      id: r.id,
      gardenSlug: r.garden_slug,
      pageSlug: r.page_slug,
      pageTitle: r.page_title,
      question: r.question,
      due: r.due,
      state: r.state,
      reps: r.reps,
      lapses: r.lapses,
      suspended: r.suspended === 1,
    }));
  }

  setSuspended(userId: number, cardId: number, suspended: boolean): void {
    this.db
      .prepare(
        `UPDATE review_cards SET suspended = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
      )
      .run(suspended ? 1 : 0, cardId, userId);
  }

  /** Apply a grade: reschedule the card and append its review log, atomically. */
  grade(
    cardId: number,
    rating: ReviewGradeValue,
    options: { desiredRetention: number; now?: Date },
  ): { card: StoredCardState; log: StoredReviewLog } | null {
    const row = this.card(cardId);
    if (!row) return null;
    const result = applyGrade(row, rating, options);
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE review_cards
              SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
                  scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
                  state = ?, last_review = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(
          result.card.due,
          result.card.stability,
          result.card.difficulty,
          result.card.elapsed_days,
          result.card.scheduled_days,
          result.card.learning_steps,
          result.card.reps,
          result.card.lapses,
          result.card.state,
          result.card.last_review,
          cardId,
        );
      this.db
        .prepare(
          `INSERT INTO review_logs
             (card_id, rating, state, due, stability, difficulty, elapsed_days,
              last_elapsed_days, scheduled_days, learning_steps, review)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          cardId,
          result.log.rating,
          result.log.state,
          result.log.due,
          result.log.stability,
          result.log.difficulty,
          result.log.elapsed_days,
          result.log.last_elapsed_days,
          result.log.scheduled_days,
          result.log.learning_steps,
          result.log.review,
        );
    });
    write();
    return result;
  }

  // -------------------------------------------------------------- deliveries

  /**
   * Record a question as sent. Only one delivery per chat may be open, so an
   * unanswered previous question is expired first — otherwise a reply could not
   * be attributed to a single card.
   */
  openDelivery(input: {
    cardId: number;
    userId: number;
    channel: ReviewChannel;
    chatId: string;
    question: string;
  }): number {
    const open = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE review_deliveries SET status = 'expired'
            WHERE chat_id = ? AND status = 'open'`,
        )
        .run(input.chatId);
      return this.db
        .prepare(
          `INSERT INTO review_deliveries (card_id, user_id, channel, chat_id, question)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.cardId, input.userId, input.channel, input.chatId, input.question);
    });
    return Number(open().lastInsertRowid);
  }

  openDeliveryForChat(chatId: string): ReviewDeliveryRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM review_deliveries
            WHERE chat_id = ? AND status = 'open'
            ORDER BY sent_at DESC LIMIT 1`,
        )
        .get(chatId) as ReviewDeliveryRow | undefined) ?? null
    );
  }

  closeDelivery(deliveryId: number, input: { answerText: string; rating: ReviewGradeValue }): void {
    this.db
      .prepare(
        `UPDATE review_deliveries
            SET status = 'graded', answered_at = datetime('now'), answer_text = ?, rating = ?
          WHERE id = ?`,
      )
      .run(input.answerText, input.rating, deliveryId);
  }

  /**
   * Reserve room in today's budget and return how many may be sent.
   *
   * The counter resets on a new local date. Returning the allowance rather than
   * a boolean keeps the caller from having to re-read the row, and makes the
   * cap hold even if two ticks overlap, because the increment happens here in
   * one statement.
   */
  claimDailyBudget(userId: number, localDate: string, want: number): number {
    const settings = this.userSettings(userId);
    const row = this.db
      .prepare(
        `SELECT last_batch_date, last_batch_count FROM review_user_settings WHERE user_id = ?`,
      )
      .get(userId) as { last_batch_date: string; last_batch_count: number } | undefined;
    const sentToday = row && row.last_batch_date === localDate ? row.last_batch_count : 0;
    const allowance = Math.max(0, Math.min(want, settings.dailyLimit - sentToday));
    if (allowance === 0) return 0;
    this.db
      .prepare(
        `INSERT INTO review_user_settings (user_id, last_batch_date, last_batch_count, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           last_batch_date = excluded.last_batch_date,
           last_batch_count = CASE
             WHEN review_user_settings.last_batch_date = excluded.last_batch_date
               THEN review_user_settings.last_batch_count + excluded.last_batch_count
             ELSE excluded.last_batch_count
           END,
           updated_at = excluded.updated_at`,
      )
      .run(userId, localDate, allowance);
    return allowance;
  }

  /**
   * Users who have chosen a channel and enabled at least one garden.
   *
   * The tick iterates this rather than every user: without both halves there is
   * nothing to send, and scanning cards for accounts that never opted in would
   * make the 30-second tick scale with the user table instead of with use.
   */
  usersWithDelivery(): Array<{ userId: number; sendHour: number }> {
    return (
      this.db
        .prepare(
          `SELECT s.user_id AS user_id, s.send_hour AS send_hour
             FROM review_user_settings s
            WHERE s.channel <> 'off'
              AND EXISTS (
                SELECT 1 FROM review_gardens g
                 WHERE g.user_id = s.user_id AND g.enabled = 1
              )`,
        )
        .all() as Array<{ user_id: number; send_hour: number }>
    ).map((row) => ({ userId: row.user_id, sendHour: row.send_hour }));
  }

  /** How many questions have gone out today, for the panel's progress line. */
  sentToday(userId: number, localDate: string): number {
    const row = this.db
      .prepare(
        `SELECT last_batch_date, last_batch_count FROM review_user_settings WHERE user_id = ?`,
      )
      .get(userId) as { last_batch_date: string; last_batch_count: number } | undefined;
    return row && row.last_batch_date === localDate ? row.last_batch_count : 0;
  }

  // ------------------------------------------------------------------- stats

  stats(userId: number, gardenSlug?: string): ReviewStats {
    const scope = gardenSlug ? `AND garden_slug = ?` : "";
    const args = gardenSlug ? [userId, gardenSlug] : [userId];
    const counts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN suspended = 0 AND due <= datetime('now') THEN 1 ELSE 0 END) AS due,
           SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END) AS new_cards,
           SUM(CASE WHEN state IN (1, 3) THEN 1 ELSE 0 END) AS learning,
           SUM(CASE WHEN state = 2 THEN 1 ELSE 0 END) AS in_review
         FROM review_cards WHERE user_id = ? ${scope}`,
      )
      .get(...args) as {
      total: number;
      due: number | null;
      new_cards: number | null;
      learning: number | null;
      in_review: number | null;
    };
    const recent = this.db
      .prepare(
        `SELECT COUNT(*) AS answered,
                SUM(CASE WHEN l.rating >= 3 THEN 1 ELSE 0 END) AS recalled
           FROM review_logs l
           JOIN review_cards c ON c.id = l.card_id
          WHERE c.user_id = ? ${gardenSlug ? "AND c.garden_slug = ?" : ""}
            AND l.review >= datetime('now', '-30 days')`,
      )
      .get(...args) as { answered: number; recalled: number | null };
    return {
      total: counts.total ?? 0,
      due: counts.due ?? 0,
      newCards: counts.new_cards ?? 0,
      learning: counts.learning ?? 0,
      review: counts.in_review ?? 0,
      answered30d: recent.answered ?? 0,
      retention30d:
        recent.answered > 0 ? (recent.recalled ?? 0) / recent.answered : null,
    };
  }
}
