// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/core/idempotency/service.ts
// (createWebhookIdempotencyKey, lines ~657-700), adapted for Breadboard.
// Pure function only — sim's surrounding IdempotencyService class is
// Postgres/Redis-backed; Breadboard's dedupe store (../../hooks/store.ts)
// replaces it with a SQLite `hook_deliveries` table.

/** Header names sim's webhook receivers already recognize as a stable delivery id. */
const IDEMPOTENCY_HEADER_ALLOWLIST = [
  'x-breadboard-idempotency-key',
  'x-sim-idempotency-key',
  'webhook-id',
  'x-webhook-id',
  'x-shopify-webhook-id',
  'x-github-delivery',
  'x-gitlab-event-uuid',
  'x-event-id',
  'x-teams-notification-id',
  'svix-id',
  'linear-delivery',
  'greenhouse-event-id',
  'x-zm-request-id',
  'x-atlassian-webhook-identifier',
  'idempotency-key',
] as const

/**
 * Build the key used to dedupe a single webhook delivery: prefer a stable id
 * from the provider's own delivery-id header (allowlisted above), then the
 * provider handler's own `extractIdempotencyId(body)`, then a random id
 * (which — by construction — never collides, so that delivery is never
 * treated as a duplicate).
 */
export function createWebhookIdempotencyKey(
  hookId: string,
  headers: Record<string, string> | undefined,
  extractFromBody: (() => string | null) | undefined
): string {
  const normalizedHeaders = headers
    ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    : undefined

  for (const header of IDEMPOTENCY_HEADER_ALLOWLIST) {
    const value = normalizedHeaders?.[header]
    if (value) {
      return `${hookId}:${value}`
    }
  }

  const bodyIdentifier = extractFromBody?.()
  if (bodyIdentifier) {
    return `${hookId}:${bodyIdentifier}`
  }

  return `${hookId}:${crypto.randomUUID()}`
}
