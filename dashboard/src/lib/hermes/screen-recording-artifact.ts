import db from "../db.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { createImportedArtifact, getArtifactById, presentArtifact } from "./artifact-store.ts";
import { runtimeExternalSessionId, type RuntimeSessionRow } from "./runtime-store.ts";
import { getRuntimeRun, getActiveRuntimeRun, parseRuntimeRunDispatch } from "./run-store.ts";
import { BreadboardUseError } from "./breadboard-use.ts";

/** The desktop chooses the filename; model arguments never choose a file path. */
export async function attachScreenRecording(data: Record<string, unknown>, session: RuntimeSessionRow, runId: string) {
  if (!data.recording || typeof data.recording !== "object") return data;
  const recording = data.recording as Record<string, unknown>;
  if (recording.state !== "complete") return data;
  const id = recording.id;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) ||
    typeof recording.filename !== "string" || ![`${id}.mp4`, `${id}.webm`].includes(recording.filename)) throw new BreadboardUseError(502, "The desktop returned an invalid recording.");
  const existing = db.prepare(`SELECT id FROM hermes_artifacts WHERE user_id = ? AND conversation_id = ?
    AND originating_run_id = ? AND source_hermes_tool = 'breadboard_use'
    AND json_extract(metadata_json, '$.screenRecordingId') = ? AND status = 'ready' LIMIT 1`)
    .get(session.user_id, session.conversation_id, runId, id) as { id: string } | undefined;
  if (existing) return { ...data, artifact: presentArtifact(getArtifactById(existing.id)!) };
  const run = getRuntimeRun(runId);
  if (!run || getActiveRuntimeRun(session.id)?.id !== runId) throw new BreadboardUseError(409, "This recording's task has finished.");
  const dispatch = parseRuntimeRunDispatch(run);
  const message = dispatch.clientMessageId ? db.prepare(`SELECT id FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`)
    .get(session.conversation_id, dispatch.clientMessageId) as { id: number } | undefined : undefined;
  const root = path.join(dashboardDataDir(), "screen-recordings");
  const artifact = await createImportedArtifact({
    userId: session.user_id!, runtimeSessionId: session.id, hermesSessionId: runtimeExternalSessionId(session)!,
    conversationId: session.conversation_id!, clusterId: session.cluster_id, runId, assistantMessageId: message?.id ?? null,
    surface: session.surface as "dashboard_terminal" | "garden_chat", kind: "video", title: "Screen recording",
    filename: recording.filename, authorizedRoot: root, filePath: path.join(root, recording.filename),
    sourceSkill: "breadboard-use", sourceHermesTool: "breadboard_use", scrubProvenance: false,
    metadata: { screenRecordingId: id, durationSeconds: recording.durationSeconds, sourceId: recording.sourceId },
    beforePublish: () => {
      if (getActiveRuntimeRun(session.id)?.id !== runId) throw new BreadboardUseError(409, "This recording's task has finished.");
    },
  });
  return { ...data, artifact: presentArtifact(artifact) };
}
