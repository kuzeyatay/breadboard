import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { findStoredFileBlob } from "@/lib/conversations/stored-file-blob-store.ts";
import { storedFileIsText } from "@/lib/stored-file-attachments.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Enough for any file a person reads in a popup; the rest is a download. */
const MAX_VIEW_BYTES = 2 * 1024 * 1024;

/**
 * GET: a stored chat file's text, for the in-chat preview popup.
 *
 * Only textual formats are read, and only as JSON text: nothing here is served
 * with the file's own content type, so an attached .html or .svg can never run
 * as a page on this origin. `?download=1` returns the original bytes as an
 * attachment for the popup's download button.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    const blob = findStoredFileBlob({ userId, blobId });
    if (!blob) return NextResponse.json({ error: "file_not_found" }, { status: 404 });

    if (new URL(request.url).searchParams.get("download") === "1") {
      return new Response(new Uint8Array(fs.readFileSync(blob.path)), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${blob.blobId}.${blob.format}"`,
          "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (!storedFileIsText(blob.format)) {
      return NextResponse.json({ format: blob.format, textual: false, sizeBytes: blob.byteSize });
    }
    const buffer = fs.readFileSync(blob.path) as Buffer;
    const truncated = buffer.byteLength > MAX_VIEW_BYTES;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      truncated ? buffer.subarray(0, MAX_VIEW_BYTES) : buffer,
    );
    return NextResponse.json(
      { format: blob.format, textual: true, text, truncated, sizeBytes: blob.byteSize },
      { headers: { "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
