// Address-book persistence: people, and the mail addresses that identify them.
//
// Additive and applied with CREATE TABLE IF NOT EXISTS, matching the repo's
// migration style, and taking an injected handle so the store can be unit
// tested against an in-memory SQLite database.
//
// Addresses live in their own table rather than a JSON column because every
// interesting read is a lookup *by address*: an event arrives naming
// sarah@work.example, and the question is which person that is. A UNIQUE
// (user_id, email) index answers that in one probe and makes "the same address
// on two contacts" unrepresentable, which is the ambiguity that would otherwise
// have to be resolved at every call site.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureContactSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      organization TEXT,
      phone        TEXT,
      notes        TEXT,
      favorite     INTEGER NOT NULL DEFAULT 0,
      source       TEXT    NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','auto')),
      last_seen_at TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_user_name
      ON contacts(user_id, favorite DESC, name);

    CREATE TABLE IF NOT EXISTS contact_emails (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email      TEXT    NOT NULL,
      label      TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- One address belongs to one person. Attempting to file it under a second
    -- contact is a conflict the store reports, not a duplicate it accepts.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_emails_unique
      ON contact_emails(user_id, email);

    CREATE INDEX IF NOT EXISTS idx_contact_emails_contact
      ON contact_emails(contact_id, is_primary DESC, id);
  `);
}
