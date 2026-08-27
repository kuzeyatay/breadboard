import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { isAudioBlobId, audioFormatMimeType } from "@/lib/audio-attachments.ts";
import { findAudioBlob } from "@/lib/conversations/audio-blob-store.ts";

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
 * GET: the bytes of one attached song, for the player in the transcript.
 *
 * Authorized by the path the blob lives at — the uploader's id is a directory
 * level in the store, so a track somebody else uploaded reads as missing. Range
 * requests are honoured because an <audio> element issues them to seek.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    if (!isAudioBlobId(blobId)) {
      throw new ApiError(404, "audio_not_found", "That audio file was not found.");
    }

    const blob = findAudioBlob({ userId, blobId });
    if (!blob) throw new ApiError(404, "audio_not_found", "That audio file was not found.");

    const headers: Record<string, string> = {
      "Content-Type": audioFormatMimeType(blob.format),
      "Accept-Ranges": "bytes",
      // Immutable: a blob id names one file and is never rewritten.
      "Cache-Control": "private, max-age=3600, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${blobId}.${blob.format}"`,
    };

    const range = requestedRange(request.headers.get("range"), blob.byteSize);
    const stream = fs.createReadStream(blob.path, range ?? undefined);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return range
      ? new Response(body, {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${range.start}-${range.end}/${blob.byteSize}`,
            "Content-Length": String(range.end - range.start + 1),
          },
        })
      : new Response(body, {
          headers: { ...headers, "Content-Length": String(blob.byteSize) },
        });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
