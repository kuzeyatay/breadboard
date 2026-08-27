// GBrain synchronization compatibility facade.
//
// Next.js performs only bounded authorization/bookkeeping and Runtime control
// calls. Full garden scans and adapter indexing execute in a fresh Rust-owned
// worker (`sync-executor.ts`) and never fall back into this process.

import path from "node:path";

import {
  runGBrainSyncViaRuntime,
  startGBrainSyncRuntimeJob,
} from "../runtime-v2/gbrain-sync-job.ts";
import { resolveGBrainConfig } from "./config.ts";
import {
  enqueueSyncJob,
  getOrCreateSourceMapping,
  listSyncJobs,
  loadClusterById,
  setJobStatus,
} from "./mapping.ts";
import type { GBrainSyncResult } from "./types.ts";

export type SyncResult = GBrainSyncResult;

function contentPath(): string {
  const value = process.env.QUARTZ_CONTENT_PATH;
  if (!value) throw new Error("QUARTZ_CONTENT_PATH not configured");
  return value;
}

function positiveBoundedInteger(value: unknown, fallback: number, maximum: number): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0
    ? Math.min(numeric, maximum)
    : fallback;
}

function queuedIdentity(row: Record<string, unknown>): {
  id: number;
  clusterId: number;
} | null {
  const id = Number(row.id);
  const clusterId = Number(row.cluster_id);
  return Number.isSafeInteger(id) && id > 0 &&
    Number.isSafeInteger(clusterId) && clusterId > 0
    ? { id, clusterId }
    : null;
}

async function submitQueuedSync(
  queueJobId: number,
  clusterId: number,
  signal?: AbortSignal,
  wait = false,
): Promise<GBrainSyncResult | null> {
  const cluster = loadClusterById(clusterId);
  if (!cluster) {
    setJobStatus(queueJobId, "failed", "garden_not_found");
    return null;
  }
  const input = {
    userId: cluster.user_id,
    gardenId: cluster.slug,
    clusterId: cluster.id,
    queueJobId,
    signal,
  };
  if (wait) return runGBrainSyncViaRuntime(input);
  await startGBrainSyncRuntimeJob(input);
  return null;
}

/** Run one user-requested refresh through a disposable Runtime V2 worker. */
export async function syncGarden(
  clusterId: number,
  signal?: AbortSignal,
): Promise<GBrainSyncResult> {
  const cluster = loadClusterById(clusterId);
  if (!cluster) throw new Error("Garden not found");
  const mapping = getOrCreateSourceMapping(cluster.id, cluster.slug);
  if (resolveGBrainConfig().mode === "disabled") {
    return {
      clusterId,
      sourceId: mapping.sourceId,
      status: "skipped",
      pagesIndexed: 0,
      chunksIndexed: 0,
      mode: "disabled",
    };
  }
  return runGBrainSyncViaRuntime({
    userId: cluster.user_id,
    gardenId: cluster.slug,
    clusterId: cluster.id,
    queueJobId: null,
    signal,
  });
}

/**
 * Enqueue an incremental refresh and immediately hand the durable row to the
 * Runtime. Duplicate queue rows reuse the same Runtime idempotency key.
 */
export function enqueueGardenSync(clusterId: number, reason: string): number | null {
  const cluster = loadClusterById(clusterId);
  if (!cluster) return null;
  const mapping = getOrCreateSourceMapping(cluster.id, cluster.slug);
  const queueJobId = enqueueSyncJob(mapping.sourceId, cluster.id, reason);
  if (queueJobId !== null && resolveGBrainConfig().mode !== "disabled") {
    void submitQueuedSync(queueJobId, cluster.id).catch(() => {
      // The durable row remains queued. A later canonical write, startup kick,
      // or explicit drain resubmits the same idempotency key.
    });
  }
  return queueJobId;
}

/**
 * Bounded one-shot recovery kick. This replaces the old recurring Next.js timer:
 * it submits durable rows and returns without retaining a timer or index state.
 */
export async function kickQueuedGBrainSyncJobs(max = 10): Promise<number> {
  if (resolveGBrainConfig().mode === "disabled") return 0;
  const rows = listSyncJobs("queued").slice(0, positiveBoundedInteger(max, 10, 50));
  let submitted = 0;
  for (const row of rows) {
    const identity = queuedIdentity(row);
    if (!identity) continue;
    try {
      await submitQueuedSync(identity.id, identity.clusterId);
      submitted += 1;
    } catch {
      // Keep the row queued. Runtime recovery or the next bounded kick retries.
    }
  }
  return submitted;
}

/** Await a bounded set of queued Runtime jobs for the existing drain API. */
export async function drainSyncJobs(
  max = 10,
  signal?: AbortSignal,
): Promise<GBrainSyncResult[]> {
  if (resolveGBrainConfig().mode === "disabled") return [];
  const rows = listSyncJobs("queued").slice(0, positiveBoundedInteger(max, 10, 50));
  const results: GBrainSyncResult[] = [];
  for (const row of rows) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const identity = queuedIdentity(row);
    if (!identity) continue;
    const result = await submitQueuedSync(identity.id, identity.clusterId, signal, true);
    if (result) results.push(result);
  }
  return results;
}

// Re-export path for tests/tools that need to build a content root.
export const gbrainContentRoot = (slug: string) => path.join(contentPath(), slug);
