import "server-only";

import type Database from "better-sqlite3";

import db from "../db.ts";
import { thoughtTopologyAutoUpdateEnabled } from "./preferences.ts";
import type { RuntimeJobSnapshot } from "../supervisor-control.ts";

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

interface QueueDispatchRow extends TopologyQueueSubmission {
  status: "queued" | "running";
}

const SUBMISSION_MARKER_PREFIX = "submitting:";

/** Repair queue entries when a worker exits before it can record its result. */
export function reconcileThoughtTopologyRuntimeJob(
  clusterId: number,
  snapshot: RuntimeJobSnapshot,
  database: Database.Database = db,
): boolean {
  if (snapshot.jobType !== "thought-topology" || snapshot.workerKind !== "thought-topology-node" ||
      snapshot.conversationId !== null ||
      !["succeeded", "failed", "cancelled", "interrupted", "uncertain", "resource_exhausted"].includes(snapshot.state)) return false;
  // A successful worker normally commits `done` itself. An orphaned success
  // needs a content check, since its queued revision may have moved on.
  const status = snapshot.state === "succeeded" ? "stale" : "failed";
  return database.prepare(
    `UPDATE thought_topology_jobs
        SET status = ?, last_error = ?, updated_at = datetime('now')
      WHERE cluster_id = ? AND runtime_job_id = ? AND status IN ('queued', 'running')
        AND EXISTS (SELECT 1 FROM clusters WHERE id = ? AND slug = ? AND thought_topology_enabled = 1)`,
  ).run(status, status === "failed" ? "Thought Topology background build stopped before completion." : null,
    clusterId, snapshot.jobId, clusterId, snapshot.gardenId).changes > 0;
}

function submissionMarker(queueJobId: number, revision: number): string {
  return `${SUBMISSION_MARKER_PREFIX}${queueJobId}:${revision}`;
}

function markerRevision(value: string | null): number | null {
  if (!value?.startsWith(SUBMISSION_MARKER_PREFIX)) return null;
  const revision = Number(value.slice(value.lastIndexOf(":") + 1));
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

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

/**
 * How long the read path waits before queueing another automatic repair after
 * each consecutive failed build, indexed by the number of failures in a row.
 * A worker that died once (a crash, a Runtime restart) is replaced at once;
 * the wait starts on the second identical failure. The last entry is the
 * ceiling.
 *
 * A repair queued from a read (an old scoring version, a partial artifact,
 * drifted content) reproduces the same conditions on every poll until a build
 * succeeds. When the cause is environmental — the embedding service is down —
 * every attempt fails identically, and without this each open page relaunched
 * a 60–90 s worker process tree every drift-check interval, indefinitely
 * (4,000+ failed rows for one Garden on 2026-09-10). Explicit mutations are
 * not subject to this: they still queue at once.
 */
export const READ_PATH_REPAIR_BACKOFF_MS = [
  0,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

/**
 * Milliseconds until the read path may queue another automatic repair for a
 * Garden, or 0 when it may do so now. Only an unbroken run of `failed` rows at
 * the head of the queue counts; any other outcome (done, stale, a live row)
 * resets the backoff.
 */
export function readPathRepairDelayMs(
  clusterId: number,
  database: Database.Database = db,
  now: number = Date.now(),
): number {
  const rows = database.prepare(
    `SELECT status, updated_at
       FROM thought_topology_jobs
      WHERE cluster_id = ?
      ORDER BY id DESC
      LIMIT ?`,
  ).all(clusterId, READ_PATH_REPAIR_BACKOFF_MS.length) as { status: string; updated_at: string }[];
  let failures = 0;
  for (const row of rows) {
    if (row.status !== "failed") break;
    failures += 1;
  }
  if (failures === 0) return 0;
  const failedAt = Date.parse(`${rows[0].updated_at.replace(" ", "T")}Z`);
  if (!Number.isFinite(failedAt)) return 0;
  const delay = READ_PATH_REPAIR_BACKOFF_MS[Math.min(failures, READ_PATH_REPAIR_BACKOFF_MS.length) - 1];
  return Math.max(0, failedAt + delay - now);
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

function submittedRuntimeJobId(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("snapshot" in result)) return null;
  const snapshot = result.snapshot;
  if (!snapshot || typeof snapshot !== "object" || !("jobId" in snapshot)) return null;
  return typeof snapshot.jobId === "string" && snapshot.jobId.length > 0
    ? snapshot.jobId
    : null;
}

function releaseFailedDispatch(
  database: Database.Database,
  row: QueueDispatchRow,
  error: unknown,
  submissionMarker: string | null,
): void {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\p{Cc}+/gu, " ")
    .slice(0, 500);
  if (row.status === "queued" && submissionMarker) {
    database.prepare(
      `UPDATE thought_topology_jobs
          SET runtime_job_id = NULL, last_error = ?, attempts = attempts + 1,
              updated_at = datetime('now')
        WHERE id = ? AND status = 'queued' AND runtime_job_id = ?`,
    ).run(message, row.queueJobId, submissionMarker);
    return;
  }
  database.transaction(() => {
    const newerQueue = database.prepare(
      `SELECT id
         FROM thought_topology_jobs
        WHERE cluster_id = ? AND status = 'queued' AND id <> ?
        LIMIT 1`,
    ).get(row.clusterId, row.queueJobId) as { id: number } | undefined;
    database.prepare(
      `UPDATE thought_topology_jobs
          SET status = ?, last_error = ?, attempts = attempts + 1,
              updated_at = datetime('now')
        WHERE id = ? AND status = 'running' AND runtime_job_id IS NULL`,
    ).run(newerQueue ? "stale" : "queued", message, row.queueJobId);
  }).immediate();
}

/**
 * Mark a submission before the asynchronous Runtime call. A queued row stays
 * queued until its worker begins, so further Markdown mutations coalesce by
 * advancing this row's revision. The worker reads that latest revision when it
 * starts and incrementally places only the new Markdown into the cached map.
 */
async function dispatchTopologyQueueRow(
  row: QueueDispatchRow,
  database: Database.Database,
  submit: TopologySubmitter,
  existingSubmissionMarker: string | null = null,
): Promise<boolean> {
  let activeSubmissionMarker: string | null = null;
  if (row.status === "queued") {
    activeSubmissionMarker = existingSubmissionMarker ?? submissionMarker(row.queueJobId, row.revision);
    const marked = existingSubmissionMarker
      ? database.prepare(
          `UPDATE thought_topology_jobs
              SET updated_at = datetime('now')
            WHERE id = ? AND status = 'queued' AND runtime_job_id = ?`,
        ).run(row.queueJobId, existingSubmissionMarker)
      : database.prepare(
          `UPDATE thought_topology_jobs
              SET runtime_job_id = ?, updated_at = datetime('now')
            WHERE id = ? AND revision = ? AND status = 'queued'
              AND runtime_job_id IS NULL`,
        ).run(activeSubmissionMarker, row.queueJobId, row.revision);
    if (marked.changes !== 1) return false;
  }
  try {
    const submission: TopologyQueueSubmission = {
      clusterId: row.clusterId,
      userId: row.userId,
      gardenId: row.gardenId,
      revision: row.revision,
      queueJobId: row.queueJobId,
    };
    const result = await submit(submission);
    const runtimeJobId = submittedRuntimeJobId(result);
    if (runtimeJobId) {
      if (activeSubmissionMarker) {
        database.prepare(
          `UPDATE thought_topology_jobs
              SET runtime_job_id = ?, updated_at = datetime('now')
            WHERE id = ? AND status IN ('queued', 'running')
              AND runtime_job_id = ?`,
        ).run(runtimeJobId, row.queueJobId, activeSubmissionMarker);
      } else {
        database.prepare(
          `UPDATE thought_topology_jobs
              SET runtime_job_id = ?, updated_at = datetime('now')
            WHERE id = ? AND status = 'running' AND runtime_job_id IS NULL`,
        ).run(runtimeJobId, row.queueJobId);
      }
    }
    return true;
  } catch (error) {
    releaseFailedDispatch(database, row, error, activeSubmissionMarker);
    logSubmissionFailure(row.gardenId, row.queueJobId, error);
    return false;
  }
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
    /** Only an explicit, authorized retry may bypass the account preference. */
    manual?: boolean;
  } = {},
): Promise<{ enabled: false } | { enabled: true; revision: number; queueJobId: number }> {
  const database = options.database ?? db;
  const current = readThoughtTopologyRolloutState(gardenSlug, database);
  if (!current?.enabled) return { enabled: false };
  const automatic = thoughtTopologyAutoUpdateEnabled(current.userId, database);

  const queued = database.transaction(() => {
    const updated = database.prepare(
      `UPDATE clusters
          SET thought_topology_revision = thought_topology_revision + 1
        WHERE id = ? AND thought_topology_enabled = 1 AND thought_topology_revision = ?`,
    ).run(current.id, current.revision);
    if (updated.changes !== 1) return null;
    const revision = current.revision + 1;
    // Keep invalidation visible without creating background work while paused.
    if (!automatic && !options.manual) {
      return { revision, queueJobId: 0, runtimeJobId: null };
    }
    const queued = database.prepare(
      `SELECT id, runtime_job_id
         FROM thought_topology_jobs
        WHERE cluster_id = ? AND status = 'queued'
        LIMIT 1`,
    ).get(current.id) as { id: number; runtime_job_id: string | null } | undefined;
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
      `SELECT id, runtime_job_id
         FROM thought_topology_jobs
        WHERE cluster_id = ? AND revision = ? AND status = 'queued'`,
    ).get(current.id, revision) as { id: number; runtime_job_id: string | null };
    return { revision, queueJobId: row.id, runtimeJobId: row.runtime_job_id };
  }).immediate();

  if (!queued) {
    // Another mutation won the compare-and-swap. Let its queued build observe
    // the later revision rather than doing any work inside this caller.
    return { enabled: true, revision: current.revision + 1, queueJobId: 0 };
  }

  const submit = options.submit ?? defaultSubmitter;
  if (queued.queueJobId && !queued.runtimeJobId) {
    void dispatchTopologyQueueRow({
      clusterId: current.id,
      userId: current.userId,
      gardenId: current.slug,
      revision: queued.revision,
      queueJobId: queued.queueJobId,
      status: "queued",
    }, database, submit);
  }
  return {
    enabled: true,
    revision: queued.revision,
    queueJobId: queued.queueJobId,
  };
}

function logSubmissionFailure(slug: string, queueJobId: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[thought-topology] Runtime submission for ${slug} (queue job ${queueJobId}) failed: ${message}`);
}

/**
 * A row whose Runtime submission failed, or whose process stopped between
 * claiming and persisting the returned Runtime identity, is safe to submit
 * again: the revision-scoped idempotency key makes repeats harmless.
 */
export async function resubmitQueuedThoughtTopologyJob(
  gardenSlug: string,
  options: {
    database?: Database.Database;
    submit?: TopologySubmitter;
    /** Rows updated more recently than this are assumed to be in flight. */
    minimumAgeMs?: number;
    manual?: boolean;
  } = {},
): Promise<boolean> {
  const database = options.database ?? db;
  const current = readThoughtTopologyRolloutState(gardenSlug, database);
  if (!current?.enabled) return false;
  if (!options.manual && !thoughtTopologyAutoUpdateEnabled(current.userId, database)) return false;
  const row = database.prepare(
    `SELECT id, revision, status, runtime_job_id, updated_at
       FROM thought_topology_jobs
      WHERE cluster_id = ? AND status IN ('queued', 'running')
        AND (runtime_job_id IS NULL OR runtime_job_id LIKE ?)
      ORDER BY revision DESC, id DESC
      LIMIT 1`,
  ).get(current.id, `${SUBMISSION_MARKER_PREFIX}%`) as {
    id: number;
    revision: number;
    status: "queued" | "running";
    runtime_job_id: string | null;
    updated_at: string;
  } | undefined;
  if (!row) return false;
  const ageMs = Date.now() - Date.parse(`${row.updated_at.replace(" ", "T")}Z`);
  if (Number.isFinite(ageMs) && ageMs < (options.minimumAgeMs ?? 30_000)) return false;
  if (row.status === "queued" && row.revision !== current.revision) {
    // The Garden moved on while the row sat unsubmitted; build the latest.
    database.prepare(
      `UPDATE thought_topology_jobs
          SET revision = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'queued'`,
    ).run(current.revision, row.id);
  }
  const submit = options.submit ?? defaultSubmitter;
  const existingMarker = row.status === "queued" && row.runtime_job_id?.startsWith(SUBMISSION_MARKER_PREFIX)
    ? row.runtime_job_id
    : null;
  const submittedRevision = markerRevision(existingMarker) ?? (
    row.status === "queued" ? current.revision : row.revision
  );
  return dispatchTopologyQueueRow({
    clusterId: current.id,
    userId: current.userId,
    gardenId: current.slug,
    revision: submittedRevision,
    queueJobId: row.id,
    status: row.status,
  }, database, submit, existingMarker);
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
