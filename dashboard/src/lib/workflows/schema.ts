// Native workflow storage: the saved canvas graph plus a history of its runs.
// Replaces n8n's own database as the home for the user's automations.
//
// Additive CREATE TABLE IF NOT EXISTS, matching the repo's migration style, over
// an injected handle so the store can be tested against in-memory SQLite.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export function ensureWorkflowSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id           TEXT    PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      description  TEXT    NOT NULL DEFAULT '',
      state        TEXT    NOT NULL DEFAULT '{"blocks":{},"edges":[]}',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_user
      ON workflows(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id            TEXT    PRIMARY KEY,
      workflow_id   TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status        TEXT    NOT NULL CHECK (status IN ('success','error','waiting','timeout')),
      trigger_kind  TEXT    NOT NULL,
      input         TEXT,
      output        TEXT,
      logs          TEXT,
      error         TEXT,
      started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      finished_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
      ON workflow_runs(workflow_id, started_at DESC);
  `);
}
