// User-scoped, short-lived source photos for Formsmith runs.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  FORMSMITH_IMAGE_EXTENSIONS,
  MAX_FORMSMITH_IMAGE_BYTES,
} from "./identity.ts";

const ALLOWED_EXTENSIONS = new Set<string>(FORMSMITH_IMAGE_EXTENSIONS);
const UPLOAD_ID = /^[a-f0-9]{32}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export class FormsmithUploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function uploadsRoot(): string {
  return path.join(dashboardDataDir(), "formsmith-uploads");
}

function userRoot(userId: number): string {
  return path.join(uploadsRoot(), String(userId));
}

function ensureUserRoot(userId: number): string {
  const root = userRoot(userId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function imageExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isSupportedImageName(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(imageExtension(filename));
}

function hasSupportedMagic(bytes: Buffer): boolean {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return jpeg || png || webp;
}

export interface StoredFormsmithUpload {
  uploadId: string;
  filename: string;
  sizeBytes: number;
}

export function storeFormsmithUpload(input: {
  userId: number;
  filename: string;
  bytes: Buffer;
}): StoredFormsmithUpload {
  const extension = imageExtension(input.filename);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new FormsmithUploadError(415, "Formsmith accepts only JPEG, PNG, or WebP pictures.");
  }
  if (!input.bytes.length) throw new FormsmithUploadError(400, "That picture is empty.");
  if (input.bytes.length > MAX_FORMSMITH_IMAGE_BYTES) {
    throw new FormsmithUploadError(413, "Pictures must be 20 MB or smaller.");
  }
  if (!hasSupportedMagic(input.bytes)) {
    throw new FormsmithUploadError(415, "The file extension says image, but its contents are not JPEG, PNG, or WebP.");
  }
  pruneExpiredFormsmithUploads(input.userId);
  const uploadId = randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(ensureUserRoot(input.userId), `${uploadId}${extension}`), input.bytes);
  return {
    uploadId,
    filename: path.basename(input.filename).slice(0, 200) || `picture${extension}`,
    sizeBytes: input.bytes.length,
  };
}

export function resolveFormsmithUpload(userId: number, uploadId: string): string | null {
  if (!UPLOAD_ID.test(uploadId)) return null;
  for (const extension of ALLOWED_EXTENSIONS) {
    const candidate = path.join(userRoot(userId), `${uploadId}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function pruneExpiredFormsmithUploads(userId: number): void {
  try {
    const root = userRoot(userId);
    const cutoff = Date.now() - RETENTION_MS;
    for (const entry of fs.readdirSync(root)) {
      const candidate = path.join(root, entry);
      if (fs.statSync(candidate).mtimeMs < cutoff) fs.rmSync(candidate, { force: true });
    }
  } catch {
    // Housekeeping must not block a new upload.
  }
}
