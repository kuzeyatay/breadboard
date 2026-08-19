// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/types.ts, adapted for Breadboard.
// Adaptation: `request` is typed as NextRequest still (Breadboard's receive
// route runs on the Next.js route handler, same as sim's), but the handler
// signatures otherwise match verbatim so the vendored provider files below
// need no further edits.

import type { NextRequest, NextResponse } from 'next/server'

/** Context for signature/token verification. */
export interface AuthContext {
  webhook: Record<string, unknown>
  workflow: Record<string, unknown>
  request: NextRequest
  rawBody: string
  requestId: string
  providerConfig: Record<string, unknown>
}
/** Context for event matching against trigger configuration. */
export interface EventMatchContext {
  webhook: Record<string, unknown>
  workflow: Record<string, unknown>
  body: unknown
  request: NextRequest
  requestId: string
  providerConfig: Record<string, unknown>
}

/** Context for event filtering and header enrichment. */
export interface EventFilterContext {
  webhook: Record<string, unknown>
  body: unknown
  requestId: string
  providerConfig: Record<string, unknown>
}

/** Context for custom input preparation during execution. */
export interface FormatInputContext {
  webhook: Record<string, unknown>
  workflow: { id: string; userId: string }
  body: unknown
  headers: Record<string, string>
  requestId: string
}

/** Result of custom input preparation. */
export interface FormatInputResult {
  input: unknown
  skip?: { message: string }
}

/**
 * Strategy interface for provider-specific webhook behavior.
 * Each provider implements only the methods it needs — all methods are optional.
 * Pruned to what Breadboard's receive route drives (verify, match, filter,
 * format, idempotency, challenge, success/error shaping). Sim's file-processing,
 * subscription-management, and polling-configuration methods are not part of
 * this interface — Breadboard registers/deletes subscriptions itself (see
 * dispatch and the hooks API) rather than through provider callbacks.
 */
export interface WebhookProviderHandler {
  /** Verify signature/auth. Return NextResponse(401/403) on failure, null on success. */
  verifyAuth?(ctx: AuthContext): Promise<NextResponse | null> | NextResponse | null

  /** Return true to skip this event (filtering by event type, collection, etc.). */
  shouldSkipEvent?(ctx: EventFilterContext): boolean

  /** Return true if event matches, false or NextResponse to skip with a custom response. */
  matchEvent?(ctx: EventMatchContext): Promise<boolean | NextResponse> | boolean | NextResponse

  /** Add provider-specific headers (idempotency keys, notification IDs, etc.). */
  enrichHeaders?(ctx: EventFilterContext, headers: Record<string, string>): void

  /** Extract unique identifier for idempotency dedup. */
  extractIdempotencyId?(body: unknown): string | null

  /** Custom success response after queuing. Return null for default `{message: "Webhook processed"}`. */
  formatSuccessResponse?(providerConfig: Record<string, unknown>): NextResponse | null

  /** Custom input preparation. When defined, replaces the default pass-through of the raw body. */
  formatInput?(ctx: FormatInputContext): Promise<FormatInputResult>

  /** Handle verification challenges before webhook lookup (Slack url_verification). */
  handleChallenge?(
    body: unknown,
    request: NextRequest,
    requestId: string,
    path: string,
    rawBody?: string
  ): Promise<NextResponse | null> | NextResponse | null
}
