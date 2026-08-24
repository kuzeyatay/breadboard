// Email link state: who owns the mailbox, who may write to it, and which
// Breadboard conversation each correspondent is currently writing into.
//
// Mirrors the Telegram schema, for the same reason it mirrors its routing: an
// inbound message is an inbound message, and the two channels differing in
// their bookkeeping would be a difference nobody chose.
//
// The account credentials are deliberately absent — they live on disk in
// Hermes's private directory (see ./credentials.ts) and never touch SQLite.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureEmailSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_settings (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      owner_user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      -- Empty means nobody but the owner's own address. An open mailbox that
      -- answers strangers with the owner's memory and tools is not a default
      -- anyone should arrive at by accident.
      allowed_senders TEXT   NOT NULL DEFAULT '',
      autostart      INTEGER NOT NULL DEFAULT 0,
      address        TEXT,
      linked_at      TEXT,
      last_poll_at   TEXT,
      last_error     TEXT,
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO email_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS email_threads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      address         TEXT    NOT NULL UNIQUE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      contact_label   TEXT    NOT NULL DEFAULT '',
      -- Kept so replies thread under the original in the correspondent's client.
      last_message_id TEXT    NOT NULL DEFAULT '',
      last_subject    TEXT    NOT NULL DEFAULT '',
      message_count   INTEGER NOT NULL DEFAULT 0,
      first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_email_threads_user
      ON email_threads(user_id, last_message_at DESC);

    -- Marking a message \\Seen is what stops it being fetched twice, but a
    -- crash between fetching and marking would re-deliver it. This is the
    -- second barrier: a Message-ID that has already produced a turn never
    -- produces another.
    CREATE TABLE IF NOT EXISTS email_seen_messages (
      message_id TEXT PRIMARY KEY,
      seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
