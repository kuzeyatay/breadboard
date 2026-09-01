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
import path from "node:path";
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
import { findStoredFileBlob } from "./conversations/stored-file-blob-store.ts";
import { storedFileIsText } from "./stored-file-attachments.ts";
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

export interface StagedEditableDocuments {
  context: string;
  paths: Array<{ name: string; format: "docx" | "pptx" | "pdf"; path: string }>;
}

function safeWorkspaceName(name: string): string {
  const parsed = path.parse(path.basename(name));
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 100);
  return base || "document";
}

/**
 * Copy this turn's editable originals into the authorized runtime workspace.
 * The blob-store copy remains immutable; subsequent tool calls operate on this
 * per-conversation copy and publish their result through the artifact store.
 */
export function stageEditableDocumentAttachments(input: {
  userId: number;
  attachments: readonly ChatAttachment[] | undefined;
  workspace: string;
}): StagedEditableDocuments {
  const candidates = (input.attachments ?? []).filter(
    (attachment): attachment is Extract<ChatAttachment, { type: "document" }> =>
      attachment.type === "document" && ["docx", "pptx", "pdf"].includes(attachment.format),
  );
  if (candidates.length === 0) return { context: "", paths: [] };

  const workspace = fs.realpathSync(path.resolve(input.workspace));
  const stagingRoot = path.join(workspace, ".breadboard");
  const rootEntry = fs.lstatSync(stagingRoot, { throwIfNoEntry: false });
  if (rootEntry?.isSymbolicLink() || (rootEntry && !rootEntry.isDirectory())) {
    return { context: "", paths: [] };
  }
  if (!rootEntry) fs.mkdirSync(stagingRoot);
  const realStagingRoot = fs.realpathSync(stagingRoot);
  const rootRelative = path.relative(workspace, realStagingRoot);
  if (!rootRelative || rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) {
    return { context: "", paths: [] };
  }

  const directory = path.join(realStagingRoot, "attachments");
  const directoryEntry = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (directoryEntry?.isSymbolicLink() || (directoryEntry && !directoryEntry.isDirectory())) {
    return { context: "", paths: [] };
  }
  if (!directoryEntry) fs.mkdirSync(directory);
  const realDirectory = fs.realpathSync(directory);
  const directoryRelative = path.relative(workspace, realDirectory);
  if (directoryRelative.startsWith("..") || path.isAbsolute(directoryRelative)) {
    return { context: "", paths: [] };
  }

  const staged: StagedEditableDocuments["paths"] = [];
  for (const attachment of candidates) {
    const resolved = resolveDocumentAttachment(input.userId, attachment);
    if (!resolved || !["docx", "pptx", "pdf"].includes(resolved.format)) continue;
    const format = resolved.format as "docx" | "pptx" | "pdf";
    const filename = `${resolved.blobId}-${safeWorkspaceName(resolved.name)}.${format}`;
    const target = path.join(realDirectory, filename);
    const relative = path.relative(workspace, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const existing = fs.lstatSync(target, { throwIfNoEntry: false });
      if (existing?.isSymbolicLink() || (existing && !existing.isFile())) continue;
      if (!existing) fs.copyFileSync(resolved.path, target, fs.constants.COPYFILE_EXCL);
      staged.push({ name: resolved.name, format, path: relative.replaceAll("\\", "/") });
    } catch {
      // The attachment's structured reading still reaches the model. A staging
      // failure removes editing, not reading, from this turn.
    }
  }

  const context = staged.length
    ? [
        "<breadboard_editable_documents>",
        "These are byte-preserving workspace copies of files attached to this conversation.",
        ...staged.map((entry) =>
          `- ${JSON.stringify(entry.name)} (${entry.format}): ${JSON.stringify(entry.path)}`),
        "Use document_edit without patches to inspect DOCX/PPTX anchors, then patch them. Use pdf_to_docx for PDF conversion.",
        "</breadboard_editable_documents>",
      ].join("\n")
    : "";
  return { context, paths: staged };
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
    if (attachment.type === "document" && !attachment.text?.trim()) {
      const resolved = resolveDocumentAttachment(userId, attachment);
      return resolved ? { ...attachment, text: resolved.text } : attachment;
    }
    if (
      attachment.type === "text" &&
      !attachment.text &&
      attachment.blobId &&
      attachment.format &&
      storedFileIsText(attachment.format)
    ) {
      const stored = findStoredFileBlob({ userId, blobId: attachment.blobId });
      if (stored?.format === attachment.format) {
        try {
          return { ...attachment, text: fs.readFileSync(stored.path, "utf8") };
        } catch {
          // Keep the pointer even if this read fails. The artifact importer can
          // still return an ownership-scoped not-found error instead of losing
          // which upload the turn referred to.
        }
      }
    }
    return attachment;
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
