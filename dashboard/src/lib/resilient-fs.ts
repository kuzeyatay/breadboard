import type { PathOrFileDescriptor } from "node:fs";
import crypto from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

/**
 * OneDrive and Windows scanners can briefly deny an otherwise valid file open.
 * Five retries plus the initial read gives Learn six bounded attempts without
 * turning a genuinely missing file into a long-running or hidden failure.
 */
export const DEFAULT_FILE_READ_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;

/**
 * External AI receipt caches are useful across failed runs, but they are not
 * provenance authority. Windows scanners can briefly deny create/link/unlink
 * operations in LOCALAPPDATA, so publishing retries a small bounded sequence
 * before explicitly degrading to an uncached result.
 */
export const DEFAULT_EXTERNAL_CACHE_PUBLISH_RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400] as const;

const TRANSIENT_FILE_OPEN_ERROR_CODES = new Set([
  "UNKNOWN",
  "EBUSY",
  "EPERM",
  "EACCES",
  "EIO",
]);

export interface TransientFileOpenRetryOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => void;
}

export function isTransientFileOpenError(error: unknown): boolean {
  const candidate = error as NodeJS.ErrnoException | undefined;
  const code = candidate?.code?.toUpperCase();
  if (code && TRANSIENT_FILE_OPEN_ERROR_CODES.has(code)) return true;

  // Some Windows/OneDrive failures arrive without a populated `code`, while
  // Node still prefixes the message with UNKNOWN.
  return error instanceof Error && /^UNKNOWN:\s+unknown error,\s+(?:open|read)\b/i.test(error.message);
}

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export interface ExternalCachePublishFileSystem {
  mkdirSync(directoryPath: string, options: { recursive: true }): void;
  readFileSync(filePath: string): Buffer;
  writeFileSync(
    filePath: string,
    content: Buffer,
    options: { flag: "wx"; mode: number },
  ): void;
  linkSync(existingPath: string, newPath: string): void;
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(filePath: string): void;
}

export interface ExternalCacheAtomicPublishOptions {
  finalPath: string;
  content: string | Buffer;
  /** Strictly validates both our candidate bytes and any racing winner. */
  validateWinner: (content: Buffer) => boolean;
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => void;
  randomId?: () => string;
  /** Test seam for deterministic transient/collision simulations. */
  fileSystem?: Partial<ExternalCachePublishFileSystem>;
}

export interface ExternalCacheAtomicPublishResult {
  status: "published" | "winner" | "degraded";
  attempts: number;
  lastErrorCode?: string;
}

const NODE_EXTERNAL_CACHE_FILE_SYSTEM: ExternalCachePublishFileSystem = {
  mkdirSync(directoryPath, options) {
    fs.mkdirSync(directoryPath, options);
  },
  readFileSync(filePath) {
    return fs.readFileSync(filePath);
  },
  writeFileSync(filePath, content, options) {
    fs.writeFileSync(filePath, content, options);
  },
  linkSync(existingPath, newPath) {
    fs.linkSync(existingPath, newPath);
  },
  renameSync(oldPath, newPath) {
    fs.renameSync(oldPath, newPath);
  },
  unlinkSync(filePath) {
    fs.unlinkSync(filePath);
  },
};

function fileErrorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code ? code.toUpperCase() : undefined;
}

function missingFileError(error: unknown): boolean {
  return fileErrorCode(error) === "ENOENT";
}

function exclusiveCreateCollision(error: unknown): boolean {
  return fileErrorCode(error) === "EEXIST";
}

function retryableExternalCachePublishError(error: unknown): boolean {
  return isTransientFileOpenError(error) ||
    missingFileError(error) ||
    exclusiveCreateCollision(error);
}

function safeRandomFileId(randomId: () => string): string {
  const value = randomId().replace(/[^A-Za-z0-9_-]/g, "");
  if (!value) throw new Error("External cache publisher received an empty random file id.");
  return value;
}

function cacheQuarantineDigest(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Atomically publishes an expendable external cache file without overwriting a
 * racing writer. A fully-written unique `wx` temp is hard-linked into place;
 * the final bytes are then reread and strictly validated. Recognized transient
 * Windows failures are retried, and exhaustion returns `degraded` instead of
 * failing the authoritative garden transaction.
 */
export function publishExternalCacheFileAtomically(
  options: ExternalCacheAtomicPublishOptions,
): ExternalCacheAtomicPublishResult {
  const finalPath = path.resolve(options.finalPath);
  const content = Buffer.isBuffer(options.content)
    ? Buffer.from(options.content)
    : Buffer.from(options.content, "utf8");
  if (!options.validateWinner(content)) {
    throw new Error("Refusing to publish an invalid external cache candidate.");
  }

  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_EXTERNAL_CACHE_PUBLISH_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepSync;
  const randomId = options.randomId ?? crypto.randomUUID;
  const fileSystem: ExternalCachePublishFileSystem = {
    ...NODE_EXTERNAL_CACHE_FILE_SYSTEM,
    ...options.fileSystem,
  };
  let lastError: unknown;

  const readWinner = (): { status: "missing" } | { status: "valid" | "invalid"; content: Buffer } => {
    try {
      const existing = fileSystem.readFileSync(finalPath);
      return options.validateWinner(existing)
        ? { status: "valid", content: existing }
        : { status: "invalid", content: existing };
    } catch (error) {
      if (missingFileError(error)) return { status: "missing" };
      throw error;
    }
  };

  const quarantineInvalidWinner = (invalidContent: Buffer): void => {
    const quarantinePath = `${finalPath}.invalid-${cacheQuarantineDigest(invalidContent)}-${safeRandomFileId(randomId)}`;
    fileSystem.renameSync(finalPath, quarantinePath);
  };

  for (let attempt = 0; ; attempt += 1) {
    let temporaryPath: string | undefined;
    try {
      fileSystem.mkdirSync(path.dirname(finalPath), { recursive: true });
      const before = readWinner();
      if (before.status === "valid") {
        return { status: "winner", attempts: attempt + 1 };
      }
      if (before.status === "invalid") quarantineInvalidWinner(before.content);

      temporaryPath = `${finalPath}.${process.pid}.${safeRandomFileId(randomId)}.tmp`;
      fileSystem.writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });

      let published = false;
      try {
        fileSystem.linkSync(temporaryPath, finalPath);
        published = true;
      } catch (error) {
        if (!exclusiveCreateCollision(error)) throw error;
      }

      const after = readWinner();
      if (after.status === "valid") {
        return { status: published ? "published" : "winner", attempts: attempt + 1 };
      }
      if (after.status === "invalid") quarantineInvalidWinner(after.content);
      throw Object.assign(new Error("Atomic external-cache winner was missing or invalid."), {
        code: "EIO",
      });
    } catch (error) {
      lastError = error;
      // A racing process may have completed between the failing operation and
      // this catch. Accept it only after the same strict integrity reread.
      try {
        const winner = readWinner();
        if (winner.status === "valid") {
          return { status: "winner", attempts: attempt + 1 };
        }
      } catch (winnerReadError) {
        lastError = winnerReadError;
      }

      if (!retryableExternalCachePublishError(lastError) || attempt >= retryDelaysMs.length) {
        return {
          status: "degraded",
          attempts: attempt + 1,
          ...(fileErrorCode(lastError) ? { lastErrorCode: fileErrorCode(lastError) } : {}),
        };
      }
      sleep(retryDelaysMs[attempt]);
    } finally {
      if (temporaryPath) {
        try {
          fileSystem.unlinkSync(temporaryPath);
        } catch (error) {
          if (!missingFileError(error)) {
            // The unique name prevents an orphan from colliding with a later
            // attempt. Cache cleanup remains best-effort and non-authoritative.
          }
        }
      }
    }
  }
}

export function withTransientFileOpenRetry<T>(
  operation: () => T,
  options: TransientFileOpenRetryOptions = {},
): T {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_FILE_READ_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepSync;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isTransientFileOpenError(error) || attempt >= retryDelaysMs.length) throw error;
      sleep(retryDelaysMs[attempt]);
    }
  }
}

export function readFileSyncWithRetry(filePath: PathOrFileDescriptor): Buffer;
export function readFileSyncWithRetry(filePath: PathOrFileDescriptor, encoding: BufferEncoding): string;
export function readFileSyncWithRetry(
  filePath: PathOrFileDescriptor,
  encoding?: BufferEncoding,
): Buffer | string {
  return withTransientFileOpenRetry(() => (
    encoding === undefined
      ? fs.readFileSync(filePath)
      : fs.readFileSync(filePath, encoding)
  ));
}
