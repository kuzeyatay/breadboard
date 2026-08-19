// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/stripe.ts, adapted for Breadboard.
// Adaptation: @sim/logger -> local shim; @sim/utils/object -> local
// isRecordLike. Sim verifies via `Stripe.webhooks.constructEvent` from the
// `stripe` npm package; that package is not a dashboard dependency and this
// agent may not add one (package.json is reported, not edited — see final
// report), so verification implements Stripe's documented Stripe-Signature
// scheme directly: header `t=<timestamp>,v1=<hex>[,v0=...]`, expected
// signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`), compared
// timing-safe against every v1 value (Stripe can send multiple during secret
// rotation) with a 5-minute timestamp tolerance against replay.
// https://docs.stripe.com/webhooks#verify-manually

import { NextResponse } from 'next/server'
import { createLogger, isRecordLike } from '../support'
import { hmacSha256Hex, safeCompare } from '../security'
import type {
  AuthContext,
  EventFilterContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from './types'
import { skipByEventTypes } from './utils'

const logger = createLogger('WebhookProvider:Stripe')

/** Stripe's own tolerance window for the `t=` timestamp component. */
const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

function verifyStripeSignature(secret: string, header: string, rawBody: string): boolean {
  const parts = header.split(',').reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split('=', 2)
    if (!key || value === undefined) return acc
    ;(acc[key] ??= []).push(value)
    return acc
  }, {})

  const timestamp = parts.t?.[0]
  const signatures = parts.v1
  if (!timestamp || !signatures || signatures.length === 0) {
    return false
  }

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > STRIPE_TIMESTAMP_TOLERANCE_SECONDS) {
    logger.warn('Stripe webhook timestamp outside tolerance window')
    return false
  }

  const expected = hmacSha256Hex(`${timestamp}.${rawBody}`, secret)
  return signatures.some((candidate) => safeCompare(candidate, expected))
}

export const stripeHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      logger.warn(
        `[${requestId}] Stripe webhook missing webhookSecret in providerConfig — rejecting request`
      )
      return new NextResponse('Unauthorized - Webhook secret not configured', { status: 401 })
    }

    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      logger.warn(`[${requestId}] Stripe webhook missing Stripe-Signature header`)
      return new NextResponse('Unauthorized - Missing Stripe signature', { status: 401 })
    }

    if (!verifyStripeSignature(secret, signature, rawBody)) {
      logger.warn(`[${requestId}] Stripe signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Stripe signature', { status: 401 })
    }

    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },

  shouldSkipEvent(ctx: EventFilterContext) {
    return skipByEventTypes(ctx, 'Stripe', logger)
  },

  /**
   * Stripe event ids (evt_...) are globally unique and stable across retries —
   * Stripe resends the same event id on delivery retries, so keying on it
   * directly is sufficient without a content-derived fallback.
   */
  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) return null
    if (body.id && body.object === 'event') {
      return String(body.id)
    }
    return null
  },
}
