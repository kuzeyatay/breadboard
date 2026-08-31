// Storage for workflows authored by demonstration.
//
// The authoritative object is still a row in `workflows` -- the same table the
// canvas uses, so a learned workflow appears in the Workflows list, is opened
// from there, and is deleted from there without any of that code learning a
// second kind of workflow exists. Two additive columns say which kind a row is
// and where its learned procedure lives.
//
// Everything else here belongs to demonstration and hangs off that row: the
// teaching sessions, the version history, and the grounded runs.
//
// Additive CREATE TABLE IF NOT EXISTS over an injected handle, matching the
// repo's migration style and the existing workflow schema beside it.

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

function tableColumns(db: Db, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function ensureTeachSchema(db: Db): void {
  // `workflows` is created by ensureWorkflowSchema, which runs first.
  const columns = tableColumns(db, "workflows");
  if (columns.size > 0) {
    if (!columns.has("source")) {
      // Everything that existed before this feature was built on the canvas, and
      // the default keeps it that way without a data migration.
      db.exec(`ALTER TABLE workflows ADD COLUMN source TEXT NOT NULL DEFAULT 'canvas'`);
    }
    if (!columns.has("procedure")) {
      db.exec(`ALTER TABLE workflows ADD COLUMN procedure TEXT`);
    }
    if (!columns.has("procedure_version")) {
      db.exec(`ALTER TABLE workflows ADD COLUMN procedure_version INTEGER NOT NULL DEFAULT 0`);
    }
  }

  db.exec(`
    -- One demonstration. Holds the lifecycle of a teaching session and points at
    -- the directory its raw recording lives in, which may be deleted later
    -- without the saved workflow noticing.
    CREATE TABLE IF NOT EXISTS workflow_demonstrations (
      id                  TEXT    PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Set once the demonstration has been saved as a workflow.
      workflow_id         TEXT    REFERENCES workflows(id) ON DELETE SET NULL,
      -- Set while a second demonstration is correcting an existing workflow.
      reteach_workflow_id TEXT    REFERENCES workflows(id) ON DELETE CASCADE,
      name                TEXT    NOT NULL DEFAULT '',
      objective           TEXT    NOT NULL DEFAULT '',
      state               TEXT    NOT NULL DEFAULT 'preparing'
                          CHECK (state IN ('preparing','recording','paused','processing','review','saved','cancelled','failed')),
      started_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      -- Epoch milliseconds from the capture backend: the clock the event log,
      -- the narration and the transcript are all joined on.
      started_epoch_ms    INTEGER NOT NULL DEFAULT 0,
      finished_at         TEXT,
      duration_ms         INTEGER NOT NULL DEFAULT 0,
      event_count         INTEGER NOT NULL DEFAULT 0,
      audio_offset_ms     INTEGER NOT NULL DEFAULT 0,
      transcript_available INTEGER NOT NULL DEFAULT 0,
      frames_available    INTEGER NOT NULL DEFAULT 0,
      recording_retained  INTEGER NOT NULL DEFAULT 1,
      -- The proposed procedure, awaiting the user's answer on the review screen.
      draft               TEXT,
      error               TEXT,
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_demonstrations_user
      ON workflow_demonstrations(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_demonstrations_workflow
      ON workflow_demonstrations(workflow_id);

    -- Every version a workflow's procedure has had. A re-teach adds a row; it
    -- never overwrites the representation that was working yesterday.
    CREATE TABLE IF NOT EXISTS workflow_procedure_versions (
      id               TEXT    PRIMARY KEY,
      workflow_id      TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      version          INTEGER NOT NULL,
      procedure        TEXT    NOT NULL,
      compiled_dir     TEXT,
      demonstration_id TEXT    REFERENCES workflow_demonstrations(id) ON DELETE SET NULL,
      note             TEXT    NOT NULL DEFAULT '',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_procedure_versions_unique
      ON workflow_procedure_versions(workflow_id, version);

    -- A grounded run of a learned workflow.
    --
    -- The state is persisted rather than held in memory because the machine can
    -- be handed back mid-run: a dashboard restart must be able to tell that a
    -- run was in flight, and refuse to let it silently carry on driving.
    CREATE TABLE IF NOT EXISTS workflow_demonstration_runs (
      id           TEXT    PRIMARY KEY,
      workflow_id  TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      version      INTEGER NOT NULL DEFAULT 1,
      state        TEXT    NOT NULL DEFAULT 'queued'
                   CHECK (state IN ('queued','running','awaiting_approval','completed','failed','stopped')),
      inputs       TEXT    NOT NULL DEFAULT '{}',
      events       TEXT    NOT NULL DEFAULT '[]',
      pending_approval TEXT,
      error        TEXT,
      -- The process id of the desktop control helper, so a supervisor can prove
      -- it is gone rather than assume it.
      helper_pid   INTEGER,
      started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      finished_at  TEXT,
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_demonstration_runs_workflow
      ON workflow_demonstration_runs(workflow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_demonstration_runs_user
      ON workflow_demonstration_runs(user_id, started_at DESC);
  `);
}
