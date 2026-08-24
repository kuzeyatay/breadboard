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

    -- Automations the agent drafted but nobody has agreed to yet.
    --
    -- An agent that notices you doing the same thing every Monday should be
    -- able to offer to do it for you; it should not be able to give itself a
    -- standing instruction. So a proposal is inert -- it holds a graph in the
    -- same shape a real workflow does, and it becomes one only when the user
    -- accepts it, at which point it is copied into the workflows table and the
    -- proposal is closed against its new id.
    --
    -- The fingerprint is what the proposal is about, not its wording, so a
    -- declined idea does not come back next week in a new sentence.
    CREATE TABLE IF NOT EXISTS workflow_proposals (
      id              TEXT    PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      name            TEXT    NOT NULL,
      description     TEXT    NOT NULL DEFAULT '',
      -- Why the agent thinks this is worth automating, in its own words.
      rationale       TEXT    NOT NULL DEFAULT '',
      -- What it observed. Shown to the user so the offer can be judged on its
      -- evidence rather than on its confidence.
      evidence        TEXT    NOT NULL DEFAULT '[]',
      trigger_kind    TEXT    NOT NULL DEFAULT 'manual',
      state           TEXT    NOT NULL DEFAULT '{"blocks":{},"edges":[]}',
      fingerprint     TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','superseded')),
      workflow_id     TEXT    REFERENCES workflows(id) ON DELETE SET NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_at      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_proposals_user
      ON workflow_proposals(user_id, status, created_at DESC);
    -- One live offer per idea. A second proposal of something already pending
    -- or already refused is not a new offer, it is nagging.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_proposals_open
      ON workflow_proposals(user_id, fingerprint)
      WHERE status IN ('pending','declined');
  `);
}
