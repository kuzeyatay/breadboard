import type Database from "better-sqlite3";

/**
 * Per-user agent settings, one row per agent the user has changed.
 *
 * The values are stored as a JSON blob rather than columns because the shape
 * belongs to the catalog, not to the database: adding an option to an agent
 * should not need a migration, and a row written before an option existed still
 * reads correctly (`normalizeAgentSettings` fills the gap with the default).
 *
 * Absence is meaningful. No row means "never configured", which is exactly the
 * shipped defaults, so resetting an agent deletes its row instead of writing
 * the defaults back.
 */
export function ensureAgentSettingsSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_settings (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent_id   TEXT    NOT NULL,
      values_json TEXT   NOT NULL DEFAULT '{}',
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, agent_id)
    );
  `);
  renameAgent(database, "postiz", "socials-manager");
}

/**
 * Carry a user's saved settings across an agent being renamed.
 *
 * The id is the key, so a rename without this silently drops every choice the
 * user made — the networks they draft for, whether artwork is drawn — back to
 * the shipped defaults, with no error anywhere to explain it. `OR IGNORE` keeps
 * a row already written under the new id: that one is newer, so it wins, and
 * the stale one is dropped rather than left to shadow it.
 */
function renameAgent(database: Database.Database, from: string, to: string): void {
  database
    .prepare("UPDATE OR IGNORE agent_settings SET agent_id = ? WHERE agent_id = ?")
    .run(to, from);
  database.prepare("DELETE FROM agent_settings WHERE agent_id = ?").run(from);
}
