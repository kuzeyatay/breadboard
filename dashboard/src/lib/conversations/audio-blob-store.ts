// Where an attached song's bytes live on disk.
//
// The same shape as the video store next door, and for the same reason: the
// uploader's id is a directory level, so ownership is a property of the path
// and a blob nobody here uploaded simply is not there to find. No table,
// therefore no migration and nothing that can drift out of step with the files.
//
// Bytes are streamed to a temporary name and renamed into place, so an upload
// that dies halfway can never be read as a whole track. Only the generated id
// and a format from the fixed list ever appear in a path — never the name the
// browser sent.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  isAudioAttachmentFormat,
  isAudioBlobId,
  MAX_AUDIO_ATTACHMENT_BYTES,
  AUDIO_ATTACHMENT_EXTENSIONS,
  type AudioAttachmentFormat,
} from "../audio-attachments.ts";

export class AudioBlobError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AudioBlobError";
    this.code = code;
    this.status = status;
  }
}

export interface StoredAudioBlob {
  blobId: string;
  format: AudioAttachmentFormat;
  byteSize: number;
  path: string;
}

export function audioBlobRoot(configured?: string): string {
  const root = path.resolve(
    configured ?? process.env.BREADBOARD_CHAT_AUDIO_DIR?.trim() ??
      path.join(dashboardDataDir(), "chat-audio"),
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** One directory per uploader; the id in the path is the whole access check. */
function userDirectory(userId: number, configured?: string): string {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new AudioBlobError(400, "invalid_audio_owner", "That audio owner is not valid.");
  }
  const directory = path.join(audioBlobRoot(configured), `u${userId}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function newAudioBlobId(): string {
  return `aud_${crypto.randomUUID().replaceAll("-", "")}`;
}

function blobFileName(blobId: string, format: AudioAttachmentFormat): string {
  if (!isAudioBlobId(blobId)) {
    throw new AudioBlobError(400, "invalid_audio_blob_id", "That audio id is not valid.");
  }
  if (!isAudioAttachmentFormat(format)) {
    throw new AudioBlobError(400, "invalid_audio_format", "That audio format is not supported.");
  }
  return `${blobId}.${format}`;
}

export function audioBlobPath(input: {
  userId: number;
  blobId: string;
  format: AudioAttachmentFormat;
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
export async function writeAudioBlob(input: {
  userId: number;
  format: AudioAttachmentFormat;
  body: ReadableStream<Uint8Array>;
  root?: string;
}): Promise<StoredAudioBlob> {
  const blobId = newAudioBlobId();
  const finalPath = audioBlobPath({
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
      if (written > MAX_AUDIO_ATTACHMENT_BYTES) {
        controller.error(
          new AudioBlobError(413, "audio_too_large", "That audio file is larger than 512 MB."),
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
      throw new AudioBlobError(400, "audio_empty", "That audio file is empty.");
    }
    await fsp.rename(temporaryPath, finalPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof AudioBlobError) throw error;
    throw new AudioBlobError(400, "audio_upload_interrupted", "The audio upload was interrupted.");
  }

  return { blobId, format: input.format, byteSize: written, path: finalPath };
}

/**
 * The stored file, but only under the uploader's own directory. Null reads as
 * "not found" — the same answer a blob belonging to somebody else gives.
 */
export function findAudioBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): StoredAudioBlob | null {
  if (!isAudioBlobId(input.blobId)) return null;
  const directory = userDirectory(input.userId, input.root);
  // A stat per candidate format rather than a directory listing, so the lookup
  // costs the same whether the user has stored one track or a thousand.
  for (const format of AUDIO_ATTACHMENT_EXTENSIONS) {
    const candidate = path.join(directory, `${input.blobId}.${format}`);
    const stats = fs.statSync(candidate, { throwIfNoEntry: false });
    if (stats?.isFile()) {
      return { blobId: input.blobId, format, byteSize: stats.size, path: candidate };
    }
  }
  return null;
}

export function removeAudioBlob(input: {
  userId: number;
  blobId: string;
  root?: string;
}): boolean {
  const blob = findAudioBlob(input);
  if (!blob) return false;
  try {
    fs.rmSync(blob.path, { force: true });
    return true;
  } catch {
    return false;
  }
}

export interface AudioBlobFile {
  blobId: string;
  format: AudioAttachmentFormat;
  path: string;
  modifiedAt: number;
}

/** Every stored track this user owns, for the lifetime sweep to judge. */
export function listAudioBlobs(userId: number, root?: string): AudioBlobFile[] {
  const directory = userDirectory(userId, root);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isFile()) return [];
      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) return [];
      const blobId = entry.name.slice(0, dot);
      const format = entry.name.slice(dot + 1);
      if (!isAudioBlobId(blobId) || !isAudioAttachmentFormat(format)) return [];
      const filePath = path.join(directory, entry.name);
      const stats = fs.statSync(filePath, { throwIfNoEntry: false });
      if (!stats?.isFile()) return [];
      return [{ blobId, format, path: filePath, modifiedAt: stats.mtimeMs }];
    });
}
