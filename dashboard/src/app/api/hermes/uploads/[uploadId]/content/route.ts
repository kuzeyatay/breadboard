import { NextResponse } from "next/server";
import db from "@/lib/db";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  dataUrlMimeType,
  messageAttachments,
  parseUploadId,
} from "@/lib/conversations/uploads.ts";
import { readModelBlob } from "@/lib/conversations/model-blob-store.ts";
import { modelFormatMimeType } from "@/lib/model-attachments.ts";

export const dynamic = "force-dynamic";

/**
 * GET: the bytes of one upload, for previewing or downloading it.
 *
 * The id names a message the caller has to own — the ownership check is the
 * join, not the id, so a guessed id from someone else's chat reads as missing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { uploadId } = await params;
    const parsed = parseUploadId(uploadId);
    if (!parsed) throw new ApiError(404, "upload_not_found", "Upload not found.");

    const row = db
      .prepare(
        `SELECT m.metadata AS metadata
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ? AND c.user_id = ?`,
      )
      .get(parsed.messageId, userId) as { metadata: string | null } | undefined;
    if (!row) throw new ApiError(404, "upload_not_found", "Upload not found.");

    const attachment = messageAttachments(row.metadata)[parsed.index];
    if (!attachment || attachment.type === "file") {
      // Documents are extracted at send time and their bytes are not retained.
      throw new ApiError(404, "upload_content_unavailable", "This upload's contents were not kept.");
    }

    // A video is the one upload too large to answer whole: its own route streams
    // it and honours range requests, so this hands the caller over to it rather
    // than buffering gigabytes to say the same thing.
    if (attachment.type === "video") {
      return NextResponse.redirect(
        new URL(`/api/chat-attachments/videos/${attachment.blobId}`, request.url),
        307,
      );
    }
    // A song is handed over for the same two reasons: a lossless album track is
    // hundreds of megabytes, and an <audio> element seeks with range requests
    // that only the streaming route answers.
    if (attachment.type === "audio") {
      return NextResponse.redirect(
        new URL(`/api/chat-attachments/audio/${attachment.blobId}`, request.url),
        307,
      );
    }

    // A 3D model's bytes live on disk; an image's travel inside the message.
    // Kernel-backed formats (STEP, IGES, BREP) keep a derived mesh beside the
    // original. The Uploads viewer asks for that mesh while Download continues
    // to return exactly what the user attached.
    const previewRequested = new URL(request.url).searchParams.get("preview") === "1";
    const viewedModel =
      attachment.type === "model" && previewRequested && attachment.previewBlobId
        ? {
            blobId: attachment.previewBlobId,
            format: attachment.previewFormat ?? attachment.format,
          }
        : attachment.type === "model"
          ? { blobId: attachment.blobId, format: attachment.format }
          : null;
    let bytes: Buffer;
    let contentType: string;
    if (viewedModel) {
      bytes = readModelBlob(viewedModel);
      contentType = modelFormatMimeType(viewedModel.format);
    } else if (attachment.type === "image") {
      bytes = Buffer.from(
        attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1),
        "base64",
      );
      contentType = dataUrlMimeType(attachment.dataUrl);
    } else {
      throw new ApiError(404, "upload_content_unavailable", "This upload cannot be previewed.");
    }
    const download = new URL(request.url).searchParams.get("download") === "1";
    const asciiName = attachment.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
