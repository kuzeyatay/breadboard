// Inbound webhook ("Hooks") storage: an external event either starts a
// Breadboard chat turn or runs a native workflow. Additive, CREATE TABLE IF
// NOT EXISTS, matching the repo's migration style; takes an injected handle
// so tests can run the store against an in-memory SQLite database (see
// dashboard/src/lib/schedules/schema.ts for the pattern this follows).

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureHooksSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hooks (
      id                  TEXT    PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                TEXT    NOT NULL,
      provider            TEXT    NOT NULL,
      mode                TEXT    NOT NULL CHECK (mode IN ('chat','workflow')),
      workflow_id         TEXT,
      chat_instructions   TEXT,
      provider_config     TEXT    NOT NULL DEFAULT '{}',
      enabled             INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      last_fired_at       TEXT,
      fire_count          INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_hooks_user
      ON hooks(user_id, created_at DESC);

    -- One delivery record per (hook, idempotency key): recordDelivery's INSERT
    -- OR IGNORE relies on this PK to report "duplicate" via changes === 0.
    CREATE TABLE IF NOT EXISTS hook_deliveries (
      hook_id             TEXT    NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
      idempotency_key     TEXT    NOT NULL,
      received_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (hook_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_hook_deliveries_received
      ON hook_deliveries(received_at);
  `);

  // A hook may belong to one garden instead of to the dashboard at large. The
  // Garden's own Hooks panel lists only its own, and a chat those hooks start
  // opens inside that garden with that garden's tools.
  ensureColumn(db, "hooks", "garden_slug", "garden_slug TEXT");
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

/**
 * Drop delivery rows older than the dedupe window. Mirrors sim's 7-day
 * idempotency TTL. Cheap enough to run inline on every receive (a handful of
 * milliseconds against an indexed column) rather than a background job.
 */
export function pruneHookDeliveries(db: Db, olderThanDays = 7): void {
  db.prepare(
    `DELETE FROM hook_deliveries WHERE received_at < datetime('now', ?)`,
  ).run(`-${olderThanDays} days`);
}
