// Tiny local timing-safe helpers, replacing sim's @sim/security/compare and
// @sim/security/hash for the vendored trigger providers. Both are one-liners
// over node:crypto, kept local rather than pulled in as a package per the
// HOOKS agent brief ("safeCompare from a tiny local timing-safe helper").

import crypto from 'node:crypto'

/**
 * Timing-safe string comparison. Returns false (never throws) on length
 * mismatch, since crypto.timingSafeEqual requires equal-length buffers and a
 * length mismatch is itself not a secret worth leaking timing info about.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** SHA-256 hex digest, used for fallback idempotency fingerprints. */
export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

/** HMAC-SHA256 hex digest, used by the Linear webhook provider. */
export function hmacSha256Hex(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}
