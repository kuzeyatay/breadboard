// Where an attached document's bytes live on disk.
//
// Modelled on the video store next door, and for the same reason: ownership is
// a property of the path, so a blob nobody here uploaded simply is not there to
// find. No table, therefore no migration and nothing that can drift out of step
// with the files. Bytes are streamed to a temporary name and renamed into
// place, so an upload that dies halfway can never be read as a whole document.
// Only the generated id and a format from the fixed list ever appear in a path —
// never the name the browser sent.
//
// One thing the video store does not need: a **sidecar directory** per blob,
// holding the figures the extractor lifted out of the file. A chart in a report
// is evidence, and evidence that only exists inside a zip nobody unzips is
// evidence nobody reads. The pictures are written out beside the original so an
// agent can open one, a vision model can be shown one, and the extracted
// markdown can point at them by name.

import crypto from "node:crypto";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { forgetColpaliIndex } from "../colpali/cleanup.ts";
import {
  isDocumentAttachmentFormat,
  isDocumentBlobId,
  MAX_DOCUMENT_ATTACHMENT_BYTES,
  DOCUMENT_ATTACHMENT_EXTENSIONS,
  type DocumentAttachmentFormat,
} from "../document-attachments.ts";

const fsp = fs.promises;

export class DocumentBlobError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DocumentBlobError";
    this.code = code;
    this.status = status;
  }
}

export interface StoredDocumentBlob {
  blobId: string;
  format: DocumentAttachmentFormat;
  byteSize: number;
  path: string;
  /** Present on a fresh upload: the digest of exactly the bytes written. */
  sha256?: string;
}

export function documentBlobRoot(configured?: string): string {
  const root = path.resolve(
    configured ?? process.env.BREADBOARD_CHAT_DOCUMENT_DIR?.trim() ??
      path.join(dashboardDataDir(), "chat-documents"),
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** One directory per uploader; the id in the path is the whole access check. */
function userDirectory(userId: number, configured?: string): string {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new DocumentBlobError(
      400,
      "invalid_document_owner",
      "That document owner is not valid.",
    );
  }
  const directory = path.join(documentBlobRoot(configured), `u${userId}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function newDocumentBlobId(): string {
  return `doc_${crypto.randomUUID().replaceAll("-", "")}`;
}

function blobFileName(blobId: string, format: DocumentAttachmentFormat): string {
  if (!isDocumentBlobId(blobId)) {
    throw new DocumentBlobError(400, "invalid_document_blob_id", "That document id is not valid.");
  }
  if (!isDocumentAttachmentFormat(format)) {
    throw new DocumentBlobError(
      400,
      "invalid_document_format",
      "That document format is not supported.",
    );
  }
  return `${blobId}.${format}`;
}

export function documentBlobPath(input: {
  userId: number;
  blobId: string;
  format: DocumentAttachmentFormat;
  root?: string;
}): string {
  return path.join(
    userDirectory(input.userId, input.root),
    blobFileName(input.blobId, input.format),
  );
}

/** The sidecar directory holding this document's extracted figures. */
export function documentFiguresDirectory(input: {
  userId: number;
  blobId: string;
  root?: string;
}): string {
  if (!isDocumentBlobId(input.blobId)) {
    throw new DocumentBlobError(400, "invalid_document_blob_id", "That document id is not valid.");
  }
  return path.join(userDirectory(input.userId, input.root), `${input.blobId}.figures`);
}

/**
 * Stream an upload to disk and return the pointer the message will carry.
 *
 * The cap is enforced on the bytes as they pass rather than on the declared
 * content-length, because the header is a claim and the stream is the fact.
 */
export async function writeDocumentBlob(input: {
  userId: number;
  format: DocumentAttachmentFormat;
  body: ReadableStream<Uint8Array>;
  root?: string;
}): Promise<StoredDocumentBlob> {
  const blobId = newDocumentBlobId();
  const finalPath = documentBlobPath({
    userId: input.userId,
    blobId,
    format: input.format,
    root: input.root,
  });
  const temporaryPath = `${finalPath}.part`;

  let written = 0;
  const digest = crypto.createHash("sha256");
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      digest.update(chunk);
      if (written > MAX_DOCUMENT_ATTACHMENT_BYTES) {
        controller.error(
          new DocumentBlobError(
            413,
            "document_too_large",
            `That document is larger than ${MAX_DOCUMENT_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
          ),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(
        input.body.pipeThrough(cap) as Parameters<typeof Readable.fromWeb>[0],
      ),
      fs.createWriteStream(temporaryPath),
    );
    if (written === 0) {
      throw new DocumentBlobError(400, "document_empty", "That document file is empty.");
    }
    await fsp.rename(temporaryPath, finalPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof DocumentBlobError) throw error;
    throw new DocumentBlobError(
      400,
      "document_upload_interrupted",
      "The document upload was interrupted.",
    );
  }

  return { blobId, format: input.format, byteSize: written, path: finalPath, sha256: digest.digest("hex") };
}

/**
 * Write the figures an extractor lifted out of a document.
 *
 * Names are generated here rather than taken from the zip: an entry name inside
 * an OOXML package is attacker-controlled, and `word/media/../../../x` is a
 * legal string.
 */
export function writeDocumentFigures(input: {
  userId: number;
  blobId: string;
  figures: readonly { extension: string; bytes: Buffer }[];
  root?: string;
}): string[] {
  if (!input.figures.length) return [];
  const directory = documentFiguresDirectory({
    userId: input.userId,
    blobId: input.blobId,
    root: input.root,
  });
  fs.mkdirSync(directory, { recursive: true });
  const written: string[] = [];
  input.figures.forEach((figure, index) => {
    const extension = /^[a-z0-9]{1,5}$/i.test(figure.extension)
      ? figure.extension.toLowerCase()
      : "bin";
    const name = `figure-${index + 1}.${extension}`;
    try {
      fs.writeFileSync(path.join(directory, name), figure.bytes);
      written.push(name);
    } catch {
      // A figure that will not write is not worth failing an upload over; the
      // extracted text still names it.
    }
  });
  return written;
}

/** One extracted figure's bytes, or null when it is not this user's. */
export function readDocumentFigure(input: {
  userId: number;
  blobId: string;
  name: string;
  root?: string;
}): { buffer: Buffer; name: string } | null {
  if (!/^figure-\d{1,4}\.[a-z0-9]{1,5}$/i.test(input.name)) return null;
  const directory = documentFiguresDirectory({
    userId: input.userId,
    blobId: input.blobId,
    root: input.root,
  });
  const candidate = path.join(directory, input.name);
  // The name pattern above already forbids a separator, so this is the second
  // of two checks rather than the only one.
  if (!candidate.startsWith(path.resolve(directory) + path.sep)) return null;
  try {
    return { buffer: fs.readFileSync(candidate), name: input.name };
  } catch {
    return null;
  }
}

/** Every figure written for one document, in the order they appear in it. */
export function listDocumentFigures(input: {
  userId: number;
  blobId: string;
  root?: string;
}): string[] {
  try {
    const directory = documentFiguresDirectory(input);
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^figure-\d{1,4}\./i.test(entry.name))
      .map((entry) => entry.name)
      .sort(
        (left, right) =>
          Number(left.match(/\d+/)?.[0] ?? 0) - Number(right.match(/\d+/)?.[0] ?? 0),
      );
  } catch {
    return [];
  }
}

/**
 * The stored file, but only under the uploader's own directory. Null reads as
 * "not found" — the same answer a blob belonging to somebody else gives.
 */
export function findDocumentBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): StoredDocumentBlob | null {
  if (!isDocumentBlobId(input.blobId)) return null;
  const directory = userDirectory(input.userId, input.root);
  // A stat per candidate format rather than a directory listing, so the lookup
  // costs the same whether the user has stored one document or a thousand.
  for (const format of DOCUMENT_ATTACHMENT_EXTENSIONS) {
    const candidate = path.join(directory, `${input.blobId}.${format}`);
    const stats = fs.statSync(candidate, { throwIfNoEntry: false });
    if (stats?.isFile()) {
      return { blobId: input.blobId, format, byteSize: stats.size, path: candidate };
    }
  }
  return null;
}

/**
 * A chat's own copy of a document the server already stores, such as a PDF
 * opened from the + button. A hard link costs no space and no time, and gives
 * the chat a blob the opened file's 30-day sweep cannot remove. A volume that
 * refuses links gets a real copy.
 */
export function linkDocumentBlob(input: {
  userId: number;
  source: StoredDocumentBlob;
  root?: string;
}): StoredDocumentBlob {
  const blobId = newDocumentBlobId();
  const target = documentBlobPath({ userId: input.userId, blobId, format: input.source.format, root: input.root });
  try {
    fs.linkSync(input.source.path, target);
  } catch {
    fs.copyFileSync(input.source.path, target, fs.constants.COPYFILE_EXCL);
  }
  return { blobId, format: input.source.format, byteSize: input.source.byteSize, path: target };
}

export function removeDocumentBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): boolean {
  const blob = findDocumentBlob(input);
  if (!blob) return false;
  const base = blob.path.slice(0, blob.path.length - path.extname(blob.path).length);
  try {
    fs.rmSync(blob.path, { force: true });
    fs.rmSync(`${blob.path}.reading.json`, { force: true });
    fs.rmSync(`${blob.path}${WEB_PDF_MARKER}`, { force: true });
    fs.rmSync(
      documentFiguresDirectory({ userId: input.userId, blobId: input.blobId, root: input.root }),
      { recursive: true, force: true },
    );
    // ColPali's sidecars: the cached page pictures and the index status. Both
    // are derived from bytes that no longer exist, and a page cache outliving
    // its document is the one way this directory grows without bound.
    fs.rmSync(`${base}.pages`, { recursive: true, force: true });
    fs.rmSync(`${base}.colpali.json`, { force: true });
  } catch {
    return false;
  }
  // The vectors themselves live in the service, not here. Fire-and-forget: a
  // service that is down must not fail a delete, and its index is unreachable
  // once the blob is gone in any case.
  void forgetColpaliIndex(input.blobId);
  return true;
}

export interface DocumentBlobFile {
  blobId: string;
  format: DocumentAttachmentFormat;
  path: string;
  modifiedAt: number;
}

/** Every stored document this user owns, for the lifetime sweep to judge. */
export function listDocumentBlobs(userId: number, root?: string): DocumentBlobFile[] {
  const directory = userDirectory(userId, root);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isFile()) return [];
      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) return [];
      const blobId = entry.name.slice(0, dot);
      const format = entry.name.slice(dot + 1);
      if (!isDocumentBlobId(blobId) || !isDocumentAttachmentFormat(format)) return [];
      const filePath = path.join(directory, entry.name);
      const stats = fs.statSync(filePath, { throwIfNoEntry: false });
      if (!stats?.isFile()) return [];
      return [{ blobId, format, path: filePath, modifiedAt: stats.mtimeMs }];
    });
}

/**
 * PDFs the desktop browser opened in Breadboard's viewer instead of Chromium's.
 * They carry an empty `.web` sidecar whose mtime is the last time the viewer
 * opened them; one left unopened for 30 days is swept. Chat attachments never
 * get the sidecar, so the sweep cannot touch them.
 */
const WEB_PDF_MARKER = ".web";
export const WEB_PDF_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function markWebPdfBlob(blob: { path: string }): void {
  fs.writeFileSync(`${blob.path}${WEB_PDF_MARKER}`, "");
}

/** Opening a web PDF in the viewer keeps it for another lifetime. */
export function touchWebPdfBlob(blob: { path: string }): void {
  const now = new Date();
  try {
    fs.utimesSync(`${blob.path}${WEB_PDF_MARKER}`, now, now);
  } catch {
    // Not a web PDF, or already swept.
  }
}

export function isMarkedWebBlob(blob: { path: string }): boolean {
  return fs.existsSync(`${blob.path}${WEB_PDF_MARKER}`);
}

/**
 * The same lifetime for any store's blobs: images and videos opened from a new
 * tab carry the marker too, so one Settings switch governs all of them.
 */
export function sweepMarkedBlobs<T extends { path: string }>(blobs: T[], remove: (blob: T) => boolean, now = Date.now()): number {
  let removed = 0;
  for (const blob of blobs) {
    const marker = fs.statSync(`${blob.path}${WEB_PDF_MARKER}`, { throwIfNoEntry: false });
    if (marker && now - marker.mtimeMs > WEB_PDF_LIFETIME_MS && remove(blob)) {
      fs.rmSync(`${blob.path}${WEB_PDF_MARKER}`, { force: true });
      removed++;
    }
  }
  return removed;
}

export function sweepWebPdfBlobs(userId: number, root?: string, now = Date.now()): number {
  return sweepMarkedBlobs(listDocumentBlobs(userId, root), blob => removeDocumentBlob({ userId, blobId: blob.blobId, root }), now);
}
