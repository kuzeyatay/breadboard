// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/linear.ts, adapted for Breadboard.
// Pruned: only the manual signing-secret webhook path (`linear_webhook`) is
// vendored — createSubscription/deleteSubscription (the auto-registered
// `_v2` GraphQL webhookCreate/webhookDelete flow) are dropped along with the
// `_v2` trigger they serve.

import { NextResponse } from 'next/server'
import { createLogger, isRecordLike } from '../support'
import { hmacSha256Hex, safeCompare } from '../security'
import { createHmacVerifier } from './utils'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from './types'

const logger = createLogger('WebhookProvider:Linear')

function validateLinearSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) return false
    const computedHash = hmacSha256Hex(body, secret)
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Linear signature:', error)
    return false
  }
}

/**
 * Linear's docs recommend a 60s replay window, but do not document whether
 * `webhookTimestamp` is re-stamped per retry attempt; Linear itself retries
 * failed deliveries after 1 minute, 1 hour, and 6 hours. A strict 60s window
 * risks silently dropping a legitimate hours-later retry, so a wider 5-minute
 * window is used — idempotency dedup already prevents double-processing of
 * any retried delivery within it.
 */
const LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

const verifyLinearSignature = createHmacVerifier({
  configKey: 'webhookSecret',
  headerName: 'Linear-Signature',
  validateFn: validateLinearSignature,
  providerLabel: 'Linear',
})

export const linearHandler: WebhookProviderHandler = {
  async verifyAuth(ctx: AuthContext): Promise<NextResponse | null> {
    const { rawBody, requestId, providerConfig } = ctx
    if (!providerConfig.webhookSecret) return null

    const signatureError = await verifyLinearSignature(ctx)
    if (signatureError) return signatureError

    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>
      const ts = parsed.webhookTimestamp
      if (typeof ts !== 'number' || !Number.isFinite(ts)) {
        logger.warn(`[${requestId}] Linear webhookTimestamp missing or invalid`)
        return new NextResponse('Unauthorized - Invalid webhook timestamp', { status: 401 })
      }
      if (Math.abs(Date.now() - ts) > LINEAR_WEBHOOK_TIMESTAMP_SKEW_MS) {
        logger.warn(`[${requestId}] Linear webhookTimestamp outside allowed skew`)
        return new NextResponse('Unauthorized - Webhook timestamp skew too large', { status: 401 })
      }
    } catch (error) {
      logger.warn(
        `[${requestId}] Linear webhook body parse failed after signature verification`,
        error
      )
      return new NextResponse('Unauthorized - Invalid webhook body', { status: 401 })
    }

    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}
    const rawActor = b.actor
    let actor: unknown = null
    if (isRecordLike(rawActor)) {
      const a = rawActor as Record<string, unknown>
      const { type: linearActorType, ...rest } = a
      actor = { ...rest, actorType: typeof linearActorType === 'string' ? linearActorType : null }
    }

    return {
      input: {
        action: b.action || '',
        type: b.type || '',
        webhookId: b.webhookId || '',
        webhookTimestamp: b.webhookTimestamp || 0,
        organizationId: b.organizationId || '',
        createdAt: b.createdAt || '',
        url: typeof b.url === 'string' ? b.url : '',
        actor,
        data: b.data || null,
        updatedFrom: b.updatedFrom || null,
      },
    }
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId && triggerId !== 'linear_webhook') {
      const { isLinearEventMatch } = await import('../linear/utils')
      const obj = isRecordLike(body) ? body : {}
      const action = typeof obj.action === 'string' ? obj.action : undefined
      const type = typeof obj.type === 'string' ? obj.type : undefined
      if (!isLinearEventMatch(triggerId, type || '', action)) {
        logger.debug(
          `[${requestId}] Linear event mismatch for trigger ${triggerId}. Type: ${type}, Action: ${action}. Skipping.`
        )
        return false
      }
    }
    return true
  },

  /**
   * Fallback for dedup when the `Linear-Delivery` header (already handled
   * generically by the idempotency allowlist) is unavailable. Keys on the
   * entity id plus its own updatedAt/createdAt, not a request-time
   * timestamp, so retried deliveries of the same event still collapse.
   */
  extractIdempotencyId(body: unknown): string | null {
    if (!isRecordLike(body)) return null
    const type = typeof body.type === 'string' ? body.type : undefined
    const action = typeof body.action === 'string' ? body.action : undefined
    const data = body.data as Record<string, unknown> | undefined
    const id = typeof data?.id === 'string' ? data.id : undefined
    if (!type || !id) return null
    const version = data?.updatedAt || data?.createdAt || body.createdAt
    return [`linear:${type}`, action, id, version].filter(Boolean).join(':')
  },
}
