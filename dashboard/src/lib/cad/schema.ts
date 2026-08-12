import type Database from "better-sqlite3";

/**
 * Additive, idempotent schema for parametric CAD projects.
 *
 * A project belongs to one conversation and accumulates immutable revisions.
 * `current_revision` only ever points at a revision that validated, so a failed
 * regeneration can never replace the last design that worked.
 *
 * Export bytes are not stored here. They live under Breadboard-controlled
 * application storage (see blob-store.ts) because the artifact store keeps one
 * text source plus one rendered output per version, and a CAD revision has six
 * files, four of them binary. Every row below records the sha256 and byte size
 * of what was written, so a file that changed on disk is detectable.
 */
export function ensureCadSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cad_projects (
      id                  TEXT PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id     INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      cluster_id          INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
      artifact_id         TEXT,
      name                TEXT NOT NULL,
      units               TEXT NOT NULL DEFAULT 'mm' CHECK (units IN ('mm','inch')),
      process             TEXT NOT NULL DEFAULT 'fdm' CHECK (process IN ('fdm','sla','sls','unknown')),
      status              TEXT NOT NULL CHECK (status IN ('draft','valid','valid-with-warnings','invalid')),
      current_revision    INTEGER NOT NULL DEFAULT 0,
      latest_revision     INTEGER NOT NULL DEFAULT 0,
      design_spec_json    TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cad_projects_conversation
      ON cad_projects(conversation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cad_projects_user
      ON cad_projects(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS cad_revisions (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL REFERENCES cad_projects(id) ON DELETE CASCADE,
      revision            INTEGER NOT NULL,
      parent_revision     INTEGER,
      status              TEXT NOT NULL CHECK (status IN ('draft','valid','valid-with-warnings','invalid')),
      instruction         TEXT NOT NULL DEFAULT '',
      source              TEXT NOT NULL,
      entrypoint          TEXT NOT NULL DEFAULT 'build_model',
      parameters_json     TEXT NOT NULL DEFAULT '{}',
      parameter_diff_json TEXT NOT NULL DEFAULT '[]',
      design_spec_json    TEXT NOT NULL DEFAULT '{}',
      measurements_json   TEXT NOT NULL DEFAULT '{}',
      validation_json     TEXT NOT NULL DEFAULT '{}',
      provenance_json     TEXT NOT NULL DEFAULT '{}',
      generation_log_json TEXT NOT NULL DEFAULT '[]',
      model               TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL,
      UNIQUE(project_id, revision)
    );

    CREATE INDEX IF NOT EXISTS idx_cad_revisions_project
      ON cad_revisions(project_id, revision DESC);

    CREATE TABLE IF NOT EXISTS cad_revision_files (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id          TEXT NOT NULL REFERENCES cad_projects(id) ON DELETE CASCADE,
      revision            INTEGER NOT NULL,
      format              TEXT NOT NULL,
      filename            TEXT NOT NULL,
      mime_type           TEXT NOT NULL,
      relative_path       TEXT NOT NULL,
      byte_size           INTEGER NOT NULL,
      sha256              TEXT NOT NULL,
      linear_tolerance    REAL,
      angular_tolerance   REAL,
      created_at          TEXT NOT NULL,
      UNIQUE(project_id, revision, format)
    );

    CREATE INDEX IF NOT EXISTS idx_cad_revision_files_revision
      ON cad_revision_files(project_id, revision);
  `);
}
