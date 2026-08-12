// Request-body validation for chat attachments.
//
// Lifted out of the agent send route so the direct-provider send route validates
// attachments with the same rules rather than its own near-copy: an attachment
// that is acceptable on one send path and not the other is a bug waiting for
// whichever path was forgotten.

import { ApiError, requireString } from "./hermes/route-helpers.ts";
import type { ChatAttachment } from "./chat-attachments.ts";
import {
  isModelAttachmentFormat,
  isModelBlobId,
  normalizeModelAttachmentSummary,
} from "./model-attachments.ts";
import { isVideoAttachmentFormat, isVideoBlobId } from "./video-attachments.ts";
import { isAudioAttachmentFormat, isAudioBlobId } from "./audio-attachments.ts";
import {
  isDocumentAttachmentFormat,
  isDocumentBlobId,
  normalizeDocumentSummary,
} from "./document-attachments.ts";

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 12 * 1024 * 1024;

export function parseChatAttachments(value: unknown): ChatAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new ApiError(
      400,
      "invalid_attachments",
      `Attachments must contain at most ${MAX_ATTACHMENTS} items.`,
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(
        400,
        "invalid_attachments",
        `Attachment ${index + 1} is invalid.`,
      );
    }
    const attachment = item as Record<string, unknown>;
    const name = requireString(attachment.name, `attachments[${index}].name`, 500);
    if (/[\\/\0]/.test(name)) {
      throw new ApiError(400, "invalid_attachments", "Attachment name is invalid.");
    }
    if (attachment.type === "text") {
      return {
        type: "text",
        name,
        text: requireString(
          attachment.text,
          `attachments[${index}].text`,
          MAX_ATTACHMENT_TEXT_LENGTH,
        ),
      };
    }
    if (attachment.type === "image") {
      const dataUrl = requireString(
        attachment.dataUrl,
        `attachments[${index}].dataUrl`,
        MAX_ATTACHMENT_DATA_URL_LENGTH,
      );
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
        throw new ApiError(
          400,
          "invalid_attachments",
          "Image attachment must be a base64 data URL.",
        );
      }
      return { type: "image", name, dataUrl };
    }
    if (attachment.type === "video") {
      // Same contract as a mesh: the bytes were checked and stored by
      // /api/chat-attachments/videos, so only the pointer travels here and only
      // the pointer is validated. Ownership is re-checked when the file is read.
      if (
        !isVideoBlobId(attachment.blobId) ||
        !isVideoAttachmentFormat(attachment.format)
      ) {
        throw new ApiError(
          400,
          "invalid_attachments",
          "That video attachment is not valid.",
        );
      }
      const sizeBytes = Number(attachment.sizeBytes);
      return {
        type: "video",
        name,
        blobId: attachment.blobId,
        format: attachment.format,
        ...(Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? { sizeBytes: Math.round(sizeBytes) }
          : {}),
      };
    }
    if (attachment.type === "audio") {
      // Same contract as a video: the bytes were checked and stored by
      // /api/chat-attachments/audio, so only the pointer travels here and only
      // the pointer is validated. Ownership is re-checked when the file is read.
      if (
        !isAudioBlobId(attachment.blobId) ||
        !isAudioAttachmentFormat(attachment.format)
      ) {
        throw new ApiError(400, "invalid_attachments", "That audio attachment is not valid.");
      }
      const sizeBytes = Number(attachment.sizeBytes);
      return {
        type: "audio",
        name,
        blobId: attachment.blobId,
        format: attachment.format,
        ...(Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? { sizeBytes: Math.round(sizeBytes) }
          : {}),
      };
    }
    if (attachment.type === "model") {
      // The bytes were checked and stored by /api/chat-attachments/models, so
      // what arrives here is only the pointer to them and the pointer is what
      // is validated. Ownership is re-checked when the file is read back.
      if (
        !isModelBlobId(attachment.blobId) ||
        !isModelAttachmentFormat(attachment.format)
      ) {
        throw new ApiError(
          400,
          "invalid_attachments",
          "That 3D attachment is not valid.",
        );
      }
      const summary = normalizeModelAttachmentSummary(attachment.summary);
      const sizeBytes = Number(attachment.sizeBytes);
      return {
        type: "model",
        name,
        blobId: attachment.blobId,
        format: attachment.format,
        ...(Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? { sizeBytes: Math.round(sizeBytes) }
          : {}),
        ...(summary ? { summary } : {}),
      };
    }
    if (attachment.type === "document") {
      // Same contract as a video or a mesh: the bytes were checked and stored
      // by /api/chat-attachments/documents, so only the pointer travels here
      // and only the pointer is validated. Ownership is re-checked when the
      // file is read.
      if (
        !isDocumentBlobId(attachment.blobId) ||
        !isDocumentAttachmentFormat(attachment.format)
      ) {
        throw new ApiError(400, "invalid_attachments", "That document attachment is not valid.");
      }
      // The text may be absent — a regenerated turn sends the pointer alone,
      // because a transcript never held the words. `resolveDocumentAttachments`
      // fills it in from the stored file.
      const text =
        typeof attachment.text === "string"
          ? attachment.text.slice(0, MAX_ATTACHMENT_TEXT_LENGTH)
          : "";
      const summary = normalizeDocumentSummary(attachment.summary);
      const sizeBytes = Number(attachment.sizeBytes);
      return {
        type: "document",
        name,
        blobId: attachment.blobId,
        format: attachment.format,
        text,
        ...(Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? { sizeBytes: Math.round(sizeBytes) }
          : {}),
        ...(summary ? { summary } : {}),
        ...(Array.isArray(attachment.figures)
          ? {
              figures: attachment.figures
                .filter(
                  (entry): entry is string =>
                    typeof entry === "string" && /^figure-\d{1,4}\.[a-z0-9]{1,5}$/i.test(entry),
                )
                .slice(0, 200),
            }
          : {}),
      };
    }
    throw new ApiError(
      400,
      "invalid_attachments",
      `Attachment ${index + 1} has an unsupported type.`,
    );
  });
}
