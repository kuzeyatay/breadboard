import path from "node:path";
import { createHash } from "node:crypto";
import db from "../db.ts";
import { createImportedArtifact, type ArtifactRow } from "../hermes/artifact-store.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { inspectOuterAgentRun, readOuterAgentRunView } from "../runtime-v2/outer-agent-run.ts";
import { resolveHyperframesArtifactPath } from "./runtime-run-manager.ts";

interface Owner {
  id: number;
  conversation_id: number;
  public_id: string;
  title: string;
  surface: "dashboard_terminal" | "garden_chat";
  default_garden_id: number | null;
  runtime_session_id: number;
  external_session_id: string | null;
  hermes_session_id: string | null;
  published_artifact_id: string | null;
}

type PublishOptions = {
  database?: typeof db;
  dataRoot?: string;
  storageRoot?: string;
  readView?: typeof readOuterAgentRunView;
  inspectRun?: typeof inspectOuterAgentRun;
};
const pending = new WeakMap<typeof db, Map<string, Promise<ArtifactRow | null>>>();

/** Import only the verified primary render, using the durable chat/run ownership. */
export async function publishHyperframesVideo(userId: number, runId: string, options: PublishOptions = {}): Promise<ArtifactRow | null> {
  const database = options.database ?? db;
  let requests = pending.get(database);
  if (!requests) pending.set(database, requests = new Map());
  const key = `${userId}:${runId}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const publication = publish(userId, runId, { ...options, database });
  requests.set(key, publication);
  try { return await publication; } finally { requests.delete(key); }
}

async function publish(userId: number, runId: string, options: PublishOptions & { database: typeof db }): Promise<ArtifactRow | null> {
  const { database } = options;
  // The caller cannot bind someone else's run or pick an arbitrary local file.
  const owner = database.prepare(`
    SELECT m.id, m.conversation_id, c.public_id, c.title, c.surface, c.default_garden_id,
      s.id AS runtime_session_id, s.external_session_id, s.hermes_session_id,
      json_extract(m.metadata, '$.hyperframesArtifactId') AS published_artifact_id
    FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
    JOIN hermes_runtime_sessions s ON s.conversation_id = c.id
    WHERE c.user_id = ? AND s.user_id = ? AND m.role = 'assistant'
      AND c.surface IN ('dashboard_terminal', 'garden_chat')
      AND json_extract(m.metadata, '$.externalAgentRun.kind') = 'hyperframes'
      AND json_extract(m.metadata, '$.externalAgentRun.runId') = ?
    ORDER BY m.id DESC LIMIT 1
  `).get(userId, userId, runId) as Owner | undefined;
  if (!owner) return null;
  const saved = database.prepare(`SELECT * FROM hermes_artifacts WHERE user_id = ?
    AND conversation_id = ? AND source_hermes_tool = 'hyperframes'
    AND json_extract(metadata_json, '$.hyperframesRunId') = ? LIMIT 1
  `).get(userId, owner.conversation_id, runId) as ArtifactRow | undefined;
  if (saved) {
    if (!owner.published_artifact_id) database.prepare("UPDATE conversation_messages SET metadata = json_set(metadata, '$.hyperframesArtifactId', ?) WHERE id = ?")
      .run(saved.id, owner.id);
    return { ...saved, conversation_public_id: owner.public_id };
  }
  // Deleting an artifact is intentional; a replay must not recreate it.
  if (owner.published_artifact_id) return null;
  const view = await (options.readView ?? readOuterAgentRunView)("hyperframes", userId, runId, 0);
  if (view.status !== "completed") return null;
  const job = await (options.inspectRun ?? inspectOuterAgentRun)("hyperframes", userId, runId);
  const video = resolveHyperframesArtifactPath({
    dataRoot: options.dataRoot ?? (process.env.BREADBOARD_DATA_DIR?.trim() ? dashboardDataDir() : repositoryRoot()),
    job, events: view.events, artifactId: Buffer.from("out/video.mp4").toString("base64url"),
  });
  if (!video || video.record.size <= 0) throw new Error("The completed HyperFrames video could not be verified for artifact delivery.");
  const artifactRunId = `hyperframes-artifact-${createHash("sha256").update(keyForRun(userId, runId)).digest("hex").slice(0, 32)}`;
  // Artifact provenance needs a durable run receipt, without opening an active
  // Hermes turn or occupying the chat's model slot during delivery.
  database.prepare(`INSERT INTO hermes_runs
    (id, runtime_session_id, instruction, status, dispatch_json, started_at, finished_at)
    VALUES (?, ?, ?, 'completed', ?, datetime('now'), datetime('now')) ON CONFLICT(id) DO NOTHING
  `).run(artifactRunId, owner.runtime_session_id, "Deliver the completed HyperFrames video", JSON.stringify({ hyperframesRunId: runId }));
  const artifact = await createImportedArtifact({
    userId, runtimeSessionId: owner.runtime_session_id,
    hermesSessionId: owner.external_session_id ?? owner.hermes_session_id ?? `hyperframes:${runId}`,
    conversationId: owner.conversation_id, clusterId: owner.surface === "garden_chat" ? owner.default_garden_id : null,
    runId: artifactRunId, assistantMessageId: owner.id, surface: owner.surface,
    kind: "video", title: owner.title?.trim() || "HyperFrames video", filename: "video.mp4",
    authorizedRoot: path.dirname(video.canonicalPath), filePath: video.canonicalPath,
    sourceHermesTool: "hyperframes", metadata: { hyperframes: true, hyperframesRunId: runId },
    // Preserve the exact render whose streams and decode the worker verified.
    scrubProvenance: false, database, storageRoot: options.storageRoot,
  });
  database.prepare("UPDATE conversation_messages SET metadata = json_set(metadata, '$.hyperframesArtifactId', ?) WHERE id = ?")
    .run(artifact.id, owner.id);
  return { ...artifact, conversation_public_id: owner.public_id };
}

function keyForRun(userId: number, runId: string): string { return `${userId}:${runId}`; }

/** Reopening an older chat repairs missing imports without rerunning the worker. */
export async function recoverHyperframesArtifacts(userId: number, conversationId: number): Promise<void> {
  const rows = db.prepare(`SELECT DISTINCT json_extract(m.metadata, '$.externalAgentRun.runId') AS runId
    FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.id = ? AND c.user_id = ? AND m.role = 'assistant'
      AND json_extract(m.metadata, '$.externalAgentRun.kind') = 'hyperframes'
      AND json_extract(m.metadata, '$.externalAgentOutcome') = 'completed'
      AND json_extract(m.metadata, '$.hyperframesArtifactId') IS NULL
      AND NOT EXISTS (SELECT 1 FROM hermes_artifacts a WHERE a.conversation_id = c.id
        AND a.source_hermes_tool = 'hyperframes'
        AND json_extract(a.metadata_json, '$.hyperframesRunId') = json_extract(m.metadata, '$.externalAgentRun.runId'))
    LIMIT 50
  `).all(conversationId, userId) as { runId: string }[];
  for (const row of rows) {
    try { await publishHyperframesVideo(userId, row.runId); }
    catch (error) { console.warn(`[hyperframes] Could not recover artifact for ${row.runId}:`, error); }
  }
}

export function hyperframesDeliveryContent(artifact: Pick<ArtifactRow, "id" | "conversation_public_id">, runId: string): string {
  return `Your video is ready and saved as a playable artifact.\n\n[Download video](/api/hermes/artifacts/${encodeURIComponent(artifact.id)}/download?conversationId=${encodeURIComponent(artifact.conversation_public_id ?? "")}) · [Composition source](/api/hyperframes/runs/${encodeURIComponent(runId)}/artifacts/${Buffer.from("index.html").toString("base64url")}?download=1)`;
}
