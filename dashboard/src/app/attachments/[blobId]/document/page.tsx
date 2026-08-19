import fs from "node:fs";
import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { findDocumentBlob } from "@/lib/conversations/document-blob-store.ts";
import {
  attachmentDisplayName,
  describeDocumentSummary,
  DOCUMENT_ATTACHMENT_FORMATS,
  withResolvedFigureUrls,
} from "@/lib/document-attachments.ts";
import {
  readDocument,
  readOpenDocument,
  type DocumentStructure,
} from "@/lib/document-structure/index.ts";
import { getNavbarShortcuts } from "@/lib/profile/navbar-shortcuts-store.ts";
import DocumentViewerClient from "./document-viewer-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}): Promise<Metadata> {
  const { name } = await searchParams;
  const cleaned = typeof name === "string" ? name.trim().slice(0, 120) : "";
  return { title: cleaned || "Document attachment" };
}

/**
 * The built-in viewer for an attached document that is not a PDF.
 *
 * A .docx has no pages to render — there is no renderer for one outside Word —
 * so what this shows is the structural reading the attachment pipeline already
 * performs: headings as headings, tables as tables, equations as equations, and
 * the figures lifted out of the file shown where they sat in it. That reading
 * is what the model was given to answer from, which makes this page the honest
 * answer to "what did it actually see in my file".
 *
 * It is re-derived here rather than stored. The bytes are kept and the words
 * were never copied into the transcript, so the file on disk is the only source
 * — and re-reading it is the same work the send did, on a page somebody opened
 * on purpose.
 */
export default async function ChatAttachmentDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ blobId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");

  const userId = Number((session.user as { id?: string } | undefined)?.id);
  if (!Number.isFinite(userId) || userId <= 0) notFound();

  const { blobId } = await params;
  const { name } = await searchParams;
  const blob = findDocumentBlob({ userId, blobId });
  if (!blob) notFound();

  // A PDF has a better page than this one. Landing here means a stale link, so
  // send it where it was going rather than rendering a PDF as flat markdown.
  if (blob.format === "pdf") {
    const query = typeof name === "string" && name ? `?name=${encodeURIComponent(name)}` : "";
    redirect(`/attachments/${encodeURIComponent(blob.blobId)}/pdf${query}`);
  }

  const descriptor = DOCUMENT_ATTACHMENT_FORMATS[blob.format];
  const fileName = attachmentDisplayName(
    name,
    blob.format,
    `${blob.blobId}.${blob.format}`,
  );

  let structure: DocumentStructure;
  try {
    const buffer = fs.readFileSync(blob.path);
    // OpenDocument formats go through `officeparser`, whose zip decompression
    // is asynchronous — `readDocument` cannot await it because its other
    // callers are synchronous, so it returns a warning for them instead. This
    // page is async, so it awaits the real reader the same way the attach-time
    // route does.
    structure =
      blob.format === "odt" || blob.format === "ods" || blob.format === "odp"
        ? await readOpenDocument(buffer)
        : readDocument(blob.format, buffer);
  } catch (error) {
    structure = {
      markdown: "",
      figures: [],
      formulas: [],
      summary: {
        figureCount: 0,
        formulaCount: 0,
        tableCount: 0,
        sheetCount: 0,
        slideCount: 0,
        pageCount: 0,
        cellFormulaCount: 0,
        trackedChangeCount: 0,
        commentCount: 0,
      },
      warnings: [
        error instanceof Error
          ? `This document could not be read: ${error.message}`
          : "This document could not be read.",
      ],
    };
  }

  const sourceUrl = `/api/chat-attachments/documents/${encodeURIComponent(blob.blobId)}`;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-gray-100">
      <DocumentViewerClient
        fileName={fileName}
        kicker={descriptor.label}
        description={describeDocumentSummary(structure.summary)}
        markdown={withResolvedFigureUrls(structure.markdown, sourceUrl)}
        warnings={structure.warnings}
        sourceUrl={sourceUrl}
        fastRead={getNavbarShortcuts(userId).fastRead}
      />
    </div>
  );
}
