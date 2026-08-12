// Reading a stored document back, server-side.
//
// Two callers need this and neither has the file in hand.
//
// **A regenerated turn.** A transcript keeps a document's pointer, never its
// words, so `reusableChatAttachments` hands back an attachment with an empty
// `text`. Before this existed there was no pointer either, and a retried turn
// ran against a list of filenames — the model was told a contract was attached,
// given nothing, and answered anyway. That is the worst shape a failure can
// take: confident and invisible.
//
// **An agent that wants the original.** The Legal Agent writes the real .docx
// into its workspace so the harness can mark it up rather than describe it.
//
// Node-only, deliberately in its own module: `chat-attachments.ts` is imported
// by the composer and must stay free of `node:` imports.

import fs from "node:fs";
import type { ChatAttachment } from "./chat-attachments.ts";
import {
  normalizeDocumentSummary,
  type DocumentAttachmentFormat,
} from "./document-attachments.ts";
import {
  findDocumentBlob,
  listDocumentFigures,
  readDocumentFigure,
} from "./conversations/document-blob-store.ts";
import { documentContextText, readDocument } from "./document-structure/index.ts";

export interface ResolvedDocument {
  name: string;
  blobId: string;
  format: DocumentAttachmentFormat;
  /** The original file on disk, ready to be copied into a workspace. */
  path: string;
  byteSize: number;
  /** The structured reading, re-derived when the request did not carry it. */
  text: string;
  figures: string[];
}

/**
 * Locate one document attachment's stored file, and its text.
 *
 * Returns null when the blob is not this user's — the same answer as one that
 * does not exist, which is what keeps a guessed id from being an oracle.
 */
export function resolveDocumentAttachment(
  userId: number,
  attachment: Extract<ChatAttachment, { type: "document" }>,
): ResolvedDocument | null {
  const blob = findDocumentBlob({ userId, blobId: attachment.blobId });
  if (!blob) return null;

  let text = attachment.text?.trim() ?? "";
  if (!text) {
    // Re-read rather than fail. The alternative is the silent-empty-document
    // failure this module exists to end.
    try {
      const structure = readDocument(blob.format, fs.readFileSync(blob.path));
      text = documentContextText({
        filename: attachment.name,
        summary: normalizeDocumentSummary(structure.summary),
        markdown: structure.markdown,
        warnings: structure.warnings,
      });
    } catch {
      text = "";
    }
  }

  return {
    name: attachment.name,
    blobId: attachment.blobId,
    format: blob.format,
    path: blob.path,
    byteSize: blob.byteSize,
    text,
    figures: attachment.figures?.length
      ? attachment.figures
      : listDocumentFigures({ userId, blobId: attachment.blobId }),
  };
}

/**
 * Fill in the text of every document attachment in a list.
 *
 * Attachments of other kinds pass through untouched, so a caller can hand it
 * the whole list rather than filtering first — which is what stops a new call
 * site from forgetting.
 */
export function resolveDocumentAttachments(
  userId: number,
  attachments: readonly ChatAttachment[],
): ChatAttachment[] {
  return attachments.map((attachment) => {
    if (attachment.type !== "document" || attachment.text?.trim()) return attachment;
    const resolved = resolveDocumentAttachment(userId, attachment);
    return resolved ? { ...attachment, text: resolved.text } : attachment;
  });
}

/** One figure's bytes as a data URL, for showing a chart to a vision model. */
export function documentFigureDataUrl(input: {
  userId: number;
  blobId: string;
  name: string;
}): string | null {
  const figure = readDocumentFigure(input);
  if (!figure) return null;
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
            : null;
  // Only the formats a model will actually accept; an EMF is stored but is not
  // something to hand to a vision endpoint.
  if (!mime) return null;
  return `data:${mime};base64,${figure.buffer.toString("base64")}`;
}
