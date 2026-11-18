import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { matchesValidator, parseRangeHeader, rangeIsStillValid } from "@/lib/http-range";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { DOCUMENT_ATTACHMENT_FORMATS } from "@/lib/document-attachments.ts";
import { markedImageResponse } from "@/lib/hermes/image-marks.ts";
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
      const params = new URL(request.url).searchParams;
      const marks = params.getAll("mark");
      if (marks.length) return markedImageResponse(figure.buffer, marks, params.get("download") === "1");
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

    const validator = `"${blob.blobId}"`;
    const headers = new Headers({
      "content-type": DOCUMENT_ATTACHMENT_FORMATS[blob.format].mimeType,
      "content-disposition": `attachment; filename="${blob.blobId}.${blob.format}"`,
      "cache-control": "private, max-age=3600",
      "accept-ranges": "bytes",
      etag: validator,
    });
    if (matchesValidator(request.headers.get("if-none-match"), validator)) return new Response(null, { status: 304, headers });
    const range = parseRangeHeader(rangeIsStillValid(request.headers.get("if-range"), validator)
      ? request.headers.get("range") : null, blob.byteSize);
    if (range.kind === "unsatisfiable") {
      headers.set("content-range", `bytes */${blob.byteSize}`);
      return new Response(null, { status: 416, headers });
    }
    const slice = range.kind === "range" ? range.range : undefined;
    if (slice) headers.set("content-range", `bytes ${slice.start}-${slice.end}/${blob.byteSize}`);
    headers.set("content-length", String(slice ? slice.end - slice.start + 1 : blob.byteSize));
    const stream = fs.createReadStream(blob.path, slice);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: slice ? 206 : 200, headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
