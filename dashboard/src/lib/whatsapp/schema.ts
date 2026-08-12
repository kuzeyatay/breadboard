// WhatsApp link state: who owns the linked device, which numbers may talk to it,
// and which Breadboard conversation each WhatsApp chat is currently writing into.
//
// Additive `CREATE TABLE IF NOT EXISTS` migrations matching the repo style, over
// an injected handle so the store can be unit-tested on an in-memory database.
//
// Credentials are deliberately absent: the linked-device session lives on disk in
// Hermes's private directory and never touches SQLite or the browser.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureWhatsAppSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_settings (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      owner_user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
      mode            TEXT    NOT NULL DEFAULT 'self-chat'
                              CHECK (mode IN ('self-chat','bot')),
      allowed_numbers TEXT    NOT NULL DEFAULT '',
      autostart       INTEGER NOT NULL DEFAULT 1,
      linked_number   TEXT,
      linked_name     TEXT,
      linked_at       TEXT,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO whatsapp_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS whatsapp_chats (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id         TEXT    NOT NULL UNIQUE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      contact_label   TEXT    NOT NULL DEFAULT '',
      contact_number  TEXT    NOT NULL DEFAULT '',
      is_group        INTEGER NOT NULL DEFAULT 0,
      message_count   INTEGER NOT NULL DEFAULT 0,
      first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_user
      ON whatsapp_chats(user_id, last_message_at DESC);

    -- WhatsApp redelivers on reconnect; a message id that has already produced a
    -- turn must never produce a second one.
    CREATE TABLE IF NOT EXISTS whatsapp_seen_messages (
      message_id TEXT PRIMARY KEY,
      seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
