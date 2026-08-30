// Bookkeeping for the mem0 semantic-memory sidecar.
//
// durable_memories stays the canonical memory store; mem0's vector store holds
// a derived semantic index over the active rows. This table records which mem0
// entry mirrors which durable row — and in which embedding space — so the
// reconciler can diff canon against the index with one SQL query instead of
// scanning the vector store.
//
// Follows the ensureXSchema(db) convention (see artifact-schema.ts): pure,
// idempotent, invoked once from db.ts after ensureConversationSchema, since
// mem0_mirrors references durable_memories.

import type Database from "better-sqlite3";

export function ensureMem0Schema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mem0_mirrors (
      durable_id   INTEGER PRIMARY KEY REFERENCES durable_memories(id) ON DELETE CASCADE,
      mem0_id      TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      fingerprint  TEXT NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mem0_mirrors_mem0_id ON mem0_mirrors(mem0_id);

    -- Vectors whose canonical row is gone for good.
    --
    -- Permanent deletion is synchronous (Settings → Memory calls straight into
    -- SQLite) while removing a vector is an async call the user must not wait
    -- on, and the mirror row disappears with its parent via ON DELETE CASCADE.
    -- The trigger below captures the mem0 id in the same transaction as the
    -- delete, so the next reconciler pass can retire the vector even if the
    -- process dies in between. Without it a hard-deleted memory would leave an
    -- unreachable-but-present entry in the semantic index.
    CREATE TABLE IF NOT EXISTS mem0_tombstones (
      mem0_id     TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mem0_tombstones_user ON mem0_tombstones(user_id);

    -- Schema initialization runs in parallel Next.js page-data workers during
    -- production builds. DROP followed by CREATE is not atomic across their
    -- separate SQLite connections: two workers can both drop, then race to
    -- create the same trigger. Keep initialization genuinely idempotent;
    -- definition changes belong in an explicit, versioned migration.
    CREATE TRIGGER IF NOT EXISTS trg_mem0_tombstone_on_durable_delete
    BEFORE DELETE ON durable_memories
    FOR EACH ROW
    BEGIN
      INSERT OR IGNORE INTO mem0_tombstones (mem0_id, user_id, fingerprint)
      SELECT mm.mem0_id, OLD.user_id, mm.fingerprint
      FROM mem0_mirrors mm
      WHERE mm.durable_id = OLD.id AND mm.mem0_id <> '';
    END;
  `);
}
