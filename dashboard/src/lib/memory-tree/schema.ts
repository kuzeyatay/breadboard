// Structure over the agent's memory, and a record of what has been exported.
//
// durable_memories stays canonical: every fact still lives there, and nothing
// here can create or destroy one. What this adds is the shape — which facts
// belong together, what that group is about, and how much it matters — plus
// the bookkeeping needed to mirror that shape into a folder of markdown the
// user can open, read, and correct.
//
// The tree is derived and rebuildable from durable_memories alone, with one
// exception: a node the user has renamed or rewritten carries `source =
// 'edited'` and a rebuild leaves its title and summary alone. Losing someone's
// correction to a rebuild would teach them not to correct anything.
//
// Follows the ensureXSchema(db) convention; invoked from db.ts after
// ensureConversationSchema, since memory_tree_links references
// durable_memories.

import type Database from "better-sqlite3";

export function ensureMemoryTreeSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_tree_nodes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id    INTEGER REFERENCES memory_tree_nodes(id) ON DELETE CASCADE,
      slug         TEXT NOT NULL,
      title        TEXT NOT NULL,
      summary      TEXT NOT NULL DEFAULT '',
      -- 'root' is the per-user top; 'scope' groups by where a memory applies
      -- (everywhere, one project, one garden); 'topic' is a cluster of facts
      -- that share vocabulary.
      kind         TEXT NOT NULL CHECK (kind IN ('root','scope','topic')),
      scope        TEXT CHECK (scope IN ('global','project','garden')),
      scope_id     TEXT,
      -- Rolled up from the memories beneath: how much this branch matters.
      score        REAL NOT NULL DEFAULT 0 CHECK (score >= 0),
      memory_count INTEGER NOT NULL DEFAULT 0,
      -- Terms that named this cluster, kept so retrieval can match a branch
      -- without re-deriving them.
      terms        TEXT NOT NULL DEFAULT '',
      source       TEXT NOT NULL DEFAULT 'derived'
                   CHECK (source IN ('derived','edited')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_tree_nodes_slug
      ON memory_tree_nodes(user_id, COALESCE(parent_id, 0), slug);
    CREATE INDEX IF NOT EXISTS idx_memory_tree_nodes_parent
      ON memory_tree_nodes(user_id, parent_id, score DESC);

    -- A memory can sit under more than one topic: "the pump rig runs on 24V"
    -- is about both the rig and the power budget, and forcing a single parent
    -- would make one of those searches miss it.
    CREATE TABLE IF NOT EXISTS memory_tree_links (
      node_id   INTEGER NOT NULL REFERENCES memory_tree_nodes(id) ON DELETE CASCADE,
      memory_id INTEGER NOT NULL REFERENCES durable_memories(id) ON DELETE CASCADE,
      weight    REAL NOT NULL DEFAULT 1 CHECK (weight >= 0),
      PRIMARY KEY (node_id, memory_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_tree_links_memory
      ON memory_tree_links(memory_id);

    -- What the vault on disk currently holds.
    --
    -- Exporting compares against this rather than against the files, so an
    -- unchanged memory does not rewrite a file the user has open. Importing
    -- compares the other way: a file whose hash no longer matches what we
    -- wrote is an edit, and an edit is the user's word over ours.
    CREATE TABLE IF NOT EXISTS memory_vault_files (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      path          TEXT NOT NULL,
      node_id       INTEGER REFERENCES memory_tree_nodes(id) ON DELETE CASCADE,
      memory_id     INTEGER REFERENCES durable_memories(id) ON DELETE CASCADE,
      exported_hash TEXT NOT NULL,
      exported_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, path)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_vault_files_memory
      ON memory_vault_files(user_id, memory_id);

    CREATE TABLE IF NOT EXISTS memory_tree_state (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      built_at      TEXT,
      exported_at   TEXT,
      imported_at   TEXT,
      memory_count  INTEGER NOT NULL DEFAULT 0,
      node_count    INTEGER NOT NULL DEFAULT 0,
      vault_path    TEXT NOT NULL DEFAULT '',
      last_error    TEXT
    );
  `);
}
