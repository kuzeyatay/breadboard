import type Database from "better-sqlite3";

/**
 * Skills distilled from documents, keyed by the content of the document rather
 * than by the message it arrived on.
 *
 * Identity is `(user_id, content_hash)`: the same PDF attached to three chats,
 * or a garden source re-uploaded under a new filename, is one skill built once.
 * That is what makes a blocking build tolerable — the cost is paid on first
 * sight of a document and never again.
 *
 * The distilled files themselves live on disk under `document-skills/<slug>/`,
 * because they are markdown the agent reads a piece at a time; this table holds
 * only what has to be queried (identity, status, provenance).
 */
export function ensureDocumentSkillSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_skills (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL REFERENCES users(id),
      slug                 TEXT    NOT NULL UNIQUE,
      content_hash         TEXT    NOT NULL,
      title                TEXT    NOT NULL,
      author               TEXT,
      status               TEXT    NOT NULL DEFAULT 'building',
      book_type            TEXT    NOT NULL DEFAULT 'text',
      depth                TEXT    NOT NULL DEFAULT 'study',
      chapter_count        INTEGER NOT NULL DEFAULT 0,
      source_tokens        INTEGER NOT NULL DEFAULT 0,
      origin_kind          TEXT    NOT NULL DEFAULT 'upload',
      origin_file_name     TEXT    NOT NULL DEFAULT '',
      origin_cluster_slug  TEXT,
      origin_document_slug TEXT,
      error                TEXT,
      created_at           TEXT    NOT NULL,
      updated_at           TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_skills_content
      ON document_skills(user_id, content_hash);

    CREATE INDEX IF NOT EXISTS idx_document_skills_status
      ON document_skills(user_id, status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_document_skills_garden
      ON document_skills(origin_cluster_slug, origin_document_slug);
  `);
}
