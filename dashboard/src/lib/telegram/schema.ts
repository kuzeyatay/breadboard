// Telegram link state: who owns the bot, who may talk to it, which Breadboard
// conversation each Telegram chat is currently writing into, and how far the
// update stream has been consumed.
//
// Additive `CREATE TABLE IF NOT EXISTS` migrations matching the repo style, over
// an injected handle so the store can be unit-tested on an in-memory database.
//
// The bot token is deliberately absent: it lives on disk in Hermes's private
// directory (see ./credentials.ts) and never touches SQLite or the browser.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureTelegramSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_settings (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      owner_user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      allowed_users  TEXT    NOT NULL DEFAULT '',
      autostart      INTEGER NOT NULL DEFAULT 1,
      bot_id         TEXT,
      bot_username   TEXT,
      bot_name       TEXT,
      linked_at      TEXT,
      -- Telegram replays every update until it is acknowledged by offset, so the
      -- next offset has to survive a restart or a reconnect replays the backlog.
      last_update_id INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO telegram_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS telegram_chats (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id         TEXT    NOT NULL UNIQUE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      contact_label   TEXT    NOT NULL DEFAULT '',
      contact_handle  TEXT    NOT NULL DEFAULT '',
      is_group        INTEGER NOT NULL DEFAULT 0,
      message_count   INTEGER NOT NULL DEFAULT 0,
      first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_chats_user
      ON telegram_chats(user_id, last_message_at DESC);

    -- Belt and braces next to the offset: an update id that has already produced
    -- a turn must never produce a second one.
    CREATE TABLE IF NOT EXISTS telegram_seen_messages (
      message_id TEXT PRIMARY KEY,
      seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
