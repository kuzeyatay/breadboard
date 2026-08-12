// Schema for the agent-browser runtime agent. Only the agent CONFIG is
// persisted; runs/events/screenshots live in the in-memory run manager (the
// Next.js process owns the CLI subprocess for the run's lifetime). Follows the
// ensureXSchema(db) convention (see ui-tars/schema.ts).

import type Database from "better-sqlite3";

export function ensureAgentBrowserSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_browser_agents (
      id                 TEXT PRIMARY KEY,
      owner_user_id      INTEGER NOT NULL,
      name               TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      capabilities_json  TEXT NOT NULL DEFAULT '[]',
      configuration_json TEXT NOT NULL,
      enabled            INTEGER NOT NULL DEFAULT 1,
      is_default         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_browser_agents_owner ON agent_browser_agents(owner_user_id);
  `);
}
