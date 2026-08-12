import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  MAX_VIDEO_ATTACHMENT_BYTES,
  VIDEO_FILENAME_HEADER,
  videoAttachmentFormat,
} from "@/lib/video-attachments.ts";
import { VideoBlobError, writeVideoBlob } from "@/lib/conversations/video-blob-store.ts";
import { sweepUnreferencedVideoBlobs } from "@/lib/conversations/video-uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST: store an attached video and return the pointer the message carries.
 *
 * Documents go through /api/extract-text, which reads their words and discards
 * the file. A video has no words to read here: what it says is in an audio track
 * and what it shows is in its pictures, and getting at either means ffmpeg,
 * Whisper and frame sampling — the Watch skill's job, done server-side during
 * the turn. So this route only has to keep the bytes safely and say where.
 *
 * The file arrives as the raw request body rather than a form part, because
 * `request.formData()` would parse a multi-gigabyte upload into memory. The
 * filename rides in a header instead, and the extension it claims decides the
 * format — a name that is not a supported container is refused before a byte
 * is written.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    let filename = "";
    try {
      filename = decodeURIComponent(request.headers.get(VIDEO_FILENAME_HEADER) ?? "").trim();
    } catch {
      filename = "";
    }
    if (!filename) {
      throw new ApiError(400, "video_filename_required", "The video arrived without a filename.");
    }
    const format = videoAttachmentFormat(filename);
    if (!format) {
      throw new ApiError(
        415,
        "unsupported_video_format",
        `Breadboard cannot read "${filename}" as a video.`,
      );
    }

    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_VIDEO_ATTACHMENT_BYTES) {
      throw new ApiError(413, "video_too_large", "That video is larger than 2 GB.");
    }
    if (!request.body) {
      throw new ApiError(400, "video_body_required", "No video was received.");
    }

    const stored = await writeVideoBlob({ userId, format, body: request.body });

    try {
      sweepUnreferencedVideoBlobs(userId);
    } catch {
      // Housekeeping must never fail an upload the user is waiting on.
    }

    return NextResponse.json({
      blobId: stored.blobId,
      format: stored.format,
      sizeBytes: stored.byteSize,
    });
  } catch (error) {
    if (error instanceof VideoBlobError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
