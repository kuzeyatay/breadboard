// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/gitlab.ts, adapted for Breadboard.
// Pruned: createSubscription/deleteSubscription (auto-registration against
// the GitLab project-hooks API via a Personal Access Token, which needed
// sim's `secureFetchWithValidation` SSRF-hardened fetch and `getGitLabApiBase`
// host-safety check) are dropped. Breadboard's GitLab hook is manual, like
// its GitHub/Linear/Slack hooks: the user pastes a webhook secret they set up
// themselves in GitLab's UI, verified here by plain equality against
// `X-Gitlab-Token` (GitLab does not HMAC-sign — it echoes the configured
// secret verbatim).

import { NextResponse } from 'next/server'
import { createLogger, isRecordLike, toRecord } from '../support'
import { safeCompare } from '../security'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from './types'

const logger = createLogger('WebhookProvider:GitLab')

export const gitlabHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret) {
      logger.warn(`[${requestId}] GitLab webhook secret not configured`)
      return new NextResponse('Unauthorized - Missing GitLab webhook secret', { status: 401 })
    }

    const token = request.headers.get('X-Gitlab-Token')
    if (!token) {
      logger.warn(`[${requestId}] GitLab webhook missing X-Gitlab-Token header`)
      return new NextResponse('Unauthorized - Missing GitLab token', { status: 401 })
    }

    if (!safeCompare(token, secret)) {
      logger.warn(`[${requestId}] GitLab token verification failed`)
      return new NextResponse('Unauthorized - Invalid GitLab token', { status: 401 })
    }

    return null
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId || triggerId === 'gitlab_webhook') return true

    const objectKind = toRecord(body).object_kind as string | undefined
    const { isGitLabEventMatch } = await import('../gitlab/utils')
    if (!isGitLabEventMatch(triggerId, objectKind || '')) {
      logger.debug(
        `[${requestId}] GitLab event '${objectKind}' does not match trigger ${triggerId}, skipping`
      )
      return false
    }
    return true
  },

  async formatInput({ body, headers }: FormatInputContext): Promise<FormatInputResult> {
    const b = toRecord(body)
    const eventType = headers['x-gitlab-event'] || ''
    const ref = typeof b.ref === 'string' ? b.ref : ''
    const branch = ref.replace('refs/heads/', '')
    const objectAttributes = b.object_attributes
    let input: Record<string, unknown> = { ...b, event_type: eventType, branch }
    if (isRecordLike(objectAttributes)) {
      const workItemType = (objectAttributes as Record<string, unknown>).type
      if (workItemType !== undefined) {
        input = {
          ...input,
          object_attributes: { ...objectAttributes, work_item_type: workItemType },
        }
      }
    }
    return { input }
  },

  /**
   * GitLab does not automatically retry a failed delivery; re-delivery only
   * happens via a manual "Resend Request", which carries the same
   * webhook-id/X-Gitlab-Event-UUID headers as the original (already in the
   * shared idempotency allowlist ahead of this method). This is a
   * content-derived fallback for the rare case those headers are stripped in
   * transit.
   */
  extractIdempotencyId(body: unknown): string | null {
    const b = toRecord(body)
    const objectKind = (b.object_kind as string) || ''
    const project = toRecord(b.project)
    const projectId = project.id != null ? String(project.id) : ''

    if (objectKind === 'push' || objectKind === 'tag_push') {
      const ref = (b.ref as string) || ''
      const checkoutSha = (b.checkout_sha as string) || (b.after as string) || ''
      if (!checkoutSha && !ref) return null
      return `gitlab:${objectKind}:${projectId}:${ref}:${checkoutSha}`
    }

    const objectAttributes = toRecord(b.object_attributes)
    const id = objectAttributes.id != null ? String(objectAttributes.id) : ''
    if (!id) return null
    const version =
      (objectAttributes.updated_at as string) ||
      [objectAttributes.status, objectAttributes.finished_at || objectAttributes.created_at]
        .filter(Boolean)
        .join(':') ||
      ''
    return `gitlab:${objectKind || 'event'}:${projectId}:${id}:${version}`
  },
}
