// Worker-only GBrain synchronization implementation.
//
// Full garden scans and indexing payloads live here so the Next.js compatibility
// process never retains them. The only production caller is the sealed,
// disposable Runtime V2 GBrain sync worker.

import db from "../db.ts";
import { resolveGBrainConfig } from "./config.ts";
import { GBrainClient } from "./client.ts";
import {
  getOrCreateSourceMapping,
  loadClusterById,
  setSyncState,
} from "./mapping.ts";
import type { GBrainSyncResult } from "./types.ts";

interface RuntimeSyncInput {
  clusterId: number;
  userId: number;
  gardenId: string;
  queueJobId: number | null;
  runtimeJobId: string;
  signal: AbortSignal;
}

interface QueueRow {
  id: number;
  source_id: string;
  cluster_id: number;
  status: string;
}

function contentPath(): string {
  const value = process.env.QUARTZ_CONTENT_PATH;
  if (!value) throw new Error("QUARTZ_CONTENT_PATH not configured");
  return value;
}

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("GBrain indexing was cancelled", "AbortError");
  }
}

function boundedQueueError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "sync_failed";
  const message = rawMessage.replace(/\p{Cc}+/gu, " ").trim() || "sync_failed";
  const bytes = Buffer.from(message, "utf8");
  return (bytes.byteLength <= 300 ? bytes : bytes.subarray(0, 300))
    .toString("utf8")
    .replace(/\uFFFD+$/u, "") || "sync_failed";
}

function claimQueueRecord(
  queueJobId: number,
  clusterId: number,
  sourceId: string,
  runtimeJobId: string,
): void {
  const row = db
    .prepare("SELECT id, source_id, cluster_id, status FROM gbrain_sync_jobs WHERE id = ?")
    .get(queueJobId) as QueueRow | undefined;
  if (
    !row ||
    row.cluster_id !== clusterId ||
    row.source_id !== sourceId ||
    !["queued", "running", "done", "failed"].includes(row.status)
  ) {
    throw new Error("The durable GBrain queue record is outside this worker's authority.");
  }
  db.prepare(
    `UPDATE gbrain_sync_jobs
       SET status = 'running', claimed_at = datetime('now'), claimed_by = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(runtimeJobId, queueJobId);
}

function finishQueueRecord(
  queueJobId: number,
  status: "done" | "failed" | "queued",
  error: string | null,
): void {
  db.prepare(
    `UPDATE gbrain_sync_jobs
       SET status = ?,
           attempts = CASE WHEN ? = 'failed' THEN attempts + 1 ELSE attempts END,
           last_error = ?,
           claimed_at = NULL,
           claimed_by = NULL,
           updated_at = datetime('now')
     WHERE id = ?`,
  ).run(status, status, error, queueJobId);
}

async function indexGarden(
  input: RuntimeSyncInput,
  sourceId: string,
): Promise<GBrainSyncResult> {
  const config = resolveGBrainConfig();
  if (config.mode === "disabled") {
    return {
      clusterId: input.clusterId,
      sourceId,
      status: "skipped",
      pagesIndexed: 0,
      chunksIndexed: 0,
      mode: "disabled",
    };
  }

  setSyncState({ sourceId, status: "syncing" });
  abortIfRequested(input.signal);

  // The knowledge graph can be large. It is intentionally materialized only
  // inside this disposable worker and is released when the worker tree exits.
  const { scanClusterKnowledge } = await import("../knowledge.ts");
  const knowledge = scanClusterKnowledge(contentPath(), input.gardenId);
  abortIfRequested(input.signal);
  const pages = knowledge.nodes
    .filter((node) => (node.content ?? "").trim().length > 0)
    .map((node) => ({
      pageId: node.slug,
      title: node.title || node.slug,
      path: node.relPath || node.slug,
      content: node.content,
      links: (node.related ?? []).filter((related) => typeof related === "string"),
    }));

  try {
    const result = await new GBrainClient(config).registerSource(
      sourceId,
      input.gardenId,
      pages,
      input.signal,
    );
    abortIfRequested(input.signal);
    setSyncState({
      sourceId,
      status: "synced",
      revision: result.revision,
      pagesIndexed: result.pagesIndexed,
      chunksIndexed: result.chunksIndexed,
      mode: result.mode,
      error: null,
    });
    return {
      clusterId: input.clusterId,
      sourceId,
      status: "synced",
      pagesIndexed: result.pagesIndexed,
      chunksIndexed: result.chunksIndexed,
      mode: result.mode,
      revision: result.revision,
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason ?? error;
    const message = boundedQueueError(error);
    setSyncState({ sourceId, status: "stale", error: message });
    return {
      clusterId: input.clusterId,
      sourceId,
      status: "stale",
      pagesIndexed: 0,
      chunksIndexed: 0,
      mode: "unknown",
      error: message,
    };
  }
}

/** Execute one authority-fenced garden refresh inside a disposable worker. */
export async function syncGardenInRuntimeWorker(
  input: RuntimeSyncInput,
): Promise<GBrainSyncResult> {
  const cluster = loadClusterById(input.clusterId);
  if (
    !cluster ||
    cluster.user_id !== input.userId ||
    cluster.slug !== input.gardenId
  ) {
    throw new Error("The GBrain worker is not authorized for this garden.");
  }
  const mapping = getOrCreateSourceMapping(cluster.id, cluster.slug);
  if (input.queueJobId !== null) {
    claimQueueRecord(
      input.queueJobId,
      input.clusterId,
      mapping.sourceId,
      input.runtimeJobId,
    );
  }
  try {
    const result = await indexGarden(input, mapping.sourceId);
    if (input.queueJobId !== null) {
      finishQueueRecord(
        input.queueJobId,
        result.status === "stale" ? "failed" : "done",
        result.error ?? null,
      );
    }
    return result;
  } catch (error) {
    if (input.queueJobId !== null) {
      finishQueueRecord(
        input.queueJobId,
        input.signal.aborted ? "queued" : "failed",
        boundedQueueError(error),
      );
    }
    throw error;
  }
}
