// Schema for the agent-browser Runtime V2 adapter. Agent configuration and a
// minimal ownership/correlation index are persisted; native Runtime V2 remains
// the sole run lifecycle ledger. Follows ensureXSchema(db) convention.

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

    -- Correlation metadata only. Runtime V2 remains the sole lifecycle/event
    -- ledger; these fixed-size correlation rows let authenticated routes recover the exact
    -- user + agent scope after a dashboard reload without retaining runs in
    -- the Next.js heap.
    CREATE TABLE IF NOT EXISTS agent_browser_runtime_runs (
      job_id             TEXT PRIMARY KEY,
      owner_user_id      INTEGER NOT NULL,
      agent_id           TEXT NOT NULL REFERENCES agent_browser_agents(id) ON DELETE CASCADE,
      request_id         TEXT NOT NULL,
      idempotency_key    TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      terminal_at        TEXT,
      UNIQUE(owner_user_id, agent_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_browser_runtime_runs_active
      ON agent_browser_runtime_runs(terminal_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_browser_runtime_runs_owner
      ON agent_browser_runtime_runs(owner_user_id, agent_id, created_at);
  `);
}
