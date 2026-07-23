import type Database from "better-sqlite3";

/** Additive, idempotent schema for first-class OpenHarness artifacts. */
export function ensureArtifactSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS openharness_artifacts (
      id                         TEXT PRIMARY KEY,
      user_id                    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      runtime_session_id         INTEGER NOT NULL REFERENCES openharness_runtime_sessions(id) ON DELETE CASCADE,
      openharness_session_id     TEXT NOT NULL,
      conversation_id            INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      cluster_id                 INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
      originating_run_id         TEXT NOT NULL REFERENCES openharness_runs(id) ON DELETE RESTRICT,
      originating_message_id     INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL,
      originating_tool_call_id   TEXT,
      source_surface             TEXT NOT NULL CHECK (source_surface IN ('dashboard_terminal','garden_chat')),
      kind                       TEXT NOT NULL CHECK (kind IN ('text','markdown','document','pdf','presentation','spreadsheet','html','code','image','audio','video','diagram','data','unknown')),
      renderer_id                TEXT NOT NULL,
      title                      TEXT NOT NULL,
      filename                   TEXT NOT NULL,
      mime_type                  TEXT NOT NULL,
      status                     TEXT NOT NULL CHECK (status IN ('draft','generating','ready','failed','archived')),
      current_version            INTEGER NOT NULL DEFAULT 1,
      parent_artifact_id         TEXT REFERENCES openharness_artifacts(id) ON DELETE SET NULL,
      source_skill               TEXT,
      source_mcp_server          TEXT,
      source_mcp_tool            TEXT,
      source_openharness_tool    TEXT,
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
      ON openharness_artifacts(conversation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_garden
      ON openharness_artifacts(cluster_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run
      ON openharness_artifacts(originating_run_id, created_at);

    CREATE TABLE IF NOT EXISTS openharness_artifact_versions (
      id                    TEXT PRIMARY KEY,
      artifact_id           TEXT NOT NULL REFERENCES openharness_artifacts(id) ON DELETE CASCADE,
      version               INTEGER NOT NULL,
      previous_version_id   TEXT REFERENCES openharness_artifact_versions(id) ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS openharness_artifact_events (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id            TEXT NOT NULL REFERENCES openharness_artifacts(id) ON DELETE CASCADE,
      run_id                 TEXT NOT NULL REFERENCES openharness_runs(id) ON DELETE CASCADE,
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
      ON openharness_artifact_events(run_id, id);

    CREATE TABLE IF NOT EXISTS openharness_artifact_provenance (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id        TEXT NOT NULL REFERENCES openharness_artifacts(id) ON DELETE CASCADE,
      version            INTEGER NOT NULL,
      source_kind        TEXT NOT NULL CHECK (source_kind IN ('mcp','skill','tool','resource')),
      source_server      TEXT,
      source_tool        TEXT,
      invocation_id      TEXT,
      resource_metadata  TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifact_provenance_artifact
      ON openharness_artifact_provenance(artifact_id, version, id);
  `);
}
