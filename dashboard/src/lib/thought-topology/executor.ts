import db from "../db.ts";
import { buildThoughtTopologyInRuntimeWorker, type ThoughtTopologyBuildResult } from "./builder.ts";

interface QueueRow { id: number; cluster_id: number; revision: number; status: string }

export async function executeThoughtTopologyRuntimeBuild(input: {
  clusterId: number;
  userId: number;
  gardenId: string;
  revision: number;
  queueJobId: number;
  runtimeJobId: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<ThoughtTopologyBuildResult> {
  // Admission can wait behind another document-processing worker. Markdown
  // mutations that happen during that wait advance the same queued row. Claim
  // it and capture its latest revision atomically, then incrementally build
  // that revision instead of reconstructing every intermediate snapshot.
  const row = db.transaction(() => {
    const candidate = db.prepare(
      "SELECT id, cluster_id, revision, status FROM thought_topology_jobs WHERE id = ?",
    ).get(input.queueJobId) as QueueRow | undefined;
    if (
      !candidate ||
      candidate.cluster_id !== input.clusterId ||
      candidate.revision < input.revision ||
      !["queued", "running"].includes(candidate.status)
    ) {
      throw new Error("Thought Topology queue authority is invalid.");
    }
    db.prepare(
      `UPDATE thought_topology_jobs
          SET status = 'running', runtime_job_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(input.runtimeJobId, input.queueJobId);
    return candidate;
  })();
  const effectiveRevision = row.revision;
  try {
    const contentRoot = process.env.QUARTZ_CONTENT_PATH;
    if (!contentRoot) throw new Error("QUARTZ_CONTENT_PATH not configured");
    const result = await buildThoughtTopologyInRuntimeWorker({
      clusterId: input.clusterId,
      userId: input.userId,
      gardenId: input.gardenId,
      revision: effectiveRevision,
      contentRoot,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    db.prepare(
      `UPDATE thought_topology_jobs
          SET status = ?, last_error = NULL, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(result.status === "built" ? "done" : "stale", input.queueJobId);
    return result;
  } catch (error) {
    const message = (error instanceof Error ? error.message : "build_failed").replace(/\p{Cc}+/gu, " ").slice(0, 500);
    db.prepare(
      `UPDATE thought_topology_jobs
          SET status = 'failed', last_error = ?, attempts = attempts + 1, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(message, input.queueJobId);
    throw error;
  }
}
