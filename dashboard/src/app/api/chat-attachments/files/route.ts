import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  MAX_STORED_FILE_ATTACHMENT_BYTES,
  STORED_FILE_FILENAME_HEADER,
  storedFileAttachmentFormat,
} from "@/lib/stored-file-attachments.ts";
import {
  StoredFileBlobError,
  removeStoredFileBlob,
  writeStoredFileBlob,
} from "@/lib/conversations/stored-file-blob-store.ts";
import { sweepUnreferencedStoredFileBlobs } from "@/lib/conversations/stored-file-uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    let filename = "";
    try {
      filename = decodeURIComponent(request.headers.get(STORED_FILE_FILENAME_HEADER) ?? "").trim();
    } catch {
      filename = "";
    }
    if (!filename) {
      throw new ApiError(400, "file_filename_required", "The upload arrived without a filename.");
    }
    const format = storedFileAttachmentFormat(filename);
    if (!format) {
      throw new ApiError(415, "unsupported_file_format", `Breadboard cannot keep "${filename}" as a chat file.`);
    }
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_STORED_FILE_ATTACHMENT_BYTES) {
      throw new ApiError(413, "file_too_large", "That file is larger than 128 MiB.");
    }
    if (!request.body) throw new ApiError(400, "file_body_required", "No file was received.");
    const stored = await writeStoredFileBlob({ userId, format, body: request.body });
    sweepUnreferencedStoredFileBlobs(userId);
    return NextResponse.json({
      blobId: stored.blobId,
      format: stored.format,
      sizeBytes: stored.byteSize,
    });
  } catch (error) {
    if (error instanceof StoredFileBlobError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const blobId = new URL(request.url).searchParams.get("blobId") ?? "";
    return NextResponse.json({ removed: removeStoredFileBlob({ userId, blobId }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
