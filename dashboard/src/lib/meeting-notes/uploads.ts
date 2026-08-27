// Where a meeting recording waits between the upload and the run.
//
// A live capture and a dropped file arrive the same way: the browser streams
// bytes at the upload route, and the run that reads them starts a moment later
// as a separate request. Something has to hold the file in between, and it is
// not the chat video store next door — that one only accepts video containers,
// and a meeting recording is usually `.webm` audio, an `.m4a` from a phone, or a
// `.wav` off a recorder.
//
// The store is deliberately thin. The uploader's id is a directory level, so
// ownership is a property of the path and a recording nobody here uploaded
// simply is not there to find — the same trick the video blob store uses, for
// the same reason: no table, so nothing to drift out of step with the files.

import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { isMeetingUploadId, MEETING_FILENAME_HEADER } from "./identity.ts";

const fsp = fs.promises;

export { MEETING_FILENAME_HEADER };

/** Two gigabytes, the same ceiling the recording upload uses. */
export const MAX_MEETING_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Extensions kept as-is. Anything else is stored under `.bin` and handed to
 * ffmpeg, which reads containers by inspecting them rather than by trusting a
 * name. The list exists to keep a filename from the browser out of a path, not
 * to decide what can be transcribed.
 */
const KNOWN_EXTENSIONS = new Set([
  "webm", "wav", "mp3", "m4a", "mp4", "ogg", "opus", "flac", "aac", "mov", "mkv", "wma", "amr",
]);

export class MeetingUploadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MeetingUploadError";
    this.status = status;
    this.code = code;
  }
}

export function newMeetingUploadId(): string {
  return `mrec_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function meetingUploadRoot(configured?: string): string {
  const root = path.resolve(
    configured ??
      process.env.BREADBOARD_MEETING_RECORDING_DIR?.trim() ??
      path.join(dashboardDataDir(), "meeting-recordings"),
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function userDirectory(userId: number, configured?: string): string {
  if (!Number.isInteger(userId) || userId < 0) {
    throw new MeetingUploadError(400, "invalid_owner", "That recording owner is not valid.");
  }
  const directory = path.join(meetingUploadRoot(configured), `u${userId}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/** Only the generated id and a vetted extension ever reach a path. */
export function meetingUploadExtension(filename: string): string {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1).replace(/[^a-z0-9]/g, "") : "";
  return KNOWN_EXTENSIONS.has(extension) ? extension : "bin";
}

export interface StoredMeetingRecording {
  uploadId: string;
  filename: string;
  byteSize: number;
  path: string;
}

/**
 * Stream an upload to disk without ever holding it whole, and only then give it
 * its real name — an upload that dies halfway can never be read as a recording.
 *
 * The cap is enforced on the bytes as they pass rather than on the declared
 * content-length, because the header is a claim and the stream is the fact.
 */
export async function writeMeetingUpload(input: {
  userId: number;
  body: ReadableStream<Uint8Array> | null;
  filename: string;
  root?: string;
}): Promise<StoredMeetingRecording> {
  if (!input.body) {
    throw new MeetingUploadError(400, "no_recording", "No recording was received.");
  }
  const directory = userDirectory(input.userId, input.root);
  const uploadId = newMeetingUploadId();
  const extension = meetingUploadExtension(input.filename);
  const finalPath = path.join(directory, `${uploadId}.${extension}`);
  const partial = `${finalPath}.part`;

  let written = 0;
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > MAX_MEETING_RECORDING_BYTES) {
        controller.error(
          new MeetingUploadError(413, "recording_too_large", "That recording is larger than 2 GB."),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(input.body.pipeThrough(cap) as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(partial),
    );
  } catch (error) {
    await fsp.rm(partial, { force: true }).catch(() => undefined);
    if (error instanceof MeetingUploadError) throw error;
    throw new MeetingUploadError(400, "upload_interrupted", "The recording upload was interrupted.");
  }

  if (written === 0) {
    await fsp.rm(partial, { force: true }).catch(() => undefined);
    throw new MeetingUploadError(400, "empty_recording", "That recording is empty.");
  }
  await fsp.rename(partial, finalPath);
  return {
    uploadId,
    filename: input.filename.trim().slice(0, 260) || `recording.${extension}`,
    byteSize: written,
    path: finalPath,
  };
}

/** The staged recording this id names, or null when this user has no such file. */
export function findMeetingUpload(input: {
  userId: number;
  uploadId: string;
  root?: string;
}): { path: string; byteSize: number } | null {
  if (!isMeetingUploadId(input.uploadId)) return null;
  const directory = userDirectory(input.userId, input.root);
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(`${input.uploadId}.`) || name.endsWith(".part")) continue;
    const file = path.join(directory, name);
    const stat = fs.statSync(file);
    if (stat.isFile()) return { path: file, byteSize: stat.size };
  }
  return null;
}

export function removeMeetingUpload(input: {
  userId: number;
  uploadId: string;
  root?: string;
}): void {
  const found = findMeetingUpload(input);
  if (found) fs.rmSync(found.path, { force: true });
}

/**
 * Drop staged recordings older than a day, and any half-written part file.
 *
 * A recording is transcribed within minutes of arriving and is worthless
 * afterwards — the durable form is the artifact the run writes. Left alone these
 * would be the largest thing Breadboard ever puts on disk, so the upload route
 * sweeps on every new upload.
 */
export function sweepMeetingUploads(input: { userId: number; root?: string; maxAgeMs?: number }): number {
  const directory = userDirectory(input.userId, input.root);
  const cutoff = Date.now() - (input.maxAgeMs ?? 24 * 60 * 60 * 1000);
  let removed = 0;
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs > cutoff) continue;
      fs.rmSync(file, { force: true });
      removed += 1;
    } catch {
      // A file that vanished under us needed removing anyway.
    }
  }
  return removed;
}
