// Vendored-support shims for the triggers directory. Replaces sim's
// @sim/logger, @sim/utils/id and @sim/utils/object imports with tiny local,
// dependency-free equivalents so the vendored trigger code stays self-contained.
// Isomorphic on purpose: uses only globalThis.crypto, no node:crypto, so a
// trigger definition can be bundled client-side if ever needed.

export interface Logger {
  debug(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  error(message: string, ...meta: unknown[]): void
}

/** Console-backed stand-in for sim's createLogger. */
export function createLogger(scope: string): Logger {
  const prefix = `[sim-triggers:${scope}]`
  return {
    debug: (message, ...meta) => console.debug(prefix, message, ...meta),
    info: (message, ...meta) => console.info(prefix, message, ...meta),
    warn: (message, ...meta) => console.warn(prefix, message, ...meta),
    error: (message, ...meta) => console.error(prefix, message, ...meta),
  }
}

// The 64-character nanoid URL alphabet: a 6-bit mask maps one random byte to
// exactly one character with no modulo bias.
const URL_SAFE_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

/**
 * Stand-in for sim's `generateId` (@sim/utils/id): a 21-character URL-safe
 * random id, nanoid-shaped, generated from webcrypto so it works in both the
 * server runtime and a browser bundle.
 */
export function generateId(size = 21): string {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < size; i += 1) {
    id += URL_SAFE_ALPHABET[bytes[i] & 63]
  }
  return id
}

/** Vendored from @sim/utils/object: true for plain-object-like records. */
export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Vendored from @sim/utils/object: coerce to a record, empty when not one. */
export function toRecord(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}

/** Vendored from @sim/utils/errors. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value ?? 'Unknown error'))
}

/** Vendored from @sim/utils/errors. */
export function getErrorMessage(value: unknown, fallback = 'Unknown error'): string {
  if (value instanceof Error) return value.message || fallback
  if (typeof value === 'string') return value || fallback
  return fallback
}
