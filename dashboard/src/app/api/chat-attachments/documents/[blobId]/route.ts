import { NextResponse } from "next/server";
import fs from "node:fs";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { DOCUMENT_ATTACHMENT_FORMATS } from "@/lib/document-attachments.ts";
import {
  findDocumentBlob,
  readDocumentFigure,
} from "@/lib/conversations/document-blob-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET: the original document, or one of the figures pulled out of it.
 *
 * `?figure=figure-2.png` serves a picture from the sidecar directory. Both go
 * through `findDocumentBlob`, which only ever looks under the caller's own
 * directory — a blob belonging to somebody else is simply not there, which is
 * the same answer as one that does not exist.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    const blob = findDocumentBlob({ userId, blobId });
    if (!blob) {
      return NextResponse.json({ error: "document_not_found" }, { status: 404 });
    }

    const figureName = new URL(request.url).searchParams.get("figure");
    if (figureName) {
      const figure = readDocumentFigure({ userId, blobId, name: figureName });
      if (!figure) {
        return NextResponse.json({ error: "figure_not_found" }, { status: 404 });
      }
      const extension = figure.name.split(".").pop()?.toLowerCase() ?? "";
      const mime =
        extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "gif"
              ? "image/gif"
              : extension === "webp"
                ? "image/webp"
                : extension === "svg"
                  ? "image/svg+xml"
                  : "application/octet-stream";
      return new Response(new Uint8Array(figure.buffer), {
        headers: { "content-type": mime, "cache-control": "private, max-age=3600" },
      });
    }

    const buffer = fs.readFileSync(blob.path);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": DOCUMENT_ATTACHMENT_FORMATS[blob.format].mimeType,
        "content-disposition": `attachment; filename="${blob.blobId}.${blob.format}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
