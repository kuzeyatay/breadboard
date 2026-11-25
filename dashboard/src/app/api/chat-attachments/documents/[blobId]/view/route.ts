import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { findDocumentBlob } from "@/lib/conversations/document-blob-store.ts";
import {
  describeDocumentSummary,
  DOCUMENT_ATTACHMENT_FORMATS,
  withResolvedFigureUrls,
} from "@/lib/document-attachments.ts";
import {
  readDocument,
  readOpenDocument,
  type DocumentStructure,
} from "@/lib/document-structure/index.ts";
import { readXlsxForView } from "@/lib/document-structure/xlsx.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET: an attached document read for the in-chat preview popup.
 *
 * A workbook comes back as sheets of cells (rows at their real numbers, merges,
 * widths, number formats) so the popup can draw a spreadsheet. Every other
 * Office format comes back as the same structural markdown the full-page
 * reader shows, with figures pointed at their sidecars.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ blobId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { blobId } = await params;
    const blob = findDocumentBlob({ userId, blobId });
    if (!blob) {
      return NextResponse.json({ error: "document_not_found" }, { status: 404 });
    }
    const sourceUrl = `/api/chat-attachments/documents/${encodeURIComponent(blob.blobId)}`;
    const label = DOCUMENT_ATTACHMENT_FORMATS[blob.format].label;
    const headers = { "cache-control": "private, max-age=300" };

    if (blob.format === "pdf") {
      return NextResponse.json({ format: blob.format, label, sourceUrl, pdf: true }, { headers });
    }

    const buffer = fs.readFileSync(blob.path) as Buffer;
    if (blob.format === "xlsx") {
      const { sheets, warnings } = readXlsxForView(buffer);
      return NextResponse.json({ format: blob.format, label, sourceUrl, sheets, warnings }, { headers });
    }

    let structure: DocumentStructure;
    try {
      structure =
        blob.format === "odt" || blob.format === "ods" || blob.format === "odp"
          ? await readOpenDocument(buffer)
          : readDocument(blob.format, buffer);
    } catch (error) {
      return NextResponse.json({
        format: blob.format,
        label,
        sourceUrl,
        markdown: "",
        description: "",
        warnings: [
          error instanceof Error
            ? `This document could not be read: ${error.message}`
            : "This document could not be read.",
        ],
      }, { headers });
    }
    return NextResponse.json({
      format: blob.format,
      label,
      sourceUrl,
      markdown: withResolvedFigureUrls(structure.markdown, sourceUrl),
      description: describeDocumentSummary(structure.summary),
      warnings: structure.warnings,
    }, { headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
