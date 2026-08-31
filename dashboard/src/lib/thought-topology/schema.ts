import type Database from "better-sqlite3";

function ensureClusterColumn(
  db: Database.Database,
  name: string,
  definition: string,
): void {
  const columns = db.prepare("PRAGMA table_info(clusters)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE clusters ADD COLUMN ${definition}`);
  }
}

/**
 * Additive rollout state. Pre-feature Gardens retain their disabled value, but
 * the insert trigger makes Thought Topology the database-level default for
 * every Garden created after this schema is installed—even if a future
 * creation path forgets to list the feature column explicitly.
 */
export function ensureThoughtTopologySchema(db: Database.Database): void {
  ensureClusterColumn(
    db,
    "thought_topology_enabled",
    "thought_topology_enabled INTEGER NOT NULL DEFAULT 0 CHECK (thought_topology_enabled IN (0, 1))",
  );
  ensureClusterColumn(
    db,
    "thought_topology_revision",
    "thought_topology_revision INTEGER NOT NULL DEFAULT 0",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS thought_topology_jobs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id     INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      revision       INTEGER NOT NULL,
      reason         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','done','failed','stale')),
      runtime_job_id TEXT,
      last_error     TEXT,
      attempts       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cluster_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_thought_topology_jobs_status
      ON thought_topology_jobs(status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_thought_topology_jobs_one_queued
      ON thought_topology_jobs(cluster_id) WHERE status = 'queued';

    CREATE TRIGGER IF NOT EXISTS clusters_enable_thought_topology_on_insert
    AFTER INSERT ON clusters
    WHEN NEW.thought_topology_enabled = 0
    BEGIN
      UPDATE clusters
         SET thought_topology_enabled = 1
       WHERE id = NEW.id;
    END;
  `);
}
