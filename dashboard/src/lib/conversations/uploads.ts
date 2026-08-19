// Everything the user has ever attached to a chat, read back out of the
// transcript.
//
// There is no uploads table on purpose: an attachment is not a separate object,
// it is part of the message it was sent with. Uploads therefore projects the
// transcript rather than duplicating it, which means a deleted chat takes its
// uploads with it and nothing can go stale.
//
// Consequence worth knowing: only images (as a data URL) and 3D models and
// videos (as stored blobs) keep their bytes. Text and documents are extracted at
// send time and only the filename survives, so those rows are a record of the
// upload, not a copy of it.

import {
  normalizeChatMessageAttachments,
  type ChatMessageAttachment,
} from "../chat-attachments.ts";
import {
  modelPreviewStrategy,
  type ModelAttachmentFormat,
} from "../model-attachments.ts";
import { isPlayableVideoFormat } from "../video-attachments.ts";

export interface UploadSourceRow {
  message_id: number;
  metadata: string | null;
  created_at: string;
  conversation_public_id: string;
  conversation_title: string;
  surface: string;
  /** The Garden addresses its chats by this rather than by the public id. */
  legacy_chat_session_id?: number | null;
}

export interface StoredUpload {
  /** `<messageId>-<index>`; stable as long as the message exists. */
  id: string;
  name: string;
  kind: "image" | "file" | "model" | "video" | "audio" | "document";
  /** Null when neither the upload nor its bytes recorded a size. */
  sizeBytes: number | null;
  /** True when the original bytes are still available. */
  hasContent: boolean;
  /** True when Breadboard can render the retained bytes in its own viewer. */
  previewAvailable: boolean;
  /** The source the 3D viewer should ask the content route for. */
  previewFormat?: ModelAttachmentFormat;
  uploadedAt: string;
  conversationId: string;
  conversationTitle: string;
  surface: string;
  /**
   * The legacy chat-session id, when the chat has one. Garden Chat opens a chat
   * by this id; the Terminal opens one by `conversationId`. Null for a chat that
   * only exists canonically.
   */
  chatSessionId: number | null;
}

const IMAGE_MIME = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i;

export function dataUrlByteLength(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/\s+/g, "");
  if (!payload) return 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function dataUrlMimeType(dataUrl: string): string {
  return IMAGE_MIME.exec(dataUrl)?.[1] ?? "application/octet-stream";
}

/**
 * The attachments of one message, in the order the ids in this module refer to.
 * Both the list and the content route go through here so an index always means
 * the same file.
 */
export function messageAttachments(metadata: string | null): ChatMessageAttachment[] {
  if (!metadata) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  const attachments = normalizeChatMessageAttachments(record.attachments);
  if (attachments.length > 0) return attachments;
  // Chats from before attachments were retained kept only the filenames.
  if (!Array.isArray(record.attachmentNames)) return [];
  return record.attachmentNames.flatMap<ChatMessageAttachment>((name) =>
    typeof name === "string" && name.trim()
      ? [{ type: "file" as const, name: name.trim().slice(0, 240) }]
      : [],
  );
}

export function uploadId(messageId: number, index: number): string {
  return `${messageId}-${index}`;
}

export function parseUploadId(value: string): { messageId: number; index: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { messageId: Number(match[1]), index: Number(match[2]) };
}

export function collectUploads(
  rows: readonly UploadSourceRow[],
  limit = 300,
): StoredUpload[] {
  const uploads: StoredUpload[] = [];
  for (const row of rows) {
    const attachments = messageAttachments(row.metadata);
    attachments.forEach((attachment, index) => {
      if (uploads.length >= limit) return;
      const hasContent =
        attachment.type === "image" ||
        attachment.type === "model" ||
        attachment.type === "video" ||
        attachment.type === "audio";
      const previewAvailable =
        attachment.type === "image" ||
        // Every stored audio format plays in a browser, so there is no
        // unplayable case to exclude the way there is for Matroska or AVI.
        attachment.type === "audio" ||
        (attachment.type === "video" && isPlayableVideoFormat(attachment.format)) ||
        (attachment.type === "model" &&
          (Boolean(attachment.previewBlobId) || modelPreviewStrategy(attachment.format) === "three"));
      const previewFormat =
        attachment.type === "model" && previewAvailable
          ? attachment.previewFormat ?? attachment.format
          : undefined;
      const sizeBytes =
        attachment.sizeBytes ??
        (attachment.type === "image" ? dataUrlByteLength(attachment.dataUrl) : null);
      uploads.push({
        id: uploadId(row.message_id, index),
        name: attachment.name,
        kind: attachment.type === "file" ? "file" : attachment.type,
        sizeBytes: sizeBytes ?? null,
        hasContent,
        previewAvailable,
        ...(previewFormat ? { previewFormat } : {}),
        uploadedAt: row.created_at,
        conversationId: row.conversation_public_id,
        conversationTitle: row.conversation_title,
        surface: row.surface,
        chatSessionId: row.legacy_chat_session_id ?? null,
      });
    });
    if (uploads.length >= limit) break;
  }
  return uploads;
}

/** File-manager wording: bytes, whole KB, then MB with two decimals. */
export function formatUploadSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
