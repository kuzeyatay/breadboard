// Videos chosen in the composer, before a run exists.
//
// The agent takes a video, and one of the two ways to give it one is a file on
// your own machine. A browser cannot hand a path to the server — and must not
// be trusted with one anyway, because a path from a page is a way to make the
// server open anything it can reach. So the file is uploaded, stored here under
// an id this module invents, and the run addresses it by that id.
//
// Uploads are scoped to the user who made them and pruned by age: they are the
// input to a run, not a library, and the artifacts a run produces are what
// stays.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";
import { SHORTS_UPLOAD_EXTENSIONS } from "./uploads-accept.ts";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set<string>(SHORTS_UPLOAD_EXTENSIONS);

const RETENTION_MS = 24 * 60 * 60 * 1000;
const UPLOAD_ID = /^[a-f0-9]{32}$/;

export class UploadError extends Error {
  // Written as a field rather than a constructor parameter property: this
  // module is imported by the test runner, which strips types rather than
  // compiling them and cannot execute a parameter property.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function uploadsRoot(): string {
  return path.join(dashboardDataDir(), "shorts-uploads");
}

/**
 * One user's directory. The user id is in the path so a stored file can never
 * be read by anyone else even if an id leaks: the lookup only ever looks in the
 * caller's own directory.
 *
 * Only the write path creates it. Reading is a lookup, and a lookup that makes
 * a directory leaves one behind on every miss.
 */
function userRoot(userId: number): string {
  return path.join(uploadsRoot(), String(userId));
}

function ensureUserRoot(userId: number): string {
  const root = userRoot(userId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function extensionFor(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isSupportedVideoName(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionFor(filename));
}

export interface StoredUpload {
  uploadId: string;
  filename: string;
  sizeBytes: number;
}

/**
 * Store one uploaded video and return the id the run will address it by. The
 * stored name is the id plus the original extension — the original filename is
 * kept only in the request, where it is shown, never used as a path.
 */
export function storeUpload(input: {
  userId: number;
  filename: string;
  bytes: Buffer;
}): StoredUpload {
  const extension = extensionFor(input.filename);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new UploadError(
      415,
      `${extension || "That file"} is not a video format this agent can read.`,
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new UploadError(400, "That file is empty.");
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(413, "That video is larger than 2 GB.");
  }
  pruneExpired(input.userId);
  const uploadId = randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(ensureUserRoot(input.userId), `${uploadId}${extension}`), input.bytes);
  return {
    uploadId,
    filename: path.basename(input.filename).slice(0, 200) || `video${extension}`,
    sizeBytes: input.bytes.byteLength,
  };
}

/** The stored file for an id, or null when it has expired or never existed. */
export function resolveUpload(userId: number, uploadId: string): string | null {
  if (!UPLOAD_ID.test(uploadId)) return null;
  const root = userRoot(userId);
  for (const extension of ALLOWED_EXTENSIONS) {
    const candidate = path.join(root, `${uploadId}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Drop uploads older than the retention window. Never throws. */
export function pruneExpired(userId: number): void {
  try {
    const root = userRoot(userId);
    const cutoff = Date.now() - RETENTION_MS;
    for (const entry of fs.readdirSync(root)) {
      const file = path.join(root, entry);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
      } catch {
        // A file that vanished under us needs no removing.
      }
    }
  } catch {
    // Pruning is housekeeping; a failure must never stop an upload.
  }
}
