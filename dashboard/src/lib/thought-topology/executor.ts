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
}): Promise<ThoughtTopologyBuildResult> {
  const row = db.prepare(
    "SELECT id, cluster_id, revision, status FROM thought_topology_jobs WHERE id = ?",
  ).get(input.queueJobId) as QueueRow | undefined;
  if (!row || row.cluster_id !== input.clusterId || row.revision !== input.revision || !["queued", "running"].includes(row.status)) {
    throw new Error("Thought Topology queue authority is invalid.");
  }
  db.prepare(
    `UPDATE thought_topology_jobs
        SET status = 'running', runtime_job_id = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(input.runtimeJobId, input.queueJobId);
  try {
    const contentRoot = process.env.QUARTZ_CONTENT_PATH;
    if (!contentRoot) throw new Error("QUARTZ_CONTENT_PATH not configured");
    const result = await buildThoughtTopologyInRuntimeWorker({
      clusterId: input.clusterId,
      userId: input.userId,
      gardenId: input.gardenId,
      revision: input.revision,
      contentRoot,
      signal: input.signal,
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
