// Durable originals for plain/code/HTML/archive chat attachments. The text a
// model reads is still carried with the turn; this store is what makes retry,
// download and "save this upload as an artifact" byte-preserving.

import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  isStoredFileAttachmentFormat,
  isStoredFileBlobId,
  MAX_STORED_FILE_ATTACHMENT_BYTES,
  MAX_STORED_TEXT_FILE_BYTES,
  STORED_FILE_ATTACHMENT_EXTENSIONS,
  storedFileIsText,
  type StoredFileAttachmentFormat,
} from "../stored-file-attachments.ts";

export class StoredFileBlobError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StoredFileBlobError";
    this.code = code;
    this.status = status;
  }
}

export interface StoredFileBlob {
  blobId: string;
  format: StoredFileAttachmentFormat;
  byteSize: number;
  path: string;
}

export function storedFileBlobRoot(configured?: string): string {
  const root = path.resolve(configured ?? path.join(dashboardDataDir(), "chat-files"));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function userDirectory(userId: number, configured?: string): string {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new StoredFileBlobError(400, "invalid_file_owner", "That file owner is not valid.");
  }
  const directory = path.join(storedFileBlobRoot(configured), `u${userId}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function newStoredFileBlobId(): string {
  return `fil_${crypto.randomUUID().replaceAll("-", "")}`;
}

function blobFileName(blobId: string, format: StoredFileAttachmentFormat): string {
  if (!isStoredFileBlobId(blobId)) {
    throw new StoredFileBlobError(400, "invalid_file_blob_id", "That file id is not valid.");
  }
  if (!isStoredFileAttachmentFormat(format)) {
    throw new StoredFileBlobError(400, "invalid_file_format", "That file format is not supported.");
  }
  return `${blobId}.${format}`;
}

export function storedFileBlobPath(input: {
  userId: number;
  blobId: string;
  format: StoredFileAttachmentFormat;
  root?: string;
}): string {
  return path.join(userDirectory(input.userId, input.root), blobFileName(input.blobId, input.format));
}

function validateStoredFile(filePath: string, format: StoredFileAttachmentFormat): void {
  const bytes = fs.readFileSync(filePath);
  if (storedFileIsText(format)) {
    if (bytes.byteLength > MAX_STORED_TEXT_FILE_BYTES) {
      throw new StoredFileBlobError(413, "text_file_too_large", "Text files must be 16 MiB or smaller.");
    }
    if (bytes.includes(0)) {
      throw new StoredFileBlobError(415, "file_not_text", "That file contains binary data.");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new StoredFileBlobError(415, "file_not_utf8", "Text attachments must use UTF-8.");
    }
    return;
  }
  if (format === "zip" && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new StoredFileBlobError(415, "file_signature_invalid", "That file is not a ZIP archive.");
  }
}

export async function writeStoredFileBlob(input: {
  userId: number;
  format: StoredFileAttachmentFormat;
  body: ReadableStream<Uint8Array>;
  root?: string;
}): Promise<StoredFileBlob> {
  const blobId = newStoredFileBlobId();
  const finalPath = storedFileBlobPath({
    userId: input.userId,
    blobId,
    format: input.format,
    root: input.root,
  });
  const temporaryPath = `${finalPath}.part`;
  let written = 0;
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > MAX_STORED_FILE_ATTACHMENT_BYTES) {
        controller.error(
          new StoredFileBlobError(413, "file_too_large", "That file is larger than 128 MiB."),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(input.body.pipeThrough(cap) as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(temporaryPath),
    );
    if (written === 0) {
      throw new StoredFileBlobError(400, "file_empty", "That file is empty.");
    }
    validateStoredFile(temporaryPath, input.format);
    await fs.promises.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof StoredFileBlobError) throw error;
    throw new StoredFileBlobError(400, "file_upload_interrupted", "The file upload was interrupted.");
  }

  return { blobId, format: input.format, byteSize: written, path: finalPath };
}

export function findStoredFileBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): StoredFileBlob | null {
  if (!isStoredFileBlobId(input.blobId)) return null;
  const directory = userDirectory(input.userId, input.root);
  for (const format of STORED_FILE_ATTACHMENT_EXTENSIONS) {
    const candidate = path.join(directory, `${input.blobId}.${format}`);
    const stats = fs.statSync(candidate, { throwIfNoEntry: false });
    if (stats?.isFile()) {
      return { blobId: input.blobId, format, byteSize: stats.size, path: candidate };
    }
  }
  return null;
}

export function removeStoredFileBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): boolean {
  const blob = findStoredFileBlob(input);
  if (!blob) return false;
  try {
    fs.rmSync(blob.path, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function listStoredFileBlobs(userId: number, root?: string): Array<StoredFileBlob & { modifiedAt: number }> {
  const directory = userDirectory(userId, root);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const dot = entry.name.lastIndexOf(".");
    if (dot <= 0) return [];
    const blobId = entry.name.slice(0, dot);
    const format = entry.name.slice(dot + 1);
    if (!isStoredFileBlobId(blobId) || !isStoredFileAttachmentFormat(format)) return [];
    const filePath = path.join(directory, entry.name);
    const stats = fs.statSync(filePath, { throwIfNoEntry: false });
    return stats?.isFile()
      ? [{ blobId, format, byteSize: stats.size, path: filePath, modifiedAt: stats.mtimeMs }]
      : [];
  });
}
