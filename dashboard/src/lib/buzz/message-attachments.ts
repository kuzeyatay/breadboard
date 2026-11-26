import { ApiError } from "@/lib/hermes/route-helpers.ts";
import { requireString } from "@/lib/buzz/route-helpers.ts";
import { buzzBridge, drive } from "@/lib/crumbs/service.ts";
import { findStoredFileBlob } from "@/lib/conversations/stored-file-blob-store.ts";

/**
 * The words and files of a message posted from the Organization page, for
 * the room spine and for thread replies alike. Files are ones this account
 * already stored through the chat upload route, at most ten; a message may be
 * only files. In an organization on Crumbs, files reach members on other
 * machines through the sender's Google Drive, so it must be connected.
 */
export function readMessageContent(userId: number, roomId: number, body: Record<string, unknown>) {
  const value = body.attachments;
  if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > 10)) {
    throw new ApiError(400, "invalid_attachments", "Attach at most ten files.");
  }
  const attachments = (Array.isArray(value) ? value : []).map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 240) : "";
    const blob = typeof item.blobId === "string" ? findStoredFileBlob({ userId, blobId: item.blobId }) : null;
    if (!name || !blob) throw new ApiError(400, "invalid_attachments", "One of the files is no longer available. Attach it again.");
    return { type: "file" as const, name, blobId: blob.blobId, format: blob.format, sizeBytes: blob.byteSize };
  });
  const text = attachments.length && (typeof body.body !== "string" || body.body.trim() === "") ? "" : requireString(body.body, "body", 12000);
  if (attachments.length && buzzBridge.isLinked(roomId) && !drive.status(userId).connected) {
    throw new ApiError(409, drive.configured() ? "drive_required" : "drive_not_configured", drive.configured()
      ? "Connect Google Drive to share files with members on other machines."
      : "File sharing in this organization needs Google Drive, which is not set up on this Breadboard yet.");
  }
  return { text, metadata: attachments.length ? { attachments } : undefined };
}
