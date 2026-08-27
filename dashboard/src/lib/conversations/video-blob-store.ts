// Where an attached video's bytes live on disk.
//
// The 3D-model store next door needs a table to say whose a blob is, because a
// mesh is previewable from the composer before any message exists. A video
// borrows the same idea with less machinery: the uploader's id is a directory
// level, so ownership is a property of the path and a blob nobody here uploaded
// simply is not there to find. No table, therefore no migration and nothing that
// can drift out of step with the files.
//
// Bytes are streamed to a temporary name and renamed into place, so an upload
// that dies halfway can never be read as a whole video. Only the generated id
// and a format from the fixed list ever appear in a path — never the name the
// browser sent.

import crypto from "node:crypto";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  isVideoAttachmentFormat,
  isVideoBlobId,
  MAX_VIDEO_ATTACHMENT_BYTES,
  VIDEO_ATTACHMENT_EXTENSIONS,
  type VideoAttachmentFormat,
} from "../video-attachments.ts";

const fsp = fs.promises;

export class VideoBlobError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "VideoBlobError";
    this.code = code;
    this.status = status;
  }
}

export interface StoredVideoBlob {
  blobId: string;
  format: VideoAttachmentFormat;
  byteSize: number;
  path: string;
}

export function videoBlobRoot(configured?: string): string {
  const root = path.resolve(
    configured ?? process.env.BREADBOARD_CHAT_VIDEO_DIR?.trim() ??
      path.join(dashboardDataDir(), "chat-videos"),
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** One directory per uploader; the id in the path is the whole access check. */
function userDirectory(userId: number, configured?: string): string {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new VideoBlobError(400, "invalid_video_owner", "That video owner is not valid.");
  }
  const directory = path.join(videoBlobRoot(configured), `u${userId}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function newVideoBlobId(): string {
  return `vid_${crypto.randomUUID().replaceAll("-", "")}`;
}

function blobFileName(blobId: string, format: VideoAttachmentFormat): string {
  if (!isVideoBlobId(blobId)) {
    throw new VideoBlobError(400, "invalid_video_blob_id", "That video id is not valid.");
  }
  if (!isVideoAttachmentFormat(format)) {
    throw new VideoBlobError(400, "invalid_video_format", "That video format is not supported.");
  }
  return `${blobId}.${format}`;
}

export function videoBlobPath(input: {
  userId: number;
  blobId: string;
  format: VideoAttachmentFormat;
  root?: string;
}): string {
  return path.join(
    userDirectory(input.userId, input.root),
    blobFileName(input.blobId, input.format),
  );
}

/**
 * Stream an upload to disk and return the pointer the message will carry.
 *
 * The cap is enforced on the bytes as they pass rather than on the declared
 * content-length, because the header is a claim and the stream is the fact.
 */
export async function writeVideoBlob(input: {
  userId: number;
  format: VideoAttachmentFormat;
  body: ReadableStream<Uint8Array>;
  root?: string;
}): Promise<StoredVideoBlob> {
  const blobId = newVideoBlobId();
  const finalPath = videoBlobPath({
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
      if (written > MAX_VIDEO_ATTACHMENT_BYTES) {
        controller.error(
          new VideoBlobError(413, "video_too_large", "That video is larger than 2 GB."),
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
      throw new VideoBlobError(400, "video_empty", "That video file is empty.");
    }
    await fsp.rename(temporaryPath, finalPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof VideoBlobError) throw error;
    throw new VideoBlobError(400, "video_upload_interrupted", "The video upload was interrupted.");
  }

  return { blobId, format: input.format, byteSize: written, path: finalPath };
}

/**
 * Take a file the server itself produced and make it one of this user's videos.
 *
 * The upload path above streams from a browser and has to police every byte on
 * the way past; this one is handed a finished file that Breadboard fetched, so
 * the size is a fact rather than a claim and the move is a rename when the
 * temporary directory happens to share a volume.
 *
 * Used by the linked-video downloader: once a URL has been fetched, the result
 * is an ordinary attachment, which is what lets the rest of the app treat a
 * pasted link and a dragged file as the same thing.
 */
export async function adoptVideoBlob(input: {
  userId: number;
  filePath: string;
  format: VideoAttachmentFormat;
  root?: string;
}): Promise<StoredVideoBlob> {
  const stats = await fsp.stat(input.filePath);
  if (!stats.isFile() || stats.size === 0) {
    throw new VideoBlobError(400, "video_empty", "That video file is empty.");
  }
  if (stats.size > MAX_VIDEO_ATTACHMENT_BYTES) {
    throw new VideoBlobError(413, "video_too_large", "That video is larger than 2 GB.");
  }

  const blobId = newVideoBlobId();
  const finalPath = videoBlobPath({
    userId: input.userId,
    blobId,
    format: input.format,
    root: input.root,
  });
  try {
    await fsp.rename(input.filePath, finalPath);
  } catch {
    // A different volume; copy and drop the original instead.
    await fsp.copyFile(input.filePath, finalPath);
    await fsp.rm(input.filePath, { force: true }).catch(() => undefined);
  }
  return { blobId, format: input.format, byteSize: stats.size, path: finalPath };
}

/**
 * The stored file, but only under the uploader's own directory. Null reads as
 * "not found" — the same answer a blob belonging to somebody else gives.
 */
export function findVideoBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): StoredVideoBlob | null {
  if (!isVideoBlobId(input.blobId)) return null;
  const directory = userDirectory(input.userId, input.root);
  // A stat per candidate format rather than a directory listing, so the lookup
  // costs the same whether the user has stored one video or a thousand.
  for (const format of VIDEO_ATTACHMENT_EXTENSIONS) {
    const candidate = path.join(directory, `${input.blobId}.${format}`);
    const stats = fs.statSync(candidate, { throwIfNoEntry: false });
    if (stats?.isFile()) {
      return { blobId: input.blobId, format, byteSize: stats.size, path: candidate };
    }
  }
  return null;
}

export function removeVideoBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): boolean {
  const blob = findVideoBlob(input);
  if (!blob) return false;
  try {
    fs.rmSync(blob.path, { force: true });
    return true;
  } catch {
    return false;
  }
}

export interface VideoBlobFile {
  blobId: string;
  format: VideoAttachmentFormat;
  path: string;
  modifiedAt: number;
}

/** Every stored video this user owns, for the lifetime sweep to judge. */
export function listVideoBlobs(userId: number, root?: string): VideoBlobFile[] {
  const directory = userDirectory(userId, root);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isFile()) return [];
      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) return [];
      const blobId = entry.name.slice(0, dot);
      const format = entry.name.slice(dot + 1);
      if (!isVideoBlobId(blobId) || !isVideoAttachmentFormat(format)) return [];
      const filePath = path.join(directory, entry.name);
      const stats = fs.statSync(filePath, { throwIfNoEntry: false });
      if (!stats?.isFile()) return [];
      return [{ blobId, format, path: filePath, modifiedAt: stats.mtimeMs }];
    });
}
