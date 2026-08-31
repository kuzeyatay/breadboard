// Filesystem safety helpers for the video transcription pipeline: sanitized
// display filenames, random internal media names, job-scoped temp directories
// with containment checks, atomic Markdown writes, and Windows-tolerant
// deletion with bounded retries.

import crypto from "crypto";
import fs from "fs";
import path from "path";

export const WINDOWS_RESERVED_BASENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export const SUPPORTED_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".m4v",
] as const;

export const SUPPORTED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
] as const;

export const SUPPORTED_MEDIA_EXTENSIONS = [
  ...SUPPORTED_VIDEO_EXTENSIONS,
  ...SUPPORTED_AUDIO_EXTENSIONS,
] as const;

export function isSupportedVideoExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSupportedAudioExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSupportedMediaExtension(filename: string): boolean {
  return isSupportedVideoExtension(filename) || isSupportedAudioExtension(filename);
}

export function mediaKindForFilename(filename: string): "audio" | "video" {
  return isSupportedAudioExtension(filename) ? "audio" : "video";
}

/**
 * Sanitize a user-supplied filename for display and metadata. Strips any
 * directory components (both separators), control characters, and characters
 * Windows forbids; avoids reserved device names; preserves Unicode; bounds
 * length. Never used as an on-disk temp path — see randomMediaFilename.
 */
export function sanitizeDisplayFilename(
  value: unknown,
  fallback = "video",
): string {
  const raw = typeof value === "string" ? value : "";
  // Last path segment only, for either separator style.
  const base = raw.split(/[\\/]/).pop() ?? "";
  let cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // Trailing dots/spaces are invalid on Windows.
    .replace(/[. ]+$/g, "");

  if (!cleaned || cleaned === "." || cleaned === "..") cleaned = fallback;

  const ext = path.extname(cleaned);
  const stem = ext ? cleaned.slice(0, -ext.length) : cleaned;
  const safeStem = WINDOWS_RESERVED_BASENAMES.has(stem.toLowerCase())
    ? `${stem}-file`
    : stem;

  const bounded =
    safeStem.length > 120 ? safeStem.slice(0, 120).trimEnd() : safeStem;
  return `${bounded || fallback}${ext.toLowerCase()}`;
}

/** Human title candidate from an uploaded filename (extension removed). */
export function titleFromFilename(filename: string, fallback = "Video"): string {
  const safe = sanitizeDisplayFilename(filename, fallback);
  const stem = safe.replace(/\.[^.]+$/, "");
  const spaced = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced || fallback;
}

/** Random internal filename for saved media; never derived from user input. */
export function randomMediaFilename(originalFilename: string): string {
  const ext = path.extname(originalFilename).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
  return `media-${crypto.randomBytes(10).toString("hex")}${safeExt}`;
}

/** Throws unless candidate resolves inside root. Guards every delete/write. */
export function assertPathInside(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("Path escapes its containment root");
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  try {
    assertPathInside(root, candidate);
    return true;
  } catch {
    return false;
  }
}

const JOB_DIR_RE = /^[a-z0-9_-]{1,80}$/i;

/** Job-scoped temp directory (created) under the configured temp root. */
export function ensureJobTempDir(tempRoot: string, jobId: string): string {
  if (!JOB_DIR_RE.test(jobId)) throw new Error("Invalid job id for temp dir");
  const dir = path.join(path.resolve(tempRoot), jobId);
  assertPathInside(tempRoot, dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TRANSIENT_DELETE_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY", "UNKNOWN"]);

/**
 * Recursively delete a directory (or file) after verifying it sits inside
 * `root`. Windows file locks (OneDrive scans, antivirus) are retried with
 * bounded backoff; failure is reported, never thrown, so cleanup can never
 * crash a job.
 */
export async function removePathWithRetries(
  target: string,
  {
    root,
    retries = 5,
    baseDelayMs = 100,
  }: { root: string; retries?: number; baseDelayMs?: number },
): Promise<boolean> {
  try {
    assertPathInside(root, target);
  } catch {
    return false;
  }
  if (path.resolve(target) === path.resolve(root)) return false;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2 });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code?.toUpperCase() ?? "";
      if (!TRANSIENT_DELETE_CODES.has(code) || attempt === retries) {
        return false;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  return false;
}

/**
 * Write a file atomically: write to a sibling temp file, then rename over the
 * destination. On Windows, rename over an existing file can transiently fail,
 * so the rename is retried briefly; the temp file is removed on failure so a
 * partial write is never left behind.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  fs.writeFileSync(tempPath, content, "utf8");
  try {
    const attempts = 5;
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(tempPath, filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code?.toUpperCase() ?? "";
        if (!TRANSIENT_DELETE_CODES.has(code) || attempt >= attempts) throw error;
        // Bounded synchronous backoff; rename conflicts resolve quickly.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
      }
    }
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort: never mask the original failure.
    }
    throw error;
  }
}

/**
 * Sweep the transcription temp root for abandoned job directories older than
 * the retention window. Only direct children matching the job-directory naming
 * pattern are considered, and every deletion re-verifies containment.
 */
export async function sweepStaleTempDirs(
  tempRoot: string,
  retentionHours: number,
  { now = Date.now }: { now?: () => number } = {},
): Promise<number> {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tempRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = now() - retentionHours * 3_600_000;
  for (const entry of entries) {
    if (!entry.isDirectory() || !JOB_DIR_RE.test(entry.name)) continue;
    const dir = path.join(tempRoot, entry.name);
    try {
      const stat = fs.statSync(dir);
      if (stat.mtimeMs > cutoff) continue;
    } catch {
      continue;
    }
    if (await removePathWithRetries(dir, { root: tempRoot })) removed += 1;
  }
  return removed;
}
