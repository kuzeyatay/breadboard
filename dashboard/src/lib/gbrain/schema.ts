// Additive Breadboard tables for GBrain source mapping and operational status.
//
// These hold ONLY the server-controlled mapping and sync bookkeeping. The
// canonical garden content stays in markdown; retrieval state (chunks,
// embeddings) lives in the adapter's PGLite store. Nothing here is a source of
// truth for a page's content.
//
// Follows the ensureXSchema(db) convention (see artifact-schema.ts): pure,
// idempotent, invoked once from db.ts.

import type Database from "better-sqlite3";

export function ensureGBrainSchema(db: Database.Database): void {
  db.exec(`
    -- Server-controlled garden -> GBrain source mapping. The content_root and
    -- source_id are derived server-side; a model can never supply either.
    CREATE TABLE IF NOT EXISTS gbrain_garden_sources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id    INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      garden_slug   TEXT    NOT NULL,
      source_id     TEXT    NOT NULL UNIQUE,
      content_root  TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gbrain_sources_cluster
      ON gbrain_garden_sources(cluster_id);

    -- Per-source sync state: pending/synced/stale/failed + last indexed revision.
    CREATE TABLE IF NOT EXISTS gbrain_sync_state (
      source_id       TEXT PRIMARY KEY REFERENCES gbrain_garden_sources(source_id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending',
      last_revision   TEXT,
      last_synced_at  TEXT,
      pages_indexed   INTEGER NOT NULL DEFAULT 0,
      chunks_indexed  INTEGER NOT NULL DEFAULT 0,
      mode            TEXT,
      error           TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sync job queue with bounded backoff. Single-writer discipline: at most one
    -- running job per source (enforced in the store layer).
    CREATE TABLE IF NOT EXISTS gbrain_sync_jobs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id    TEXT NOT NULL,
      cluster_id   INTEGER NOT NULL,
      reason       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gbrain_jobs_source_status
      ON gbrain_sync_jobs(source_id, status);

    -- Secret-free audit of every scoped GBrain query. No secrets, no paths, no
    -- internal source content — only the operation, scope size, and outcome.
    CREATE TABLE IF NOT EXISTS gbrain_query_audit (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      runtime_session_id INTEGER,
      user_id            INTEGER,
      surface            TEXT,
      operation          TEXT NOT NULL,
      authorized_gardens INTEGER NOT NULL DEFAULT 0,
      queried_gardens    INTEGER NOT NULL DEFAULT 0,
      result_count       INTEGER NOT NULL DEFAULT 0,
      mode               TEXT,
      outcome            TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gbrain_audit_session
      ON gbrain_query_audit(runtime_session_id, created_at);
  `);
}
