import type Database from "better-sqlite3";

/** Encrypted remote-MCP OAuth credentials and short-lived, one-time state. */
export function ensureMcpOAuthSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS hermes_mcp_oauth_credentials (
      connection_id   INTEGER PRIMARY KEY REFERENCES hermes_mcp_connections(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      encrypted_value TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hermes_mcp_oauth_credentials_user
      ON hermes_mcp_oauth_credentials(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS hermes_mcp_oauth_states (
      state_hash     TEXT PRIMARY KEY,
      connection_id INTEGER NOT NULL REFERENCES hermes_mcp_connections(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redirect_uri  TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hermes_mcp_oauth_states_expiry
      ON hermes_mcp_oauth_states(expires_at);
  `);
}
