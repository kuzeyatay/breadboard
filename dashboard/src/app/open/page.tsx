import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { findDocumentBlob, isMarkedWebBlob, touchWebPdfBlob } from "@/lib/conversations/document-blob-store.ts";
import { findStoredFileBlob } from "@/lib/conversations/stored-file-blob-store.ts";
import { findVideoBlob } from "@/lib/conversations/video-blob-store.ts";
import { chatVideoPlaybackHref } from "@/lib/video-attachments.ts";
import { openedImageMimeType } from "@/lib/local-document";
import { getNavbarFlowers, getNavbarShortcuts } from "@/lib/profile/navbar-shortcuts-store.ts";
import LocalDocumentViewer, { type StoredOpenedFile } from "./local-document-viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open file" };

/** The kept copy a restored tab reopens, from whichever store its id belongs to. */
function storedFile(userId: number, blobId: string, name: string): StoredOpenedFile | null {
  const id = encodeURIComponent(blobId);
  const pdf = findDocumentBlob({ userId, blobId });
  if (pdf?.format === "pdf") { touchWebPdfBlob(pdf); return { kind: "pdf", url: `/api/chat-attachments/documents/${id}` }; }
  const video = findVideoBlob({ userId, blobId });
  if (video) { touchWebPdfBlob(video); return { kind: "video", url: chatVideoPlaybackHref(blobId, video.format) }; }
  const image = findStoredFileBlob({ userId, blobId });
  if (image && isMarkedWebBlob(image) && openedImageMimeType(name)) {
    return { kind: "image", url: `/api/chat-attachments/files?${new URLSearchParams({ blobId, name })}` };
  }
  return null;
}

/**
 * A PDF, Office file, image or video opened from disk in Breadboard's viewer.
 * The bytes are kept in the same stores chat attachments use, marked like
 * website PDFs (`blob`), so a restored tab reopens them after a restart and the
 * Settings cleanup switch decides when they go.
 */
export default async function OpenLocalDocumentPage({ searchParams }: { searchParams: Promise<{ blob?: string; name?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login");
  const userId = Number((session.user as { id?: string } | undefined)?.id);
  if (!Number.isFinite(userId) || userId <= 0) notFound();
  const { blob, name } = await searchParams;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-gray-100">
      <LocalDocumentViewer stored={blob ? storedFile(userId, blob, name ?? "") : null}
        fastRead={getNavbarShortcuts(userId).fastRead} showNavbarFlowers={getNavbarFlowers(userId)} />
    </div>
  );
}
