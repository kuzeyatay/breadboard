// SQLite-backed persistence for scheduled chat jobs. The store is a plain class
// over an injected database handle (matching src/lib/scriberr/job-store.ts) so
// it can be unit-tested against an in-memory SQLite database, and it owns the
// only place where `next_run_at` is advanced.

import { randomUUID } from "node:crypto";

import type DatabaseType from "better-sqlite3";

import { ensureScheduledChatSchema } from "./schema.ts";
import {
  CronError,
  describeCronExpression,
  nextCronOccurrence,
  parseCronExpression,
} from "./cron.ts";
import type {
  ScheduledChatJob,
  ScheduledChatRunStatus,
  ScheduledChatSurface,
} from "./types.ts";

type Db = DatabaseType.Database;

export type { ScheduledChatJob, ScheduledChatRunStatus, ScheduledChatSurface };

export const MAX_SCHEDULE_TITLE_LENGTH = 120;
export const MAX_SCHEDULE_PROMPT_LENGTH = 20_000;
export const MAX_SCHEDULES_PER_USER = 50;

export class ScheduleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ScheduleError";
    this.status = status;
  }
}

export interface ScheduledChatJobRow {
  id: number;
  user_id: number;
  title: string;
  prompt: string;
  cron_expression: string;
  surface: ScheduledChatSurface;
  garden_slug: string | null;
  prompt_slug: string | null;
  enabled: number;
  next_run_at: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_conversation_id: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
  /** Which process is currently running this job, null when nobody is. */
  lease_owner: string | null;
  /** When that claim stops being believed. See `LEASE_SECONDS`. */
  lease_expires_at: string | null;
}

/**
 * How long a claim on a job is honoured.
 *
 * Long enough that a slow dispatch is never mistaken for a dead process, short
 * enough that a genuinely dead one only costs a few missed occurrences. A
 * dispatch that takes longer than this is not slow, it is wedged — and treating
 * it as dead is the right read, because the alternative is a schedule that
 * stops forever the first time a process is killed mid-run.
 */
export const LEASE_SECONDS = 15 * 60;

/**
 * This process's lease identity: stable for its lifetime, distinct from any
 * other process on the same database, and not reused after a restart — a
 * restarted server must not inherit a lease its predecessor was holding when it
 * died, or a job wedged at that moment would never be reclaimed.
 */
function defaultOwnerId(): string {
  const globals = globalThis as typeof globalThis & { breadboardScheduleOwner?: string };
  if (!globals.breadboardScheduleOwner) {
    globals.breadboardScheduleOwner = `${process.pid}-${randomUUID()}`;
  }
  return globals.breadboardScheduleOwner;
}

export interface CreateScheduledChatInput {
  title: string;
  prompt: string;
  cron: string;
  surface: ScheduledChatSurface;
  gardenSlug?: string | null;
  promptSlug?: string | null;
  enabled?: boolean;
}

export type UpdateScheduledChatInput = Partial<CreateScheduledChatInput>;

function boundedText(value: unknown, max: number, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ScheduleError(400, `${field} is required.`);
  return text.slice(0, max);
}

/** Cron problems are user input problems, so they answer with 400, not 500. */
function firstRunAfter(cron: string, now: Date): string {
  try {
    parseCronExpression(cron);
    return nextCronOccurrence(cron, now).toISOString();
  } catch (cause) {
    if (cause instanceof CronError) throw new ScheduleError(400, cause.message);
    throw cause;
  }
}

function normalizeSurface(value: unknown): ScheduledChatSurface {
  if (value === "dashboard_terminal" || value === "garden_chat") return value;
  throw new ScheduleError(400, "A schedule must target the terminal or a garden chat.");
}

export function presentScheduledChatJob(
  row: ScheduledChatJobRow,
  now: Date = new Date(),
): ScheduledChatJob {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    cron: row.cron_expression,
    cronDescription: describeCronExpression(row.cron_expression),
    surface: row.surface,
    gardenSlug: row.garden_slug,
    promptSlug: row.prompt_slug,
    enabled: row.enabled === 1,
    nextRunAt: row.enabled === 1 ? row.next_run_at : null,
    lastRunAt: row.last_run_at,
    lastStatus:
      row.last_status === "ok" || row.last_status === "failed" ? row.last_status : null,
    lastError: row.last_error,
    lastConversationId: row.last_conversation_id,
    runCount: row.run_count,
    createdAt: row.created_at,
    // A live lease is the only honest answer to "is this running right now",
    // and an expired one is not a run — it is a process that went away.
    running: row.lease_expires_at !== null && row.lease_expires_at > now.toISOString(),
  };
}

export class ScheduledChatJobStore {
  private readonly db: Db;
  /**
   * Who this store is, for the purposes of a lease.
   *
   * Two Breadboards can point at the same database — the dev server and the
   * desktop app both do — so "am I the one running this job" cannot be answered
   * from process memory. The owner is written into the row, which makes the
   * question answerable by anyone holding the file.
   */
  private readonly owner: string;

  constructor(db: Db, owner: string = defaultOwnerId()) {
    this.db = db;
    this.owner = owner;
    ensureScheduledChatSchema(db);
  }

  list(userId: number): ScheduledChatJobRow[] {
    return this.db
      .prepare(
        `SELECT * FROM scheduled_chat_jobs
         WHERE user_id = ?
         ORDER BY enabled DESC, next_run_at ASC, id DESC`,
      )
      .all(userId) as ScheduledChatJobRow[];
  }

  get(userId: number, id: number): ScheduledChatJobRow | null {
    const row = this.db
      .prepare("SELECT * FROM scheduled_chat_jobs WHERE id = ? AND user_id = ?")
      .get(id, userId) as ScheduledChatJobRow | undefined;
    return row ?? null;
  }

  require(userId: number, id: number): ScheduledChatJobRow {
    const row = this.get(userId, id);
    if (!row) throw new ScheduleError(404, "This schedule no longer exists.");
    return row;
  }

  create(
    userId: number,
    input: CreateScheduledChatInput,
    now: Date = new Date(),
  ): ScheduledChatJobRow {
    const count = this.db
      .prepare("SELECT COUNT(*) AS total FROM scheduled_chat_jobs WHERE user_id = ?")
      .get(userId) as { total: number };
    if (count.total >= MAX_SCHEDULES_PER_USER) {
      throw new ScheduleError(
        409,
        `You already have ${MAX_SCHEDULES_PER_USER} schedules. Delete one before adding another.`,
      );
    }

    const title = boundedText(input.title, MAX_SCHEDULE_TITLE_LENGTH, "A title");
    const prompt = boundedText(input.prompt, MAX_SCHEDULE_PROMPT_LENGTH, "A prompt");
    const cron = boundedText(input.cron, 120, "A schedule");
    const surface = normalizeSurface(input.surface);
    const gardenSlug = surface === "garden_chat" ? boundedText(input.gardenSlug, 160, "A garden") : null;
    const nextRunAt = firstRunAfter(cron, now);

    const result = this.db
      .prepare(
        `INSERT INTO scheduled_chat_jobs
           (user_id, title, prompt, cron_expression, surface, garden_slug, prompt_slug, enabled, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        title,
        prompt,
        cron,
        surface,
        gardenSlug,
        typeof input.promptSlug === "string" ? input.promptSlug.slice(0, 100) : null,
        input.enabled === false ? 0 : 1,
        nextRunAt,
      );
    return this.require(userId, Number(result.lastInsertRowid));
  }

  update(
    userId: number,
    id: number,
    input: UpdateScheduledChatInput,
    now: Date = new Date(),
  ): ScheduledChatJobRow {
    const existing = this.require(userId, id);
    const title = input.title === undefined
      ? existing.title
      : boundedText(input.title, MAX_SCHEDULE_TITLE_LENGTH, "A title");
    const prompt = input.prompt === undefined
      ? existing.prompt
      : boundedText(input.prompt, MAX_SCHEDULE_PROMPT_LENGTH, "A prompt");
    const cron = input.cron === undefined
      ? existing.cron_expression
      : boundedText(input.cron, 120, "A schedule");
    const surface = input.surface === undefined ? existing.surface : normalizeSurface(input.surface);
    const gardenSlug = surface !== "garden_chat"
      ? null
      : input.gardenSlug === undefined
        ? existing.garden_slug
        : boundedText(input.gardenSlug, 160, "A garden");
    if (surface === "garden_chat" && !gardenSlug) {
      throw new ScheduleError(400, "A garden schedule needs a garden.");
    }
    const enabled = input.enabled === undefined ? existing.enabled === 1 : input.enabled === true;

    // A paused schedule keeps its stored next run so re-enabling is predictable;
    // any change to the expression (or resuming) recomputes it from now.
    const nextRunAt =
      cron !== existing.cron_expression || (enabled && existing.enabled === 0)
        ? firstRunAfter(cron, now)
        : existing.next_run_at;

    this.db
      .prepare(
        `UPDATE scheduled_chat_jobs
         SET title = ?, prompt = ?, cron_expression = ?, surface = ?, garden_slug = ?,
             enabled = ?, next_run_at = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .run(title, prompt, cron, surface, gardenSlug, enabled ? 1 : 0, nextRunAt, id, userId);
    return this.require(userId, id);
  }

  delete(userId: number, id: number): boolean {
    return (
      this.db
        .prepare("DELETE FROM scheduled_chat_jobs WHERE id = ? AND user_id = ?")
        .run(id, userId).changes > 0
    );
  }

  /**
   * Take ownership of every job that is due, advancing `next_run_at` and taking
   * an execution lease in the same transaction. A job the scheduler missed while
   * the server was down fires once on the next tick and then resumes its normal
   * cadence — it never replays the whole outage.
   *
   * Two things are claimed here, and they guard different failures. Advancing
   * `next_run_at` stops two ticks racing for the same occurrence. The lease
   * stops the *next* occurrence being claimed while this one is still running,
   * which is the failure that actually bites: a schedule whose dispatch takes
   * longer than its interval would otherwise pile runs on top of each other.
   */
  claimDue(now: Date = new Date(), limit = 10): ScheduledChatJobRow[] {
    const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
    const claim = this.db.transaction((iso: string): ScheduledChatJobRow[] => {
      const due = this.db
        .prepare(
          `SELECT * FROM scheduled_chat_jobs
           WHERE enabled = 1 AND next_run_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY next_run_at ASC
           LIMIT ?`,
        )
        .all(iso, iso, limit) as ScheduledChatJobRow[];

      const claimed: ScheduledChatJobRow[] = [];
      for (const job of due) {
        let nextRunAt: string;
        try {
          nextRunAt = nextCronOccurrence(job.cron_expression, now).toISOString();
        } catch {
          // An unparseable expression can only have arrived by direct DB edit.
          // Disable it rather than spinning on it every tick.
          this.db
            .prepare(
              `UPDATE scheduled_chat_jobs
               SET enabled = 0, last_status = 'failed', last_error = ?, updated_at = datetime('now')
               WHERE id = ?`,
            )
            .run("This schedule expression is invalid.", job.id);
          continue;
        }
        // The lease is re-checked inside the write, not just the read above: two
        // processes can both pass the SELECT and only one may pass this.
        const updated = this.db
          .prepare(
            `UPDATE scheduled_chat_jobs
             SET next_run_at = ?, lease_owner = ?, lease_expires_at = ?,
                 updated_at = datetime('now')
             WHERE id = ? AND next_run_at = ?
               AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
          )
          .run(nextRunAt, this.owner, leaseUntil, job.id, job.next_run_at, iso);
        if (updated.changes > 0) {
          claimed.push({
            ...job,
            next_run_at: nextRunAt,
            lease_owner: this.owner,
            lease_expires_at: leaseUntil,
          });
        }
      }
      return claimed;
    });
    return claim(now.toISOString());
  }

  /**
   * Give up a lease this store is holding.
   *
   * Ownership is checked because a lease can expire mid-run and be taken by
   * another process. When that has happened the slow original must not clear
   * the new holder's claim on its way out — it lost the job, and saying so is
   * the only thing that keeps the new run protected.
   */
  releaseLease(id: number, owner: string = this.owner): boolean {
    return (
      this.db
        .prepare(
          `UPDATE scheduled_chat_jobs
           SET lease_owner = NULL, lease_expires_at = NULL, updated_at = datetime('now')
           WHERE id = ? AND lease_owner = ?`,
        )
        .run(id, owner).changes > 0
    );
  }

  /** Whether this store still holds the lease it took on a job. */
  holdsLease(id: number, now: Date = new Date()): boolean {
    const row = this.db
      .prepare(
        "SELECT lease_owner, lease_expires_at FROM scheduled_chat_jobs WHERE id = ?",
      )
      .get(id) as { lease_owner: string | null; lease_expires_at: string | null } | undefined;
    if (!row || row.lease_owner !== this.owner || !row.lease_expires_at) return false;
    return row.lease_expires_at > now.toISOString();
  }

  recordRun(
    id: number,
    outcome: {
      status: ScheduledChatRunStatus;
      conversationId?: string | null;
      error?: string | null;
      at?: Date;
    },
  ): void {
    // The outcome is recorded whatever happened to the lease — a run that
    // overran its lease still produced a result worth keeping — but the lease
    // itself is only released if it is still ours.
    const record = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE scheduled_chat_jobs
           SET last_run_at = ?, last_status = ?, last_error = ?, last_conversation_id = ?,
               run_count = run_count + 1, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          (outcome.at ?? new Date()).toISOString(),
          outcome.status,
          outcome.error ? outcome.error.slice(0, 500) : null,
          outcome.conversationId ?? null,
          id,
        );
      this.releaseLease(id);
    });
    record();
  }

  /** How many of a user's schedules are currently armed. */
  countEnabled(userId: number): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS total FROM scheduled_chat_jobs WHERE user_id = ? AND enabled = 1",
      )
      .get(userId) as { total: number };
    return row.total;
  }
}
