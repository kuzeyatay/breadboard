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
  findStoredFileBlob,
  removeStoredFileBlob,
  writeStoredFileBlob,
} from "@/lib/conversations/stored-file-blob-store.ts";
import { sweepUnreferencedStoredFileBlobs } from "@/lib/conversations/stored-file-uploads.ts";
import { isMarkedWebBlob, markWebPdfBlob, touchWebPdfBlob } from "@/lib/conversations/document-blob-store.ts";
import { STORE_ONLY_HEADER, sweepOpenedFiles } from "@/lib/conversations/opened-files.ts";
import { openedImageMimeType } from "@/lib/local-document.ts";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";

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
    // A file of a kind the registry does not name is kept whole as `bin`
    // under its original name. Without this a MATLAB script or a lab notebook
    // reached the model as inline text and the transcript kept only its name,
    // so a regenerated turn had nothing to resend.
    const format = storedFileAttachmentFormat(filename) ?? "bin";
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_STORED_FILE_ATTACHMENT_BYTES) {
      throw new ApiError(413, "file_too_large", "That file is larger than 128 MiB.");
    }
    if (!request.body) throw new ApiError(400, "file_body_required", "No file was received.");
    const stored = await writeStoredFileBlob({ userId, format, body: request.body });
    sweepUnreferencedStoredFileBlobs(userId);
    // An image opened from a new tab: kept for its viewer under the Settings cleanup switch.
    if (request.headers.get(STORE_ONLY_HEADER) === "true") {
      markWebPdfBlob(stored);
      sweepOpenedFiles(userId);
    }
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

/**
 * GET ?blobId=&name=: an image opened from a new tab. Only marked (opened)
 * blobs are served, and only as one of the raster image types its name claims,
 * so a stored chat file can never be replayed here as something else.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const blob = findStoredFileBlob({ userId, blobId: params.get("blobId") ?? "" });
    const mimeType = openedImageMimeType(params.get("name") ?? "");
    if (!blob || !mimeType || !isMarkedWebBlob(blob)) {
      return NextResponse.json({ error: "file_not_found" }, { status: 404 });
    }
    touchWebPdfBlob(blob);
    return new Response(new Uint8Array(fs.readFileSync(blob.path)), {
      headers: { "content-type": mimeType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
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
