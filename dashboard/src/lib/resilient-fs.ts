import fs from "node:fs";

/**
 * OneDrive and Windows scanners can briefly deny an otherwise valid file open.
 * Five retries plus the initial read gives Learn six bounded attempts without
 * turning a genuinely missing file into a long-running or hidden failure.
 */
export const DEFAULT_FILE_READ_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;

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

export function readFileSyncWithRetry(filePath: fs.PathOrFileDescriptor): Buffer;
export function readFileSyncWithRetry(filePath: fs.PathOrFileDescriptor, encoding: BufferEncoding): string;
export function readFileSyncWithRetry(
  filePath: fs.PathOrFileDescriptor,
  encoding?: BufferEncoding,
): Buffer | string {
  return withTransientFileOpenRetry(() => (
    encoding === undefined
      ? fs.readFileSync(filePath)
      : fs.readFileSync(filePath, encoding)
  ));
}
