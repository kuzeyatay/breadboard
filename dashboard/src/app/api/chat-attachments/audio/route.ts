import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  MAX_AUDIO_ATTACHMENT_BYTES,
  AUDIO_FILENAME_HEADER,
  audioAttachmentFormat,
} from "@/lib/audio-attachments.ts";
import { AudioBlobError, writeAudioBlob } from "@/lib/conversations/audio-blob-store.ts";
import { sweepUnreferencedAudioBlobs } from "@/lib/conversations/audio-uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST: store an attached song and return the pointer the message carries.
 *
 * There is nothing to extract on the way in. What is worth knowing about a
 * piece of music is in its waveform, and reading that is the audio analyzer's
 * job, done during the turn against the file this route keeps. So this route
 * only has to keep the bytes safely and say where they are.
 *
 * The file arrives as the raw request body rather than a form part, because
 * `request.formData()` would parse a lossless album track into memory. The
 * filename rides in a header instead, and the extension it claims decides the
 * format — a name that is not a decodable container is refused before a byte is
 * written.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    let filename = "";
    try {
      filename = decodeURIComponent(request.headers.get(AUDIO_FILENAME_HEADER) ?? "").trim();
    } catch {
      filename = "";
    }
    if (!filename) {
      throw new ApiError(400, "audio_filename_required", "The audio arrived without a filename.");
    }
    const format = audioAttachmentFormat(filename);
    if (!format) {
      throw new ApiError(
        415,
        "unsupported_audio_format",
        `Breadboard cannot decode "${filename}" as audio.`,
      );
    }

    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_AUDIO_ATTACHMENT_BYTES) {
      throw new ApiError(413, "audio_too_large", "That audio file is larger than 512 MB.");
    }
    if (!request.body) {
      throw new ApiError(400, "audio_body_required", "No audio was received.");
    }

    const stored = await writeAudioBlob({ userId, format, body: request.body });

    try {
      sweepUnreferencedAudioBlobs(userId);
    } catch {
      // Housekeeping must never fail an upload the user is waiting on.
    }

    return NextResponse.json({
      blobId: stored.blobId,
      format: stored.format,
      sizeBytes: stored.byteSize,
    });
  } catch (error) {
    if (error instanceof AudioBlobError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
