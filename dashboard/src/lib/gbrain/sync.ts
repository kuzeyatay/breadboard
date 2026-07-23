// GBrain synchronization: canonical garden markdown -> durable adapter index.
//
// This is the ONLY path that writes to the GBrain index, and it is always driven
// from canonical Breadboard markdown — never the other way around. A failed index
// never rolls back canonical content; it marks the source stale and leaves an
// audit trail. Concurrency is single-writer per source (enforced by the job
// queue in mapping.ts).

import path from "node:path";
import { resolveGBrainConfig } from "./config.ts";
import { GBrainClient } from "./client.ts";
import {
  getOrCreateSourceMapping,
  loadClusterById,
  setSyncState,
  enqueueSyncJob,
  setJobStatus,
  listSyncJobs,
} from "./mapping.ts";

export interface SyncResult {
  clusterId: number;
  sourceId: string;
  status: "synced" | "stale" | "skipped";
  pagesIndexed: number;
  chunksIndexed: number;
  mode: string;
  revision?: string;
  error?: string;
}

function contentPath(): string {
  const value = process.env.QUARTZ_CONTENT_PATH;
  if (!value) throw new Error("QUARTZ_CONTENT_PATH not configured");
  return value;
}

/** Read canonical markdown for one garden and (re)index it in the adapter. */
export async function syncGarden(clusterId: number): Promise<SyncResult> {
  const config = resolveGBrainConfig();
  const cluster = loadClusterById(clusterId);
  if (!cluster) throw new Error("Garden not found");
  const mapping = getOrCreateSourceMapping(cluster.id, cluster.slug);

  if (config.mode === "disabled") {
    return { clusterId, sourceId: mapping.sourceId, status: "skipped", pagesIndexed: 0, chunksIndexed: 0, mode: "disabled" };
  }

  setSyncState({ sourceId: mapping.sourceId, status: "syncing" });

  // Lazy import so the scope/enforcement paths never pay for the knowledge/quartz
  // dependency chain.
  const { scanClusterKnowledge } = await import("../knowledge.ts");
  const knowledge = scanClusterKnowledge(contentPath(), cluster.slug);

  const pages = knowledge.nodes
    .filter((node) => (node.content ?? "").trim().length > 0)
    .map((node) => ({
      pageId: node.slug,
      title: node.title || node.slug,
      path: node.relPath || node.slug,
      content: node.content,
      links: (node.related ?? []).filter((r) => typeof r === "string"),
    }));

  try {
    const client = new GBrainClient(config);
    const result = await client.registerSource(
      mapping.sourceId,
      `${cluster.slug}`,
      pages,
    );
    setSyncState({
      sourceId: mapping.sourceId,
      status: "synced",
      revision: result.revision,
      pagesIndexed: result.pagesIndexed,
      chunksIndexed: result.chunksIndexed,
      mode: result.mode,
      error: null,
    });
    return {
      clusterId,
      sourceId: mapping.sourceId,
      status: "synced",
      pagesIndexed: result.pagesIndexed,
      chunksIndexed: result.chunksIndexed,
      mode: result.mode,
      revision: result.revision,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    // The canonical markdown is untouched; mark the source stale for retry.
    setSyncState({ sourceId: mapping.sourceId, status: "stale", error: message });
    return {
      clusterId,
      sourceId: mapping.sourceId,
      status: "stale",
      pagesIndexed: 0,
      chunksIndexed: 0,
      mode: "unknown",
      error: message,
    };
  }
}

/** Enqueue an incremental sync after a canonical garden write (proposal applied,
 *  note created/edited, ingestion completed). Single-writer: a job is not
 *  duplicated while one is already queued/running for the source. */
export function enqueueGardenSync(clusterId: number, reason: string): number | null {
  const cluster = loadClusterById(clusterId);
  if (!cluster) return null;
  const mapping = getOrCreateSourceMapping(cluster.id, cluster.slug);
  return enqueueSyncJob(mapping.sourceId, cluster.id, reason);
}

/** Drain queued sync jobs. Safe to call from a route or a background tick. */
export async function drainSyncJobs(max = 10): Promise<SyncResult[]> {
  const jobs = listSyncJobs("queued").slice(0, max);
  const results: SyncResult[] = [];
  for (const job of jobs) {
    const id = Number(job.id);
    setJobStatus(id, "running");
    try {
      const result = await syncGarden(Number(job.cluster_id));
      setJobStatus(id, result.status === "synced" ? "done" : "failed", result.error ?? null);
      results.push(result);
    } catch (err) {
      setJobStatus(id, "failed", err instanceof Error ? err.message : "sync_failed");
    }
  }
  return results;
}

// re-export path for tests/tools that need to build a content root
export const gbrainContentRoot = (slug: string) => path.join(contentPath(), slug);
