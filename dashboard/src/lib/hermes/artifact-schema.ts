import type Database from "better-sqlite3";
import { ensureGadgetSchema, migrateArtifactKindsForGadgets } from "./gadget-schema.ts";

/** Additive, idempotent schema for first-class Hermes artifacts. */
export function ensureArtifactSchema(database: Database.Database): void {
  // Runs before CREATE TABLE: on an existing database this widens the `kind`
  // constraint, and on a fresh one it finds no table and does nothing, because
  // the CREATE below already carries the current list.
  migrateArtifactKindsForGadgets(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS hermes_artifacts (
      id                         TEXT PRIMARY KEY,
      user_id                    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      runtime_session_id         INTEGER NOT NULL REFERENCES hermes_runtime_sessions(id) ON DELETE CASCADE,
      hermes_session_id     TEXT NOT NULL,
      conversation_id            INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      cluster_id                 INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
      originating_run_id         TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE RESTRICT,
      originating_message_id     INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL,
      originating_tool_call_id   TEXT,
      source_surface             TEXT NOT NULL CHECK (source_surface IN ('dashboard_terminal','garden_chat')),
      kind                       TEXT NOT NULL CHECK (kind IN ('text','markdown','document','pdf','presentation','spreadsheet','html','code','image','audio','video','diagram','data','unknown','gadget','model')),
      renderer_id                TEXT NOT NULL,
      title                      TEXT NOT NULL,
      filename                   TEXT NOT NULL,
      mime_type                  TEXT NOT NULL,
      status                     TEXT NOT NULL CHECK (status IN ('draft','generating','ready','failed','archived')),
      current_version            INTEGER NOT NULL DEFAULT 1,
      parent_artifact_id         TEXT REFERENCES hermes_artifacts(id) ON DELETE SET NULL,
      source_skill               TEXT,
      source_mcp_server          TEXT,
      source_mcp_tool            TEXT,
      source_hermes_tool    TEXT,
      preview_location           TEXT,
      output_location            TEXT,
      byte_size                  INTEGER,
      content_hash               TEXT,
      metadata_json              TEXT NOT NULL DEFAULT '{}',
      error_json                 TEXT,
      created_at                 TEXT NOT NULL,
      updated_at                 TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_conversation
      ON hermes_artifacts(conversation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_garden
      ON hermes_artifacts(cluster_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run
      ON hermes_artifacts(originating_run_id, created_at);

    CREATE TABLE IF NOT EXISTS hermes_artifact_versions (
      id                    TEXT PRIMARY KEY,
      artifact_id           TEXT NOT NULL REFERENCES hermes_artifacts(id) ON DELETE CASCADE,
      version               INTEGER NOT NULL,
      previous_version_id   TEXT REFERENCES hermes_artifact_versions(id) ON DELETE SET NULL,
      status                TEXT NOT NULL CHECK (status IN ('draft','generating','ready','failed','archived')),
      source_location       TEXT NOT NULL,
      preview_location      TEXT,
      output_location       TEXT,
      mime_type             TEXT NOT NULL,
      byte_size             INTEGER,
      content_hash          TEXT,
      metadata_json         TEXT NOT NULL DEFAULT '{}',
      error_json            TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      UNIQUE(artifact_id, version)
    );

    CREATE TABLE IF NOT EXISTS hermes_artifact_events (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id            TEXT NOT NULL REFERENCES hermes_artifacts(id) ON DELETE CASCADE,
      run_id                 TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE CASCADE,
      conversation_id        INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      cluster_id             INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
      assistant_message_id   INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL,
      event_type             TEXT NOT NULL,
      status                 TEXT NOT NULL,
      version                INTEGER NOT NULL,
      payload_json           TEXT NOT NULL DEFAULT '{}',
      created_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifact_events_run
      ON hermes_artifact_events(run_id, id);

    CREATE TABLE IF NOT EXISTS hermes_artifact_provenance (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id        TEXT NOT NULL REFERENCES hermes_artifacts(id) ON DELETE CASCADE,
      version            INTEGER NOT NULL,
      source_kind        TEXT NOT NULL CHECK (source_kind IN ('mcp','skill','tool','resource')),
      source_server      TEXT,
      source_tool        TEXT,
      invocation_id      TEXT,
      resource_metadata  TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifact_provenance_artifact
      ON hermes_artifact_provenance(artifact_id, version, id);

    CREATE TABLE IF NOT EXISTS hermes_interactive_visualizers (
      artifact_id             TEXT PRIMARY KEY REFERENCES hermes_artifacts(id) ON DELETE CASCADE,
      schema_version          INTEGER NOT NULL DEFAULT 1,
      lifecycle_status        TEXT NOT NULL CHECK (lifecycle_status IN (
        'planned','generating','validating','browser_testing','ready','failed','cancelled'
      )),
      mode                    TEXT NOT NULL CHECK (mode IN ('2d','3d','hybrid')),
      plan_json               TEXT NOT NULL,
      active_version          INTEGER NOT NULL DEFAULT 0,
      current_job_id          TEXT,
      repair_attempt          INTEGER NOT NULL DEFAULT 0,
      cancellation_requested  INTEGER NOT NULL DEFAULT 0,
      last_error_json         TEXT,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hermes_interactive_visualizer_jobs (
      id                    TEXT PRIMARY KEY,
      artifact_id           TEXT NOT NULL REFERENCES hermes_artifacts(id) ON DELETE CASCADE,
      run_id                TEXT NOT NULL REFERENCES hermes_runs(id) ON DELETE CASCADE,
      candidate_version     INTEGER NOT NULL,
      attempt               INTEGER NOT NULL,
      operation             TEXT NOT NULL CHECK (operation IN ('create','revise','rollback')),
      status                TEXT NOT NULL CHECK (status IN (
        'generating','validating','browser_testing','ready','failed','cancelled'
      )),
      revision_prompt       TEXT,
      package_json          TEXT,
      validation_json       TEXT,
      tests_json            TEXT,
      manifest_json         TEXT,
      error_json            TEXT,
      started_at            TEXT NOT NULL,
      completed_at          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_interactive_visualizer_jobs_artifact
      ON hermes_interactive_visualizer_jobs(artifact_id, started_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interactive_visualizer_job_attempt
      ON hermes_interactive_visualizer_jobs(artifact_id, candidate_version, attempt);
    CREATE INDEX IF NOT EXISTS idx_interactive_visualizers_status
      ON hermes_interactive_visualizers(lifecycle_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_interactive_visualizer_jobs_status
      ON hermes_interactive_visualizer_jobs(status, started_at);
  `);
  // A marker on the row in the archive, from the palette chats are marked with.
  // Like pinning a chat it is placement rather than activity, so nothing that
  // writes it touches updated_at — the archive is ordered by that.
  ensureColumn(database, "hermes_artifacts", "highlight", "highlight TEXT");
  // Older background-agent runs could write the assistant id to their artifact
  // event after creating the artifact, but leave the artifact row itself
  // unassigned. Recover that durable ownership from the newest event that names
  // a response. This also fixes existing chats: their placeholder moves above
  // the response actions on the next schema check without changing archive
  // ordering or inventing ownership where no event recorded one.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_artifact_events_artifact
      ON hermes_artifact_events(artifact_id, id DESC);
    UPDATE hermes_artifacts AS artifact
    SET originating_message_id = (
      SELECT event.assistant_message_id
      FROM hermes_artifact_events AS event
      WHERE event.artifact_id = artifact.id
        AND event.assistant_message_id IS NOT NULL
      ORDER BY event.id DESC
      LIMIT 1
    )
    WHERE artifact.originating_message_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM hermes_artifact_events AS event
        WHERE event.artifact_id = artifact.id
          AND event.assistant_message_id IS NOT NULL
      );
  `);
  ensureGadgetSchema(database);
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
