import type Database from "better-sqlite3";

/** Breadboard-owned connected-app metadata and encrypted credential vault. */
export function ensureNangoSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS nango_connections (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug           TEXT NOT NULL,
      provider       TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      connection_id  TEXT NOT NULL,
      enabled        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    );

    CREATE INDEX IF NOT EXISTS idx_nango_connections_user_enabled
      ON nango_connections(user_id, enabled);

    CREATE TABLE IF NOT EXISTS connected_app_credentials (
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug             TEXT NOT NULL,
      encrypted_value  TEXT NOT NULL,
      expires_at       TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id, slug),
      FOREIGN KEY(user_id, slug)
        REFERENCES nango_connections(user_id, slug) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS connected_app_oauth_states (
      state_hash       TEXT PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug             TEXT NOT NULL,
      redirect_uri     TEXT NOT NULL,
      code_verifier    TEXT,
      expires_at       TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_connected_app_oauth_states_expiry
      ON connected_app_oauth_states(expires_at);
  `);
}
