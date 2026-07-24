// Server-controlled garden <-> GBrain source mapping and sync bookkeeping.
//
// The mapping is the trust anchor: a Breadboard cluster id deterministically
// resolves to exactly one internal GBrain source id and one server-owned content
// root. The model never supplies a source id or a content root, so it cannot
// widen scope by naming one.

import path from "node:path";
import db from "../db.ts";

export interface GardenSourceMapping {
  clusterId: number;
  gardenSlug: string;
  sourceId: string;
  contentRoot: string;
}

interface ClusterRow {
  id: number;
  slug: string;
  name: string;
}

/** Deterministic, server-owned source id. Derived from the cluster id so it is
 *  stable and impossible for a model to guess-then-widen (guessing it grants
 *  nothing — authorization is still checked against the mapping table). */
export function deriveSourceId(clusterId: number): string {
  return `gbrain-src-cluster-${clusterId}`;
}

function contentRootFor(slug: string): string {
  const base = process.env.QUARTZ_CONTENT_PATH;
  if (!base) throw new Error("QUARTZ_CONTENT_PATH not configured");
  return path.join(base, slug);
}

export function getOrCreateSourceMapping(clusterId: number, gardenSlug: string): GardenSourceMapping {
  const existing = db
    .prepare("SELECT cluster_id, garden_slug, source_id, content_root FROM gbrain_garden_sources WHERE cluster_id = ?")
    .get(clusterId) as
    | { cluster_id: number; garden_slug: string; source_id: string; content_root: string }
    | undefined;
  if (existing) {
    return {
      clusterId: existing.cluster_id,
      gardenSlug: existing.garden_slug,
      sourceId: existing.source_id,
      contentRoot: existing.content_root,
    };
  }
  const sourceId = deriveSourceId(clusterId);
  const contentRoot = contentRootFor(gardenSlug);
  db.prepare(
    "INSERT INTO gbrain_garden_sources (cluster_id, garden_slug, source_id, content_root) VALUES (?, ?, ?, ?)",
  ).run(clusterId, gardenSlug, sourceId, contentRoot);
  db.prepare("INSERT OR IGNORE INTO gbrain_sync_state (source_id, status) VALUES (?, 'pending')").run(sourceId);
  return { clusterId, gardenSlug, sourceId, contentRoot };
}

/** Reverse-map an internal source id back to its garden. Used to validate every
 *  citation the adapter returns against the authorized mapping set. */
export function getMappingBySourceId(sourceId: string): GardenSourceMapping | null {
  const row = db
    .prepare("SELECT cluster_id, garden_slug, source_id, content_root FROM gbrain_garden_sources WHERE source_id = ?")
    .get(sourceId) as
    | { cluster_id: number; garden_slug: string; source_id: string; content_root: string }
    | undefined;
  if (!row) return null;
  return { clusterId: row.cluster_id, gardenSlug: row.garden_slug, sourceId: row.source_id, contentRoot: row.content_root };
}

export function loadClusterById(clusterId: number): ClusterRow | null {
  return (db.prepare("SELECT id, slug, name FROM clusters WHERE id = ?").get(clusterId) as ClusterRow | undefined) ?? null;
}

export function loadClusterBySlug(slug: string): ClusterRow | null {
  return (db.prepare("SELECT id, slug, name FROM clusters WHERE slug = ?").get(slug) as ClusterRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export type SyncStatus = "pending" | "syncing" | "synced" | "stale" | "failed";

export function setSyncState(input: {
  sourceId: string;
  status: SyncStatus;
  revision?: string | null;
  pagesIndexed?: number;
  chunksIndexed?: number;
  mode?: string | null;
  error?: string | null;
}): void {
  db.prepare(
    `INSERT INTO gbrain_sync_state (source_id, status, last_revision, last_synced_at, pages_indexed, chunks_indexed, mode, error, updated_at)
     VALUES (@sourceId, @status, @revision, @lastSynced, COALESCE(@pages, 0), COALESCE(@chunks, 0), @mode, @error, datetime('now'))
     ON CONFLICT(source_id) DO UPDATE SET
       status = @status,
       last_revision = COALESCE(@revision, last_revision),
       last_synced_at = COALESCE(@lastSynced, last_synced_at),
       pages_indexed = COALESCE(@pages, pages_indexed),
       chunks_indexed = COALESCE(@chunks, chunks_indexed),
       mode = COALESCE(@mode, mode),
       error = @error,
       updated_at = datetime('now')`,
  ).run({
    sourceId: input.sourceId,
    status: input.status,
    revision: input.revision ?? null,
    lastSynced: input.status === "synced" ? new Date().toISOString() : null,
    pages: input.pagesIndexed ?? null,
    chunks: input.chunksIndexed ?? null,
    mode: input.mode ?? null,
    error: input.error ?? null,
  });
}

export function getSyncState(sourceId: string): Record<string, unknown> | null {
  return (db.prepare("SELECT * FROM gbrain_sync_state WHERE source_id = ?").get(sourceId) as
    | Record<string, unknown>
    | undefined) ?? null;
}

/** Enqueue a sync job unless one is already active for the source (single-writer). */
export function enqueueSyncJob(sourceId: string, clusterId: number, reason: string): number | null {
  const active = db
    .prepare("SELECT id FROM gbrain_sync_jobs WHERE source_id = ? AND status IN ('queued','running')")
    .get(sourceId) as { id: number } | undefined;
  if (active) return active.id;
  const result = db
    .prepare(
      "INSERT INTO gbrain_sync_jobs (source_id, cluster_id, reason, next_attempt_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(sourceId, clusterId, reason);
  setSyncState({ sourceId, status: "pending" });
  return Number(result.lastInsertRowid);
}

export function listSyncJobs(status?: string): Array<Record<string, unknown>> {
  if (status) {
    return db
      .prepare("SELECT * FROM gbrain_sync_jobs WHERE status = ? ORDER BY created_at DESC LIMIT 100")
      .all(status) as Array<Record<string, unknown>>;
  }
  return db.prepare("SELECT * FROM gbrain_sync_jobs ORDER BY created_at DESC LIMIT 100").all() as Array<
    Record<string, unknown>
  >;
}

export function setJobStatus(id: number, status: string, error?: string | null): void {
  db.prepare("UPDATE gbrain_sync_jobs SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    error ?? null,
    id,
  );
}

// ---------------------------------------------------------------------------
// Query audit (secret-free)
// ---------------------------------------------------------------------------

export function recordQueryAudit(input: {
  runtimeSessionId?: number | null;
  userId?: number | null;
  surface?: string | null;
  operation: string;
  authorizedGardens: number;
  queriedGardens: number;
  resultCount: number;
  mode?: string | null;
  outcome: string;
}): void {
  db.prepare(
    `INSERT INTO gbrain_query_audit
       (runtime_session_id, user_id, surface, operation, authorized_gardens, queried_gardens, result_count, mode, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.runtimeSessionId ?? null,
    input.userId ?? null,
    input.surface ?? null,
    input.operation,
    input.authorizedGardens,
    input.queriedGardens,
    input.resultCount,
    input.mode ?? null,
    input.outcome,
  );
}

export function listQueryAudit(runtimeSessionId?: number): Array<Record<string, unknown>> {
  if (runtimeSessionId) {
    return db
      .prepare("SELECT * FROM gbrain_query_audit WHERE runtime_session_id = ? ORDER BY created_at, id")
      .all(runtimeSessionId) as Array<Record<string, unknown>>;
  }
  return db.prepare("SELECT * FROM gbrain_query_audit ORDER BY created_at DESC, id DESC LIMIT 500").all() as Array<
    Record<string, unknown>
  >;
}
