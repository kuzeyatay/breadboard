// Where an attached 3D model's bytes live on disk.
//
// Attachments otherwise keep no bytes — a document is extracted at send time and
// only its name survives (see uploads.ts). A mesh has nothing to extract, so
// this is the one attachment kind with real storage behind it. The message still
// owns the file: the transcript records a blob id, and the id is only readable
// through a message the caller owns, so this store holds bytes and no authority.
//
// Paths are built from a generated id and a format drawn from a fixed list —
// never from the name the browser sent. Writes are atomic (temp file + rename)
// and hashed on the way in, so a half-written upload can never be served whole.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  isModelAttachmentFormat,
  isModelBlobId,
  MAX_MODEL_ATTACHMENT_BYTES,
  type ModelAttachmentFormat,
} from "../model-attachments.ts";

export class ModelBlobError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ModelBlobError";
    this.code = code;
    this.status = status;
  }
}

export function modelBlobRoot(configured?: string): string {
  const root = path.resolve(configured ?? path.join(dashboardDataDir(), "chat-models"));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function newModelBlobId(): string {
  return `mdl_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * `ab/mdl_….glb` — sharded on the first two id characters so a data directory
 * with thousands of attachments still lists in reasonable time.
 */
function blobRelativePath(blobId: string, format: ModelAttachmentFormat): string {
  if (!isModelBlobId(blobId)) {
    throw new ModelBlobError(400, "invalid_model_blob_id", "That model id is not valid.");
  }
  if (!isModelAttachmentFormat(format)) {
    throw new ModelBlobError(400, "invalid_model_format", "That model format is not supported.");
  }
  const shard = blobId.slice(4, 6);
  return path.posix.join(shard, `${blobId}.${format}`);
}

/** Resolve a stored relative path and refuse anything that leaves the root. */
function resolveBlobPath(root: string, relative: string): string {
  const target = path.resolve(root, ...relative.split("/"));
  const rest = path.relative(root, target);
  if (rest.startsWith("..") || path.isAbsolute(rest)) {
    throw new ModelBlobError(500, "invalid_model_storage", "Model storage escaped its controlled root.");
  }
  return target;
}

export interface StoredModelBlob {
  blobId: string;
  format: ModelAttachmentFormat;
  byteSize: number;
  sha256: string;
}

export function writeModelBlob(input: {
  format: ModelAttachmentFormat;
  content: Buffer;
  blobId?: string;
  storageRoot?: string;
}): StoredModelBlob {
  if (input.content.byteLength === 0) {
    throw new ModelBlobError(400, "empty_model_file", "That 3D file is empty.");
  }
  if (input.content.byteLength > MAX_MODEL_ATTACHMENT_BYTES) {
    throw new ModelBlobError(413, "model_too_large", "That 3D file is too large to attach.");
  }
  const blobId = input.blobId ?? newModelBlobId();
  const root = modelBlobRoot(input.storageRoot);
  const target = resolveBlobPath(root, blobRelativePath(blobId, input.format));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, input.content);
  fs.renameSync(temporary, target);
  return {
    blobId,
    format: input.format,
    byteSize: input.content.byteLength,
    sha256: crypto.createHash("sha256").update(input.content).digest("hex"),
  };
}

export function readModelBlob(input: {
  blobId: string;
  format: ModelAttachmentFormat;
  storageRoot?: string;
}): Buffer {
  const root = modelBlobRoot(input.storageRoot);
  const target = resolveBlobPath(root, blobRelativePath(input.blobId, input.format));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ModelBlobError(404, "model_file_unavailable", "That 3D file is no longer available.");
  }
  return fs.readFileSync(target);
}

export function removeModelBlob(
  blobId: string,
  format: ModelAttachmentFormat,
  storageRoot?: string,
): void {
  try {
    const root = modelBlobRoot(storageRoot);
    fs.rmSync(resolveBlobPath(root, blobRelativePath(blobId, format)), { force: true });
  } catch {
    // A blob may already be gone; the transcript is what the UI reads.
  }
}
