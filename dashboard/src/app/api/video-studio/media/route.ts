import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError } from "@/lib/hermes/route-helpers.ts";
import { ArtifactStoreError, artifactFile } from "@/lib/hermes/artifact-store.ts";
import { findVideoBlob } from "@/lib/conversations/video-blob-store.ts";
import { ownedMediaArtifact } from "@/lib/timeline-studio/tools.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BLOB_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", m4v: "video/mp4" };

/** The bytes of one of the user's own media, for the page to hand to the editor. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    let file: { path: string; mimeType: string; filename: string };
    const artifactId = params.get("artifact"), blobId = params.get("blob");
    if (artifactId) {
      const artifact = ownedMediaArtifact(userId, artifactId);
      const version = Number(params.get("version")) || artifact.current_version;
      file = artifactFile({ artifact, version, purpose: "download" });
    } else if (blobId) {
      const blob = findVideoBlob({ userId, blobId });
      if (!blob) throw new ApiError(404, "video_studio_blob_missing", "That chat video was not found.");
      file = { path: blob.path, mimeType: BLOB_TYPES[blob.format] ?? "application/octet-stream", filename: `${blob.blobId}.${blob.format}` };
    } else throw new ApiError(400, "video_studio_media_argument", "Name an artifact or a chat video.");
    const stream = Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream<Uint8Array>;
    return new Response(stream, { headers: {
      "Content-Type": file.mimeType, "Content-Length": String(fs.statSync(file.path).size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`, "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not read that media." }, { status: 500 });
  }
}
