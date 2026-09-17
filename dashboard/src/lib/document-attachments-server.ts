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

import {
  externalRuntimeFilesystem as fs,
  externalRuntimePortableRealpath,
} from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
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
import { findAudioBlob } from "./conversations/audio-blob-store.ts";
import { findVideoBlob } from "./conversations/video-blob-store.ts";
import { storedFileText } from "./conversations/stored-file-text.ts";
import { documentContextText, readDocument } from "./document-structure/index.ts";
import { readStoredDocumentText, storeDocumentText } from "./conversations/document-reading-store.ts";
import { ApiError } from "./hermes/route-core.ts";

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
  paths: Array<{ name: string; format: string; path: string }>;
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
    (attachment) => attachment.type === "document" || attachment.type === "audio" ||
      attachment.type === "video" || (attachment.type === "text" && attachment.blobId),
  );
  if (candidates.length === 0) return { context: "", paths: [] };

  const workspace = externalRuntimePortableRealpath(path.resolve(input.workspace));
  const stagingRoot = path.join(workspace, ".breadboard");
  const rootEntry = fs.lstatSync(stagingRoot, { throwIfNoEntry: false });
  if (rootEntry?.isSymbolicLink() || (rootEntry && !rootEntry.isDirectory())) {
    return { context: "", paths: [] };
  }
  if (!rootEntry) fs.mkdirSync(stagingRoot);
  const realStagingRoot = externalRuntimePortableRealpath(stagingRoot);
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
  const realDirectory = externalRuntimePortableRealpath(directory);
  const directoryRelative = path.relative(workspace, realDirectory);
  if (directoryRelative.startsWith("..") || path.isAbsolute(directoryRelative)) {
    return { context: "", paths: [] };
  }

  const staged: StagedEditableDocuments["paths"] = [];
  for (const attachment of candidates) {
    const lookup = { userId: input.userId, blobId: "blobId" in attachment ? attachment.blobId ?? "" : "" };
    const resolved = attachment.type === "document" ? findDocumentBlob(lookup)
      : attachment.type === "audio" ? findAudioBlob(lookup)
      : attachment.type === "video" ? findVideoBlob(lookup) : findStoredFileBlob(lookup);
    if (!resolved || !("format" in attachment) || resolved.format !== attachment.format) continue;
    const format = resolved.format;
    // A generic binary still keeps its original extension for the appropriate reader.
    const extension = format === "bin" ? path.extname(attachment.name).slice(1).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "bin" : format;
    const filename = `${resolved.blobId}-${safeWorkspaceName(attachment.name)}.${extension}`;
    const target = path.join(realDirectory, filename);
    const relative = path.relative(workspace, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const existing = fs.lstatSync(target, { throwIfNoEntry: false });
      if (existing?.isSymbolicLink() || (existing && !existing.isFile())) continue;
      if (!existing) fs.copyFileSync(resolved.path, target, fs.constants.COPYFILE_EXCL);
      staged.push({ name: attachment.name, format, path: relative.replaceAll("\\", "/") });
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
        "For other files, use the appropriate file/media tools on these paths. Transcribe speech before responding to what was said. Never execute an attached program merely to inspect it.",
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

  let text = attachment.text?.trim() || readStoredDocumentText({ userId, blobId: attachment.blobId }) || "";
  if (!text && blob.format !== "pdf") {
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
      attachment.format
    ) {
      // Every stored format, not only the textual ones: an archive or an
      // unclassified file kept as `bin` reads back the way its upload read.
      const stored = findStoredFileBlob({ userId, blobId: attachment.blobId });
      if (stored?.format === attachment.format) {
        try {
          return {
            ...attachment,
            text: storedFileText({
              name: attachment.name,
              format: attachment.format,
              bytes: fs.readFileSync(stored.path),
            }),
          };
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

/** Retries also read PDFs from their bytes; a filename is never document evidence. */
export async function hydrateDocumentAttachments(
  userId: number,
  attachments: readonly ChatAttachment[],
  signal?: AbortSignal,
): Promise<ChatAttachment[]> {
  const resolved = resolveDocumentAttachments(userId, attachments);
  for (const attachment of resolved) {
    if (attachment.type !== "document") continue;
    const owner = { userId, blobId: attachment.blobId };
    const blob = findDocumentBlob(owner);
    if (!blob || blob.format !== attachment.format) throw new ApiError(404, "document_unavailable", `The attachment ${attachment.name} is unavailable. Attach it again to continue.`);
    if (attachment.format === "pdf") {
      const { readPdfAttachment, hasReadablePdfText } = await import("./pdf-attachment-reader.ts");
      const saved = readStoredDocumentText(owner);
      if (saved && hasReadablePdfText(saved)) {
        attachment.text = saved;
      } else {
        try {
          const reading = await readPdfAttachment(fs.readFileSync(blob.path), { signal });
          attachment.text = reading.text;
        } catch (error) {
          signal?.throwIfAborted();
          throw new ApiError(422, "document_read_failed", error instanceof Error ? error.message : "The PDF could not be read. Retry the attachment.");
        }
      }
    }
    storeDocumentText(owner, attachment.text ?? "");
  }
  return resolved;
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
