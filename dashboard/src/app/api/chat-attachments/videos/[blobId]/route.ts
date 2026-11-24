import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { isPlayableVideoFormat, isVideoBlobId, videoFormatMimeType } from "@/lib/video-attachments.ts";
import { findVideoBlob } from "@/lib/conversations/video-blob-store.ts";
import { ensurePlaybackCopy, VideoPlaybackError } from "@/lib/conversations/video-playback.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `bytes=start-end`, with either end optional, clamped to the file. */
function requestedRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

/**
 * GET: the bytes of one attached video, for the player in the transcript.
 *
 * Authorized by the path the blob lives at — the uploader's id is a directory
 * level in the store, so a video somebody else uploaded reads as missing. Range
 * requests are honoured because a <video> element issues them to seek, and a
 * two-gigabyte file answered whole for every scrub is not a player.
 *
 * `?playback=mp4` asks for a copy the browser can decode. For MP4, MOV and the
 * other native formats that is the file itself; for Matroska, AVI, MPEG and
 * WMV it is an MP4 converted on first request and cached beside the store.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    if (!isVideoBlobId(blobId)) {
      throw new ApiError(404, "video_not_found", "That video was not found.");
    }

    const blob = findVideoBlob({ userId, blobId });
    if (!blob) throw new ApiError(404, "video_not_found", "That video was not found.");

    const wantsPlayback =
      new URL(request.url).searchParams.get("playback") === "mp4" &&
      !isPlayableVideoFormat(blob.format);
    let served = { path: blob.path, byteSize: blob.byteSize, extension: blob.format as string, mimeType: videoFormatMimeType(blob.format) };
    if (wantsPlayback) {
      try {
        const copy = await ensurePlaybackCopy(userId, blob);
        served = { path: copy, byteSize: fs.statSync(copy).size, extension: "mp4", mimeType: "video/mp4" };
      } catch (error) {
        if (error instanceof VideoPlaybackError) throw new ApiError(error.status, error.code, error.message);
        throw error;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": served.mimeType,
      "Accept-Ranges": "bytes",
      // Immutable: a blob id names one file and is never rewritten.
      "Cache-Control": "private, max-age=3600, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${blobId}.${served.extension}"`,
    };

    const range = requestedRange(request.headers.get("range"), served.byteSize);
    const stream = fs.createReadStream(served.path, range ?? undefined);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return range
      ? new Response(body, {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${range.start}-${range.end}/${served.byteSize}`,
            "Content-Length": String(range.end - range.start + 1),
          },
        })
      : new Response(body, {
          headers: { ...headers, "Content-Length": String(served.byteSize) },
        });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
