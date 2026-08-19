// Vendored from simstudioai/sim (Apache-2.0) — packages/utils/src/errors.ts
// (the one helper the chunkers use); adapted for Breadboard.

/**
 * Normalizes an unknown caught value into an Error instance.
 * Replaces the common `e instanceof Error ? e : new Error(String(e))` pattern in catch clauses.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  return new Error(String(value))
}
