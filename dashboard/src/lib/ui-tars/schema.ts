// Additive Breadboard tables for the UI-TARS runtime-agent subsystem.
//
// Follows the ensureXSchema(db) convention (see gbrain/schema.ts). All ids are
// cryptographically random public TEXT ids (assigned in the store) so a run or
// agent cannot be reached by guessing a sequential integer. Provider API keys
// live in a SEPARATE server-only table and are NEVER stored in configuration_json
// or any event/approval payload.

import type Database from "better-sqlite3";

export function ensureUITarsSchema(db: Database.Database): void {
  db.exec(`
    -- Agent definitions (prompt vs runtime distinction via kind/runtime).
    CREATE TABLE IF NOT EXISTS ui_tars_agents (
      id                 TEXT PRIMARY KEY,
      owner_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name               TEXT    NOT NULL,
      description        TEXT    NOT NULL DEFAULT '',
      kind               TEXT    NOT NULL DEFAULT 'runtime',   -- 'prompt' | 'runtime'
      runtime            TEXT,                                 -- 'ui-tars' | 'hermes' | NULL
      capabilities_json  TEXT    NOT NULL DEFAULT '[]',
      configuration_json TEXT    NOT NULL DEFAULT '{}',        -- NON-secret config only
      enabled            INTEGER NOT NULL DEFAULT 1,
      is_default         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ui_tars_agents_owner ON ui_tars_agents(owner_user_id);

    -- Server-only secret storage, isolated from ordinary configuration and never
    -- returned to the frontend. (Follow-up: move to OS credential storage.)
    CREATE TABLE IF NOT EXISTS ui_tars_agent_secrets (
      agent_id        TEXT PRIMARY KEY REFERENCES ui_tars_agents(id) ON DELETE CASCADE,
      provider_api_key TEXT NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Agent runs.
    CREATE TABLE IF NOT EXISTS ui_tars_runs (
      id                 TEXT PRIMARY KEY,
      agent_id           TEXT NOT NULL REFERENCES ui_tars_agents(id) ON DELETE CASCADE,
      owner_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id    TEXT,
      status             TEXT NOT NULL DEFAULT 'queued',
      task               TEXT NOT NULL,
      operator_type      TEXT NOT NULL DEFAULT 'browser',
      runtime_session_id TEXT,
      started_at         TEXT,
      completed_at       TEXT,
      aborted_at         TEXT,
      failure_code       TEXT,
      failure_message    TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ui_tars_runs_agent ON ui_tars_runs(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ui_tars_runs_owner ON ui_tars_runs(owner_user_id, created_at DESC);

    -- Normalized run events. UNIQUE(run_id, sequence_number) makes duplicate
    -- upstream delivery a no-op (idempotent persistence).
    CREATE TABLE IF NOT EXISTS ui_tars_run_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL REFERENCES ui_tars_runs(id) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL,
      event_type      TEXT NOT NULL,
      payload_json    TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, sequence_number)
    );

    -- Approval records (audit + replay defense at the persistence layer).
    CREATE TABLE IF NOT EXISTS ui_tars_approvals (
      id                    TEXT PRIMARY KEY,
      run_id                TEXT NOT NULL REFERENCES ui_tars_runs(id) ON DELETE CASCADE,
      action_id             TEXT NOT NULL,
      action_type           TEXT NOT NULL,
      action_summary        TEXT NOT NULL DEFAULT '',
      risk_level            TEXT NOT NULL DEFAULT 'low',
      requested_payload_json TEXT NOT NULL DEFAULT '{}',
      decision              TEXT NOT NULL DEFAULT 'pending',
      decided_by_user_id    INTEGER,
      requested_at          TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at            TEXT,
      UNIQUE(run_id, action_id)
    );

    -- Run artifacts (screenshots are stored on disk by the adapter; this records
    -- their association + metadata, never their bytes).
    CREATE TABLE IF NOT EXISTS ui_tars_artifacts (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL REFERENCES ui_tars_runs(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      path          TEXT NOT NULL,
      mime_type     TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ui_tars_artifacts_run ON ui_tars_artifacts(run_id);
  `);
}
