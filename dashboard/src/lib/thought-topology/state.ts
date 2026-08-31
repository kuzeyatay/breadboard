import "server-only";

import type Database from "better-sqlite3";

import db from "../db.ts";

export interface ThoughtTopologyRolloutState {
  id: number;
  userId: number;
  slug: string;
  title: string;
  enabled: boolean;
  revision: number;
}

interface RolloutRow {
  id: number;
  user_id: number;
  slug: string;
  name: string;
  thought_topology_enabled: number;
  thought_topology_revision: number;
}

export interface TopologyQueueSubmission {
  clusterId: number;
  userId: number;
  gardenId: string;
  revision: number;
  queueJobId: number;
}

export type TopologySubmitter = (submission: TopologyQueueSubmission) => Promise<unknown>;

function boundedReason(reason: string): string {
  return reason.replace(/\p{Cc}+/gu, " ").trim().slice(0, 500) || "garden mutation";
}

export function readThoughtTopologyRolloutState(
  slug: string,
  database: Database.Database = db,
): ThoughtTopologyRolloutState | null {
  const row = database.prepare(
    `SELECT id, user_id, slug, name, thought_topology_enabled, thought_topology_revision
       FROM clusters
      WHERE slug = ?
      LIMIT 1`,
  ).get(slug) as RolloutRow | undefined;
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        slug: row.slug,
        title: row.name,
        enabled: row.thought_topology_enabled === 1,
        revision: row.thought_topology_revision,
      }
    : null;
}

export function readThoughtTopologyRolloutStateById(
  clusterId: number,
  database: Database.Database = db,
): ThoughtTopologyRolloutState | null {
  const row = database.prepare(
    `SELECT id, user_id, slug, name, thought_topology_enabled, thought_topology_revision
       FROM clusters
      WHERE id = ?
      LIMIT 1`,
  ).get(clusterId) as RolloutRow | undefined;
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        slug: row.slug,
        title: row.name,
        enabled: row.thought_topology_enabled === 1,
        revision: row.thought_topology_revision,
      }
    : null;
}

async function defaultSubmitter(submission: TopologyQueueSubmission): Promise<unknown> {
  const runtime = await import("../runtime-v2/thought-topology-job.ts");
  return runtime.startThoughtTopologyRuntimeJob(submission);
}

/**
 * The sole mutation invalidation boundary. The first operation is a bounded DB
 * lookup; disabled Gardens return before filesystem access, hashing, queueing,
 * embedding, model use, or Runtime submission.
 */
export async function invalidateThoughtTopologyAfterMutation(
  gardenSlug: string,
  reason: string,
  options: {
    database?: Database.Database;
    submit?: TopologySubmitter;
  } = {},
): Promise<{ enabled: false } | { enabled: true; revision: number; queueJobId: number }> {
  const database = options.database ?? db;
  const current = readThoughtTopologyRolloutState(gardenSlug, database);
  if (!current?.enabled) return { enabled: false };

  const queued = database.transaction(() => {
    const updated = database.prepare(
      `UPDATE clusters
          SET thought_topology_revision = thought_topology_revision + 1
        WHERE id = ? AND thought_topology_enabled = 1 AND thought_topology_revision = ?`,
    ).run(current.id, current.revision);
    if (updated.changes !== 1) return null;
    const revision = current.revision + 1;
    const queued = database.prepare(
      "SELECT id FROM thought_topology_jobs WHERE cluster_id = ? AND status = 'queued' LIMIT 1",
    ).get(current.id) as { id: number } | undefined;
    if (queued) {
      database.prepare(
        `UPDATE thought_topology_jobs
            SET revision = ?, reason = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'queued'`,
      ).run(revision, boundedReason(reason), queued.id);
    } else {
      database.prepare(
        `INSERT INTO thought_topology_jobs (cluster_id, revision, reason, status, updated_at)
         VALUES (?, ?, ?, 'queued', datetime('now'))`,
      ).run(current.id, revision, boundedReason(reason));
    }
    const row = database.prepare(
      "SELECT id FROM thought_topology_jobs WHERE cluster_id = ? AND revision = ? AND status = 'queued'",
    ).get(current.id, revision) as { id: number };
    return { revision, queueJobId: row.id };
  })();

  if (!queued) {
    // Another mutation won the compare-and-swap. Let its queued build observe
    // the later revision rather than doing any work inside this caller.
    return { enabled: true, revision: current.revision + 1, queueJobId: 0 };
  }

  const submit = options.submit ?? defaultSubmitter;
  void submit({
    clusterId: current.id,
    userId: current.userId,
    gardenId: current.slug,
    revision: queued.revision,
    queueJobId: queued.queueJobId,
  }).catch(() => {
    // Durable queued state survives transient Runtime unavailability.
  });
  return { enabled: true, ...queued };
}

/** Future explicit opt-in primitive. Not called by any migration/startup path. */
export function enableThoughtTopologyForNewGarden(
  clusterId: number,
  database: Database.Database = db,
): boolean {
  return database.prepare(
    `UPDATE clusters
        SET thought_topology_enabled = 1
      WHERE id = ? AND thought_topology_enabled = 0 AND thought_topology_revision = 0`,
  ).run(clusterId).changes === 1;
}
