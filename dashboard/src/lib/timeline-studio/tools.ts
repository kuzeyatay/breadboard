import "server-only";

import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import db from "../db.ts";
import {
  ArtifactStoreError, createImportedArtifact, getArtifactById, importArtifactVersion, presentArtifact, type ArtifactRow,
} from "../hermes/artifact-store.ts";
import { runtimeExternalSessionId, type RuntimeSessionRow } from "../hermes/runtime-store.ts";
import { getRuntimeRun, parseRuntimeRunDispatch } from "../hermes/run-store.ts";
import { findVideoBlob } from "../conversations/video-blob-store.ts";
import { callStudio, studioTools, VideoStudioBridgeError, withoutMediaBytes } from "./bridge.ts";
import { studioPresence } from "./context.ts";
import { studioDataDir } from "./server.ts";

const MEDIA_KINDS = new Set(["video", "image", "audio"]);
const EXPORT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };

/** An artifact this user owns, in any of their chats, that the editor can take in. */
export function ownedMediaArtifact(userId: number, artifactId: string): ArtifactRow {
  const artifact = getArtifactById(artifactId);
  if (!artifact || artifact.user_id !== userId) throw new ArtifactStoreError(404, "artifact_not_found", "Artifact not found.");
  if (!MEDIA_KINDS.has(artifact.kind)) throw new ArtifactStoreError(400, "video_studio_media_required", "Only video, image and audio artifacts open in Video Studio.");
  return artifact;
}

// Exports the editor downloaded, kept so they can become chat artifacts.
interface CapturedExport { id: string; path: string; filename: string; at: number; artifactId?: string }
const exportsByUser: Map<number, CapturedExport[]> = ((globalThis as { __breadboardVideoStudioExports?: Map<number, CapturedExport[]> })
  .__breadboardVideoStudioExports ??= new Map());
const exportStarts: Map<number, number> = ((globalThis as { __breadboardVideoStudioExportStarts?: Map<number, number> })
  .__breadboardVideoStudioExportStarts ??= new Map());

const exportDir = (userId: number) => path.join(studioDataDir(), "exports", `u${userId}`);

export async function storeExport(userId: number, filename: string, body: ReadableStream<Uint8Array>): Promise<CapturedExport> {
  const ext = path.extname(filename).toLowerCase();
  if (!EXPORT_TYPES[ext]) throw new ArtifactStoreError(400, "video_studio_export_type", "Only MP4, WebM and MOV exports are kept.");
  const dir = exportDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const file = path.join(dir, `${id}${ext}`);
  const out = fs.createWriteStream(file);
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(value)) await new Promise<void>(resolve => out.once("drain", () => resolve()));
  }
  await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()));
  const list = exportsByUser.get(userId) ?? [];
  // Keep the newest few on disk; older ones were either saved as artifacts or downloaded.
  for (const stale of list.splice(0, Math.max(0, list.length - 5))) fs.rmSync(stale.path, { force: true });
  const entry = { id, path: file, filename: path.basename(filename).slice(0, 200), at: Date.now() };
  list.push(entry);
  exportsByUser.set(userId, list);
  return entry;
}

export function latestExport(userId: number, since = 0): CapturedExport | null {
  return (exportsByUser.get(userId) ?? []).filter(entry => entry.at >= since).at(-1) ?? null;
}

/** An export becomes a new version of the artifact the studio was opened on. */
export async function saveExportAsVersion(userId: number, exportId: string, artifactId: string): Promise<ArtifactRow> {
  const entry = (exportsByUser.get(userId) ?? []).find(candidate => candidate.id === exportId);
  if (!entry) throw new ArtifactStoreError(404, "video_studio_export_missing", "Export the video first.");
  const artifact = ownedMediaArtifact(userId, artifactId);
  if (artifact.kind !== "video") throw new ArtifactStoreError(400, "video_studio_video_required", "Only a video artifact takes an exported video as a new version.");
  const saved = await importArtifactVersion({
    artifact, authorizedRoot: exportDir(userId), filePath: entry.path, runId: artifact.originating_run_id,
    assistantMessageId: null, metadata: { videoStudioEdited: true, lastEditedBy: "video-studio" }, scrubProvenance: false,
  });
  entry.artifactId = saved.id;
  return saved;
}

async function deliverExport(input: { userId: number; session: RuntimeSessionRow; runId: string; entry: CapturedExport }): Promise<ArtifactRow> {
  if (input.entry.artifactId) {
    const existing = getArtifactById(input.entry.artifactId);
    if (existing) return existing;
  }
  const source = studioPresence(input.userId)?.source;
  if (source) {
    try {
      if (ownedMediaArtifact(input.userId, source.artifactId).kind === "video") return await saveExportAsVersion(input.userId, input.entry.id, source.artifactId);
    } catch { /* the source went away; the export becomes its own video below */ }
  }
  const { session } = input;
  const run = getRuntimeRun(input.runId);
  const clientMessageId = run ? parseRuntimeRunDispatch(run).clientMessageId : null;
  const message = clientMessageId ? db.prepare(`SELECT id FROM conversation_messages
    WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`).get(session.conversation_id, clientMessageId) as { id: number } | undefined : undefined;
  const artifact = await createImportedArtifact({
    userId: input.userId, runtimeSessionId: session.id, hermesSessionId: runtimeExternalSessionId(session)!,
    conversationId: session.conversation_id!, clusterId: session.cluster_id, runId: input.runId, assistantMessageId: message?.id ?? null,
    surface: session.surface as "dashboard_terminal" | "garden_chat", kind: "video",
    // The editor names every export "ai-voiceover" by default, which says nothing about the video.
    title: (source?.title ? `${source.title} (edited)` : "Video Studio edit").slice(0, 240),
    filename: input.entry.filename, authorizedRoot: exportDir(input.userId), filePath: input.entry.path,
    sourceHermesTool: "video_studio", metadata: { videoStudioEdited: true, videoStudioExportId: input.entry.id }, scrubProvenance: false,
  });
  input.entry.artifactId = artifact.id;
  return artifact;
}

const BREADBOARD_TOOLS = [
  {
    name: "breadboard_import_media",
    description: "Put a Breadboard video, image or audio into the editor's My assets (then find it with timeline_assets_inspect). Pass artifactId for any artifact (including ones video_render or another video agent just made), or blobId for a video attached to the chat.",
    inputSchema: { type: "object", properties: { artifactId: { type: "string" }, blobId: { type: "string" } } },
  },
];

/** One mcp_call on the built-in `video-studio` connection. */
export async function callVideoStudioTool(input: {
  userId: number; session: RuntimeSessionRow; runId: string; tool: string; args: Record<string, unknown>; signal?: AbortSignal;
}): Promise<unknown> {
  const { userId, tool, args } = input;
  try {
    if (tool === "__breadboard_list_tools") {
      if (!studioPresence(userId)) throw new VideoStudioBridgeError("video_studio_closed", "Video Studio is not open. Ask the user to open it (the Video shortcut next to Crumbs).");
      return { tools: [...studioTools(userId), ...BREADBOARD_TOOLS] };
    }
    if (tool === "breadboard_import_media") {
      let item: { url: string; filename: string };
      if (typeof args.artifactId === "string") {
        const artifact = ownedMediaArtifact(userId, args.artifactId);
        item = { url: `/api/video-studio/media?artifact=${encodeURIComponent(artifact.id)}`, filename: artifact.filename };
      } else if (typeof args.blobId === "string") {
        const blob = findVideoBlob({ userId, blobId: args.blobId });
        if (!blob) throw new ArtifactStoreError(404, "video_studio_blob_missing", "That chat video was not found.");
        item = { url: `/api/video-studio/media?blob=${encodeURIComponent(blob.blobId)}`, filename: `${blob.blobId}.${blob.format}` };
      } else throw new ArtifactStoreError(400, "video_studio_media_argument", "Pass artifactId or blobId.");
      return await callStudio(userId, "__breadboard_import", { items: [item] }, { signal: input.signal, timeoutMs: 300_000 });
    }
    if (tool === "timeline_export_start") exportStarts.set(userId, Date.now());
    const result = withoutMediaBytes(await callStudio(userId, tool, args, { signal: input.signal, timeoutMs: tool.startsWith("timeline_ai_") ? 300_000 : 120_000 }));
    if (tool === "timeline_export_inspect" && JSON.stringify(result).includes('"succeeded"')) {
      const since = exportStarts.get(userId) ?? 0;
      let entry = latestExport(userId, since);
      // The page uploads the downloaded file a moment after the editor reports success.
      for (let waited = 0; !entry && waited < 60_000; waited += 500) {
        await new Promise(resolve => setTimeout(resolve, 500));
        entry = latestExport(userId, since);
      }
      if (entry) {
        const artifact = await deliverExport({ ...input, entry });
        const note = artifact.current_version > 1
          ? `The export is saved as version ${artifact.current_version} of ${JSON.stringify(artifact.title)}, the video open in Video Studio.`
          : "The export is saved in this chat as a new video artifact.";
        return { result, breadboardArtifact: presentArtifact(artifact), note };
      }
    }
    return result;
  } catch (error) {
    if (error instanceof VideoStudioBridgeError || error instanceof ArtifactStoreError) {
      return { isError: true, error: { code: error.code, message: error.message } };
    }
    throw error;
  }
}
