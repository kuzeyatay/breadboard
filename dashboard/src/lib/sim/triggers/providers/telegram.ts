// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/telegram.ts, adapted for Breadboard.
// Adaptation, closing a gap sim has: sim's Telegram trigger never verifies the
// caller is actually Telegram (verifyAuth only warns on a missing User-Agent —
// trivially spoofable). Breadboard adds `X-Telegram-Bot-Api-Secret-Token`
// verification end to end: createSubscription generates a per-hook
// `secretToken`, sends it as `secret_token` in the `setWebhook` call, persists
// it in providerConfig, and verifyAuth checks the inbound header against it
// with a timing-safe comparison. The `deleteSubscription` DB lookup
// (activeTelegramWebhookUsesBot, @sim/db-coupled) is dropped — Breadboard has
// no concept of "another active deployment reusing this bot token" to guard
// against, so deletion always calls deleteWebhook.

import { NextResponse } from 'next/server'
import { createLogger } from '../support'
import { safeCompare } from '../security'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from './types'

const logger = createLogger('WebhookProvider:Telegram')

export interface TelegramSubscriptionResult {
  ok: boolean
  error?: string
}

/**
 * Register (or update) the Telegram webhook for a bot token, pinning delivery
 * to `notificationUrl` and requiring the given secret token on every inbound
 * update. Called from the hooks create/update flow (see dispatch.ts /
 * app/api/hooks/route.ts), not from the receive route.
 */
export async function createTelegramSubscription(
  botToken: string,
  notificationUrl: string,
  secretToken: string
): Promise<TelegramSubscriptionResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'BreadboardBot/1.0' },
      body: JSON.stringify({ url: notificationUrl, secret_token: secretToken }),
    })
    const responseBody = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
    }
    if (!response.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description || `Failed to create Telegram webhook. Status: ${response.status}`
      logger.error(errorMessage, { response: responseBody })
      return { ok: false, error: errorMessage }
    }
    return { ok: true }
  } catch (error) {
    logger.error('Error creating Telegram webhook', error)
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/** Deregister the Telegram webhook. Best-effort: failures are logged, not thrown. */
export async function deleteTelegramSubscription(botToken: string): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const responseBody = (await response.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
    }
    if (!response.ok || !responseBody.ok) {
      logger.warn('Failed to delete Telegram webhook (non-fatal)', { response: responseBody })
    }
  } catch (error) {
    logger.warn('Error deleting Telegram webhook (non-fatal)', error)
  }
}

export const telegramHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    const secretToken = providerConfig.secretToken as string | undefined
    if (!secretToken) {
      // No secret configured (e.g. the bot token was never provided at
      // create time): fail open like sim does, rather than lock out a hook
      // that has no way to have set up the secret in the first place.
      return null
    }

    const provided = request.headers.get('x-telegram-bot-api-secret-token')
    if (!provided || !safeCompare(provided, secretToken)) {
      logger.warn(`[${requestId}] Telegram webhook missing or invalid secret token`)
      return new NextResponse('Unauthorized - Invalid Telegram secret token', { status: 401 })
    }

    return null
  },

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown>
    const updateId = obj?.update_id
    if (typeof updateId === 'number') {
      return `telegram:${updateId}`
    }
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const rawMessage = (b?.message ||
      b?.edited_message ||
      b?.channel_post ||
      b?.edited_channel_post) as Record<string, unknown> | undefined

    const updateType = b.message
      ? 'message'
      : b.edited_message
        ? 'edited_message'
        : b.channel_post
          ? 'channel_post'
          : b.edited_channel_post
            ? 'edited_channel_post'
            : 'unknown'

    if (rawMessage) {
      const messageType = rawMessage.photo
        ? 'photo'
        : rawMessage.document
          ? 'document'
          : rawMessage.audio
            ? 'audio'
            : rawMessage.video
              ? 'video'
              : rawMessage.voice
                ? 'voice'
                : rawMessage.sticker
                  ? 'sticker'
                  : rawMessage.location
                    ? 'location'
                    : rawMessage.contact
                      ? 'contact'
                      : rawMessage.poll
                        ? 'poll'
                        : 'text'

      const from = rawMessage.from as Record<string, unknown> | undefined
      return {
        input: {
          message: {
            id: rawMessage.message_id,
            text: rawMessage.text,
            date: rawMessage.date,
            messageType,
            raw: rawMessage,
          },
          sender: from
            ? {
                id: from.id,
                username: from.username,
                firstName: from.first_name,
                lastName: from.last_name,
                languageCode: from.language_code,
                isBot: from.is_bot,
              }
            : null,
          updateId: b.update_id,
          updateType,
        },
      }
    }

    logger.warn('Unknown Telegram update type', {
      updateId: b.update_id,
      bodyKeys: Object.keys(b || {}),
    })

    return {
      input: {
        updateId: b.update_id,
        updateType,
      },
    }
  },
}
