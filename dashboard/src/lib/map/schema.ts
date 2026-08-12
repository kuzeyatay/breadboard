import type DatabaseType from "better-sqlite3";

/**
 * Breadboard's geographic state, one row per (user, conversation).
 *
 * It is stored as a document rather than normalized tables because the whole
 * point of the row is that it is one coherent snapshot: the places resolved so
 * far, which one is selected, the active route and the viewport, all written
 * together so a reader can never see a route whose endpoints have already been
 * replaced. `revision` is what the map UI polls on.
 *
 * Additive and safe to re-apply, like every other schema module here.
 */
export function ensureMapSchema(db: DatabaseType.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_geographic_contexts (
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- 0 stands for "no conversation": the map page's own browsing state.
      conversation_id INTEGER NOT NULL DEFAULT 0,
      context_json    TEXT    NOT NULL,
      revision        INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT    NOT NULL,
      PRIMARY KEY (user_id, conversation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_map_contexts_user_updated
      ON map_geographic_contexts(user_id, updated_at DESC);
  `);
}
