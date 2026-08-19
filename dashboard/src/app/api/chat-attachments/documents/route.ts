import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  DOCUMENT_FILENAME_HEADER,
  MAX_DOCUMENT_ATTACHMENT_BYTES,
  documentAttachmentFormat,
  normalizeDocumentSummary,
} from "@/lib/document-attachments.ts";
import {
  DocumentBlobError,
  findDocumentBlob,
  removeDocumentBlob,
  writeDocumentBlob,
  writeDocumentFigures,
} from "@/lib/conversations/document-blob-store.ts";
import { enqueueDocumentIndex } from "@/lib/colpali/indexer.ts";
import {
  documentContextText,
  readDocument,
  readOpenDocument,
} from "@/lib/document-structure/index.ts";
import fs from "node:fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST: store an attached document and read it, in one round trip.
 *
 * Two things happen here that used to happen in neither place. The bytes are
 * **kept** — until now a .docx was read at send time and thrown away, which is
 * why no agent could ever mark one up — and the reading is **structural**, so a
 * table comes back as a table, an equation as LaTeX, and a figure as a file on
 * disk rather than as silence.
 *
 * Both in one request because they are one act: the extraction needs the bytes,
 * the figures belong beside the blob they came out of, and a client that had to
 * make two calls could end up with a stored document nothing ever read.
 *
 * The file arrives as the raw request body rather than a form part, so a large
 * board pack is not parsed into memory; the filename rides in a header.
 *
 * **PDFs are stored here but read elsewhere.** `/api/extract-text` already
 * renders their pages and falls back to transcribing them with a vision model
 * when a scan has no text layer — a mature path worth reusing rather than
 * reimplementing. So a PDF gets its bytes kept here and its words from there.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    let filename = "";
    try {
      filename = decodeURIComponent(request.headers.get(DOCUMENT_FILENAME_HEADER) ?? "").trim();
    } catch {
      filename = "";
    }
    if (!filename) {
      throw new ApiError(
        400,
        "document_filename_required",
        "The document arrived without a filename.",
      );
    }
    const format = documentAttachmentFormat(filename);
    if (!format) {
      throw new ApiError(
        415,
        "unsupported_document_format",
        `Breadboard cannot keep "${filename}" as a document.`,
      );
    }

    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_ATTACHMENT_BYTES) {
      throw new ApiError(413, "document_too_large", "That document is larger than 128 MB.");
    }
    if (!request.body) {
      throw new ApiError(400, "document_body_required", "No document was received.");
    }

    const stored = await writeDocumentBlob({ userId, format, body: request.body });

    if (format === "pdf") {
      return NextResponse.json({
        blobId: stored.blobId,
        format: stored.format,
        sizeBytes: stored.byteSize,
        text: null,
        summary: null,
        figures: [],
        warnings: [],
      });
    }

    // Reading happens after the bytes are safe, so a document that defeats the
    // reader is still a document the user can hand to an agent.
    let text = "";
    let summary = null;
    let figureNames: string[] = [];
    let warnings: string[] = [];
    try {
      const buffer = fs.readFileSync(stored.path);
      // OpenDocument formats go through `officeparser`, whose zip
      // decompression is inherently asynchronous — `readDocument`'s switch
      // cannot await it because its other callers are synchronous. This
      // route already is async, so it awaits the real reader directly rather
      // than settling for the empty-structure fallback `readDocument` gives
      // those three formats.
      const structure =
        format === "odt" || format === "ods" || format === "odp"
          ? await readOpenDocument(buffer)
          : readDocument(format, buffer);
      figureNames = writeDocumentFigures({
        userId,
        blobId: stored.blobId,
        figures: structure.figures.map((figure) => ({
          extension: figure.extension,
          bytes: figure.bytes,
        })),
      });
      summary = normalizeDocumentSummary(structure.summary);
      warnings = structure.warnings;
      text = documentContextText({
        filename,
        summary,
        markdown: structure.markdown,
        warnings,
        figureNote: figureNames.length
          ? `_The ${figureNames.length === 1 ? "figure" : `${figureNames.length} figures`} referenced below ${
              figureNames.length === 1 ? "is" : "are"
            } stored with this document and can be opened._`
          : "",
      });
    } catch (error) {
      warnings = [
        error instanceof Error
          ? `This document could not be read fully: ${error.message}`
          : "This document could not be read fully.",
      ];
      text = documentContextText({ filename, summary: null, markdown: "", warnings });
    }

    // Rendering and embedding a hundred pages is tens of seconds of GPU work,
    // so it happens after this response rather than inside it. Until it lands,
    // the retrieval path reads the status sidecar and inlines the whole
    // document exactly as it did before ColPali existed.
    enqueueDocumentIndex({
      blobId: stored.blobId,
      blobPath: stored.path,
      format: stored.format,
    });

    return NextResponse.json({
      blobId: stored.blobId,
      format: stored.format,
      sizeBytes: stored.byteSize,
      text,
      summary,
      figures: figureNames,
      warnings,
    });
  } catch (error) {
    if (error instanceof DocumentBlobError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}

/** DELETE: drop a document the user removed from the composer before sending. */
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const blobId = new URL(request.url).searchParams.get("blobId") ?? "";
    if (!findDocumentBlob({ userId, blobId })) {
      return NextResponse.json({ removed: false });
    }
    return NextResponse.json({ removed: removeDocumentBlob({ userId, blobId }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
