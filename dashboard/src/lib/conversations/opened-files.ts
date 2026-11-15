import { webPdfCleanupEnabled } from "../thought-topology/preferences.ts";
import { sweepMarkedBlobs, sweepWebPdfBlobs } from "./document-blob-store.ts";
import { listStoredFileBlobs, removeStoredFileBlob } from "./stored-file-blob-store.ts";
import { listVideoBlobs, removeVideoBlob } from "./video-blob-store.ts";

/** Header a client sends when it only wants the bytes kept for a viewer (website PDFs, files opened from a new tab). */
export const STORE_ONLY_HEADER = "x-document-store-only";

/** Website PDFs and files opened from a new tab, unopened for 30 days, unless Settings turned cleanup off. */
export function sweepOpenedFiles(userId: number): void {
  try {
    if (!webPdfCleanupEnabled(userId)) return;
    sweepWebPdfBlobs(userId);
    sweepMarkedBlobs(listVideoBlobs(userId), blob => removeVideoBlob({ userId, blobId: blob.blobId }));
    sweepMarkedBlobs(listStoredFileBlobs(userId), blob => removeStoredFileBlob({ userId, blobId: blob.blobId }));
  } catch {
    // A failed sweep must not lose the file just kept.
  }
}
