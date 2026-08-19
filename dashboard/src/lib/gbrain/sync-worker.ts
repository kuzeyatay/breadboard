// Always-on bounded GBrain synchronization worker.
//
// Drains the gbrain_sync_jobs queue automatically — no manual /api/gbrain/sync
// drain call is required. Properties:
//   * atomic per-job claim (SQLite is single-writer; the claim UPDATE is atomic);
//   * at most one running job per garden (source) at a time;
//   * abandoned-job recovery (a claim older than the stale threshold is requeued);
//   * bounded exponential backoff on failure (attempts + next_attempt_at);
//   * final failure after maxAttempts, with the error code recorded;
//   * clean stop that waits for the in-flight job;
//   * NO full reindex on startup — it only processes explicitly enqueued jobs.
//
// A canonical Breadboard write is NEVER rolled back because indexing failed; the
// source is marked stale and retried here.

import crypto from "node:crypto";
import db from "../db.ts";
import { resolveGBrainConfig } from "./config.ts";
import { syncGarden } from "./sync.ts";
import { setSyncState } from "./mapping.ts";

export interface SyncWorkerOptions {
  intervalMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** A running claim older than this is considered abandoned (crash recovery). */
  staleClaimMs?: number;
  /** Injectable for tests; defaults to the real syncGarden. */
  syncFn?: (clusterId: number) => Promise<{ status: string; error?: string; sourceId?: string }>;
}

interface JobRow {
  id: number;
  source_id: string;
  cluster_id: number;
  attempts: number;
}

export class GBrainSyncWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight: Promise<void> | null = null;
  private readonly workerId = crypto.randomBytes(6).toString("hex");
  private readonly opts: Required<Omit<SyncWorkerOptions, "syncFn">>;
  private readonly syncFn: NonNullable<SyncWorkerOptions["syncFn"]>;

  constructor(options: SyncWorkerOptions = {}) {
    this.opts = {
      intervalMs: options.intervalMs ?? 5000,
      maxAttempts: options.maxAttempts ?? 5,
      baseBackoffMs: options.baseBackoffMs ?? 2000,
      maxBackoffMs: options.maxBackoffMs ?? 5 * 60_000,
      staleClaimMs: options.staleClaimMs ?? 5 * 60_000,
    };
    this.syncFn = options.syncFn ?? ((clusterId) => syncGarden(clusterId));
  }

  start(): void {
    if (this.timer) return;
    // Fire once soon, then on the interval.
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight.catch(() => {});
  }

  /** Recover claims abandoned by a crashed worker: requeue running jobs whose
   *  claim is older than the stale threshold. */
  recoverAbandoned(): number {
    const cutoff = new Date(Date.now() - this.opts.staleClaimMs).toISOString();
    const result = db
      .prepare(
        `UPDATE gbrain_sync_jobs SET status = 'queued', claimed_at = NULL, claimed_by = NULL, updated_at = datetime('now')
         WHERE status = 'running' AND (claimed_at IS NULL OR claimed_at < ?)`,
      )
      .run(cutoff);
    return result.changes;
  }

  /** Atomically claim the next runnable job, honoring per-source single-writer. */
  private claimNext(): JobRow | null {
    const nowIso = new Date().toISOString();
    // Pick a queued job that is due and whose source has no running job.
    const candidate = db
      .prepare(
        `SELECT id, source_id, cluster_id, attempts FROM gbrain_sync_jobs
         WHERE status = 'queued' AND next_attempt_at <= ?
           AND source_id NOT IN (SELECT source_id FROM gbrain_sync_jobs WHERE status = 'running')
         ORDER BY next_attempt_at, id
         LIMIT 1`,
      )
      .get(nowIso) as JobRow | undefined;
    if (!candidate) return null;
    // Atomic claim: only succeeds if still queued (guards against a racing tick).
    const claimed = db
      .prepare(
        `UPDATE gbrain_sync_jobs SET status = 'running', claimed_at = datetime('now'), claimed_by = ?, updated_at = datetime('now')
         WHERE id = ? AND status = 'queued'`,
      )
      .run(this.workerId, candidate.id);
    return claimed.changes === 1 ? candidate : null;
  }

  private backoffIso(attempts: number): string {
    const delay = Math.min(this.opts.maxBackoffMs, this.opts.baseBackoffMs * 2 ** attempts);
    return new Date(Date.now() + delay).toISOString();
  }

  async tick(): Promise<void> {
    if (this.running) return; // one tick at a time in this process
    this.running = true;
    const work = (async () => {
      try {
        this.recoverAbandoned();
        let job = this.claimNext();
        while (job) {
          await this.process(job);
          job = this.claimNext();
        }
      } catch {
        // Never throw out of the interval callback.
      } finally {
        this.running = false;
      }
    })();
    this.inFlight = work;
    await work;
  }

  private async process(job: JobRow): Promise<void> {
    try {
      const result = await this.syncFn(job.cluster_id);
      if (result.status === "synced") {
        db.prepare(
          "UPDATE gbrain_sync_jobs SET status = 'done', last_error = NULL, updated_at = datetime('now') WHERE id = ?",
        ).run(job.id);
      } else {
        this.retryOrFail(job, result.error ?? "sync_not_completed");
      }
    } catch (err) {
      this.retryOrFail(job, err instanceof Error ? err.message : "sync_failed");
    }
  }

  private retryOrFail(job: JobRow, error: string): void {
    const attempts = job.attempts + 1;
    if (attempts >= this.opts.maxAttempts) {
      db.prepare(
        "UPDATE gbrain_sync_jobs SET status = 'failed', attempts = ?, last_error = ?, claimed_at = NULL, claimed_by = NULL, updated_at = datetime('now') WHERE id = ?",
      ).run(attempts, error.slice(0, 300), job.id);
      setSyncState({ sourceId: job.source_id, status: "failed", error: error.slice(0, 300) });
    } else {
      db.prepare(
        "UPDATE gbrain_sync_jobs SET status = 'queued', attempts = ?, last_error = ?, next_attempt_at = ?, claimed_at = NULL, claimed_by = NULL, updated_at = datetime('now') WHERE id = ?",
      ).run(attempts, error.slice(0, 300), this.backoffIso(attempts), job.id);
      setSyncState({ sourceId: job.source_id, status: "stale", error: error.slice(0, 300) });
    }
  }
}

// Process-singleton so Next.js hot-reload / multiple imports share one worker.
const globalWithWorker = global as typeof globalThis & { __gbrainSyncWorker?: GBrainSyncWorker };

export function getSyncWorker(): GBrainSyncWorker {
  if (!globalWithWorker.__gbrainSyncWorker) {
    globalWithWorker.__gbrainSyncWorker = new GBrainSyncWorker();
  }
  return globalWithWorker.__gbrainSyncWorker;
}

/** Start the worker once, only when GBrain is enabled. Safe to call repeatedly. */
export function ensureSyncWorkerStarted(): void {
  if (resolveGBrainConfig().mode === "disabled") return;
  getSyncWorker().start();
}
