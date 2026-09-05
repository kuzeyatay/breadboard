import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { findDocumentBlob } from "@/lib/conversations/document-blob-store.ts";
import { attachmentDisplayName } from "@/lib/document-attachments.ts";
import {
  getNavbarFlowers,
  getNavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts-store.ts";
import PdfViewerClient from "@/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}): Promise<Metadata> {
  const { name } = await searchParams;
  return { title: attachmentDisplayName(name, "pdf", "PDF attachment") };
}

/**
 * The built-in PDF viewer, opened on a document attached to a chat.
 *
 * The same reader the garden opens a source PDF in and the same one a PDF
 * artifact gets — only the bytes come from somewhere else. Read-only, because
 * an attachment is the file the person sent: there is no note behind it to
 * write an edited copy back to, and rewriting what they attached would change
 * the evidence the conversation was answered from.
 *
 * Ownership is settled by the lookup itself. `findDocumentBlob` only ever looks
 * under the caller's own directory, so somebody else's blob id is simply not
 * there — the same answer as one that never existed.
 */
export default async function ChatAttachmentPdfPage({
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
  const blob = findDocumentBlob({ userId, blobId });
  if (!blob || blob.format !== "pdf") notFound();

  const { name } = await searchParams;
  const fileName = attachmentDisplayName(name, "pdf", `${blob.blobId}.pdf`);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-gray-100">
      <PdfViewerClient
        title={fileName}
        browserTitle={fileName}
        kicker="PDF attachment"
        sourceUrl={`/api/chat-attachments/documents/${encodeURIComponent(blob.blobId)}`}
        readOnly
        fastRead={getNavbarShortcuts(userId).fastRead}
        showNavbarFlowers={getNavbarFlowers(userId)}
      />
    </div>
  );
}
