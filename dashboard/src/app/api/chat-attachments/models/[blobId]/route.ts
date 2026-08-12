import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { isModelBlobId, modelFormatMimeType } from "@/lib/model-attachments.ts";
import { readModelBlob } from "@/lib/conversations/model-blob-store.ts";
import { getModelBlobForUser } from "@/lib/conversations/model-uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET: the bytes of one attached 3D model, for the viewer or a download.
 *
 * Authorized against the uploader rather than a message, because the viewer
 * opens before the message exists — a model is previewable from the composer,
 * while the user is still deciding whether to send it. A blob nobody here
 * uploaded reads as missing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    if (!isModelBlobId(blobId)) {
      throw new ApiError(404, "model_not_found", "That 3D file was not found.");
    }

    const record = getModelBlobForUser(blobId, userId);
    if (!record) throw new ApiError(404, "model_not_found", "That 3D file was not found.");

    const bytes = readModelBlob({ blobId: record.blobId, format: record.format });
    const download = new URL(request.url).searchParams.get("download") === "1";
    const asciiName = record.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": modelFormatMimeType(record.format),
        "Content-Length": String(bytes.byteLength),
        // Immutable: a blob id names one set of bytes and is never rewritten.
        "Cache-Control": "private, max-age=3600, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
