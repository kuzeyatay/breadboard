// Scheduled chat jobs ("cron jobs" in the UI): a saved prompt plus a cron
// expression that opens a brand-new chat on the surface it was scheduled from.
//
// The schema is additive and applied with CREATE TABLE IF NOT EXISTS, matching
// the repo's migration style, and takes an injected handle so tests can run the
// store against an in-memory SQLite database.

import type DatabaseType from "better-sqlite3";

import { DEFAULT_MODEL } from "../ai-models.ts";
import { DEFAULT_ASSISTANT_REASONING_EFFORT } from "../assistant-reasoning.ts";

type Db = DatabaseType.Database;

export function ensureScheduledChatSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_chat_jobs (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title                  TEXT    NOT NULL,
      prompt                 TEXT    NOT NULL,
      cron_expression        TEXT    NOT NULL,
      surface                TEXT    NOT NULL CHECK (surface IN ('dashboard_terminal','garden_chat')),
      garden_slug            TEXT,
      prompt_slug            TEXT,
      model                  TEXT    NOT NULL DEFAULT '${DEFAULT_MODEL}',
      reasoning_effort       TEXT    NOT NULL DEFAULT '${DEFAULT_ASSISTANT_REASONING_EFFORT}',
      one_shot               INTEGER NOT NULL DEFAULT 0 CHECK (one_shot IN (0, 1)),
      enabled                INTEGER NOT NULL DEFAULT 1,
      next_run_at            TEXT    NOT NULL,
      last_run_at            TEXT,
      last_status            TEXT,
      last_error             TEXT,
      last_conversation_id   TEXT,
      run_count              INTEGER NOT NULL DEFAULT 0,
      created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_chat_jobs_user
      ON scheduled_chat_jobs(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_scheduled_chat_jobs_due
      ON scheduled_chat_jobs(enabled, next_run_at);
  `);

  // The execution lease. Advancing `next_run_at` stops two ticks claiming the
  // same occurrence, but it is released the instant that transaction commits —
  // and the work it guards runs for a good while afterwards. Without a lease, a
  // job whose dispatch hangs is claimed again at its *next* occurrence while the
  // first is still in flight, and a minute-by-minute schedule stacks up.
  //
  // `lease_expires_at` rather than a plain "running" flag, because the process
  // holding it can die. A flag would strand the job forever; a lease that
  // expires means a crash costs one missed occurrence instead of the schedule.
  ensureColumn(db, "scheduled_chat_jobs", "lease_owner", "lease_owner TEXT");
  ensureColumn(
    db,
    "scheduled_chat_jobs",
    "lease_expires_at",
    "lease_expires_at TEXT",
  );
  ensureColumn(
    db,
    "scheduled_chat_jobs",
    "model",
    `model TEXT NOT NULL DEFAULT '${DEFAULT_MODEL}'`,
  );
  ensureColumn(
    db,
    "scheduled_chat_jobs",
    "reasoning_effort",
    `reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_ASSISTANT_REASONING_EFFORT}'`,
  );
  ensureColumn(
    db,
    "scheduled_chat_jobs",
    "one_shot",
    "one_shot INTEGER NOT NULL DEFAULT 0 CHECK (one_shot IN (0, 1))",
  );
  // Messaging-origin reminders are delivered directly by the scheduler. They
  // do not need an agent turn merely to wait and repeat a short piece of text.
  ensureColumn(
    db,
    "scheduled_chat_jobs",
    "delivery_channel",
    "delivery_channel TEXT CHECK (delivery_channel IN ('whatsapp', 'telegram'))",
  );
  ensureColumn(
    db,
    "scheduled_chat_jobs",
    "delivery_mode",
    "delivery_mode TEXT CHECK (delivery_mode IN ('reminder'))",
  );
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
