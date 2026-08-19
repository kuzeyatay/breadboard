// Vendored from simstudioai/sim (Apache-2.0), apps/sim/lib/webhooks/providers/slack.ts, adapted for Breadboard.
// Heavily pruned: Breadboard vendors only the bring-your-own-app
// `slack_webhook` trigger (signing secret + optional bot token pasted by the
// user directly into providerConfig), not sim's native OAuth `slack_app`
// trigger. Dropped along with it: the credential-service token resolution
// (getSlackBotCredential/resolveOAuthAccountId/refreshAccessTokenIfNeeded,
// all @sim/db-coupled), the full event-catalog filter machinery
// (shouldSkipSlackTriggerEvent and its channel/thread/emoji/interaction
// filters — those exist to filter the *catalog* of events the native app
// trigger can select from; the bring-your-own-app trigger has no such
// picker and receives everything), and Slack file-download support (kept
// the url_verification challenge and the Events-API/interactivity/slash
// payload normalization, since those are what the trigger's own output
// schema promises).

import { NextResponse } from 'next/server'
import { createLogger, isRecordLike } from '../support'
import { hmacSha256Hex, safeCompare } from '../security'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from './types'

const logger = createLogger('WebhookProvider:Slack')

const SLACK_INTERACTIVE_TYPES = new Set([
  'block_actions',
  'interactive_message',
  'message_action',
  'shortcut',
  'view_submission',
  'view_closed',
])

interface SlackTriggerEvent {
  event_type: string
  subtype: string
  channel: string
  channel_name: string
  channel_type: string
  user: string
  user_name: string
  bot_id: string
  text: string
  timestamp: string
  thread_ts: string
  team_id: string
  event_id: string
  reaction: string
  item_user: string
  command: string
  action_id: string
  action_value: string
  actions: unknown[]
  response_url: string
  trigger_id: string
  callback_id: string
  api_app_id: string
  app_id: string
  message_ts: string
  view: Record<string, unknown> | null
  message: Record<string, unknown> | null
  state: Record<string, unknown> | null
}

function createSlackEvent(): SlackTriggerEvent {
  return {
    event_type: 'unknown',
    subtype: '',
    channel: '',
    channel_name: '',
    channel_type: '',
    user: '',
    user_name: '',
    bot_id: '',
    text: '',
    timestamp: '',
    thread_ts: '',
    team_id: '',
    event_id: '',
    reaction: '',
    item_user: '',
    command: '',
    action_id: '',
    action_value: '',
    actions: [],
    response_url: '',
    trigger_id: '',
    callback_id: '',
    api_app_id: '',
    app_id: '',
    message_ts: '',
    view: null,
    message: null,
    state: null,
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractActionValue(action: Record<string, unknown> | undefined): string {
  if (!action) return ''
  if (typeof action.value === 'string') return action.value

  const selectedOption = action.selected_option as Record<string, unknown> | undefined
  if (selectedOption && typeof selectedOption.value === 'string') {
    return selectedOption.value
  }

  const selectedOptions = action.selected_options as Array<Record<string, unknown>> | undefined
  if (Array.isArray(selectedOptions)) {
    return selectedOptions
      .map((o) => (typeof o?.value === 'string' ? o.value : ''))
      .filter(Boolean)
      .join(',')
  }

  for (const key of [
    'selected_date',
    'selected_time',
    'selected_date_time',
    'selected_conversation',
    'selected_channel',
    'selected_user',
  ] as const) {
    if (typeof action[key] === 'string') {
      return action[key] as string
    }
  }

  return ''
}

function formatSlackSlashCommand(b: Record<string, unknown>): SlackTriggerEvent {
  const event = createSlackEvent()
  event.event_type = 'slash_command'
  event.command = asString(b.command)
  event.text = asString(b.text)
  event.channel = asString(b.channel_id)
  event.channel_name = asString(b.channel_name)
  event.user = asString(b.user_id)
  event.user_name = asString(b.user_name)
  event.team_id = asString(b.team_id)
  event.response_url = asString(b.response_url)
  event.trigger_id = asString(b.trigger_id)
  event.api_app_id = asString(b.api_app_id)
  return event
}

function formatSlackInteractive(b: Record<string, unknown>): SlackTriggerEvent {
  const event = createSlackEvent()
  event.event_type = asString(b.type) || 'block_actions'

  const actions = Array.isArray(b.actions) ? (b.actions as Array<Record<string, unknown>>) : []
  event.actions = actions
  const firstAction = actions[0]
  event.action_id = asString(firstAction?.action_id)
  event.action_value = extractActionValue(firstAction)

  const channel = b.channel as Record<string, unknown> | undefined
  event.channel = asString(channel?.id)
  event.channel_name = asString(channel?.name)

  const user = b.user as Record<string, unknown> | undefined
  event.user = asString(user?.id)
  event.user_name = asString(user?.username) || asString(user?.name)

  const team = b.team as Record<string, unknown> | undefined
  event.team_id = asString(team?.id) || asString(user?.team_id)

  const container = b.container as Record<string, unknown> | undefined
  const message = b.message as Record<string, unknown> | undefined
  event.message_ts = asString(message?.ts) || asString(container?.message_ts)
  event.timestamp = event.message_ts || asString(firstAction?.action_ts)
  event.thread_ts = asString(message?.thread_ts)
  event.text = asString(message?.text) || event.action_value
  event.message = message ?? null

  event.response_url = asString(b.response_url)
  event.trigger_id = asString(b.trigger_id)
  const view = b.view as Record<string, unknown> | undefined
  event.callback_id = asString(b.callback_id) || asString(view?.callback_id)
  event.view = view ?? null
  event.state = (b.state as Record<string, unknown>) ?? null
  event.api_app_id = asString(b.api_app_id)

  return event
}

/** 5 minutes, per Slack's documented signature-verification tolerance. */
const SLACK_TIMESTAMP_MAX_SKEW = 300

export function validateSlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  rawBody: string
): boolean {
  try {
    if (!signingSecret || !signature || !rawBody) return false
    if (!signature.startsWith('v0=')) {
      logger.warn('Slack signature has invalid format (missing v0= prefix)')
      return false
    }
    const providedSignature = signature.substring(3)
    const basestring = `v0:${timestamp}:${rawBody}`
    const computedHash = hmacSha256Hex(basestring, signingSecret)
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Slack signature:', error)
    return false
  }
}

export function handleSlackChallenge(body: unknown): NextResponse | null {
  if (!isRecordLike(body)) return null
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }
  return null
}

export const slackHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const signingSecret = providerConfig.signingSecret as string | undefined
    if (!signingSecret) return null

    const signature = request.headers.get('x-slack-signature')
    const timestamp = request.headers.get('x-slack-request-timestamp')
    if (!signature || !timestamp) {
      logger.warn(`[${requestId}] Slack webhook missing signature or timestamp header`)
      return new NextResponse('Unauthorized - Missing Slack signature', { status: 401 })
    }

    const now = Math.floor(Date.now() / 1000)
    const parsedTimestamp = Number(timestamp)
    if (Number.isNaN(parsedTimestamp) || Math.abs(now - parsedTimestamp) > SLACK_TIMESTAMP_MAX_SKEW) {
      logger.warn(`[${requestId}] Slack webhook timestamp invalid or too old`)
      return new NextResponse('Unauthorized - Invalid timestamp', { status: 401 })
    }

    if (!validateSlackSignature(signingSecret, signature, timestamp, rawBody)) {
      logger.warn(`[${requestId}] Slack signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Slack signature', { status: 401 })
    }

    return null
  },

  handleChallenge(body: unknown) {
    return handleSlackChallenge(body)
  },

  /**
   * `event_id` (Events API) and `team_id:event.ts` are the primary keys.
   * `trigger_id` is the fallback for interactivity and slash-command payloads.
   */
  extractIdempotencyId(body: unknown) {
    if (!isRecordLike(body)) return null
    if (body.event_id) return String(body.event_id)
    const event = isRecordLike(body.event) ? body.event : undefined
    if (event?.ts && body.team_id) return `${body.team_id}:${event.ts}`
    if (body.trigger_id) return String(body.trigger_id)
    return null
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = isRecordLike(body) ? body : {}

    if (typeof b?.command === 'string' && b.command.startsWith('/')) {
      return { input: { event: formatSlackSlashCommand(b) } }
    }

    if (b?.type === 'block_suggestion') {
      return {
        input: null,
        skip: {
          message:
            'Slack block_suggestion payloads require a synchronous options response and cannot be served by an async webhook',
        },
      }
    }

    if (
      !b?.event &&
      ((typeof b?.type === 'string' && SLACK_INTERACTIVE_TYPES.has(b.type)) ||
        Array.isArray(b?.actions))
    ) {
      return { input: { event: formatSlackInteractive(b) } }
    }

    const rawEvent = b?.event as Record<string, unknown> | undefined
    const eventType: string = (rawEvent?.type as string) || (b?.type as string) || 'unknown'
    const item = rawEvent?.item as Record<string, unknown> | undefined
    const isReactionEvent = eventType === 'reaction_added' || eventType === 'reaction_removed'
    const channel: string =
      (typeof rawEvent?.channel === 'string' ? rawEvent.channel : undefined) ||
      (typeof item?.channel === 'string' ? item.channel : '') ||
      ''
    const messageTs: string = isReactionEvent
      ? (item?.ts as string) || ''
      : (rawEvent?.ts as string) || (rawEvent?.event_ts as string) || ''

    const event = createSlackEvent()
    event.event_type = eventType
    event.subtype = asString(rawEvent?.subtype)
    event.channel = channel
    event.channel_type = asString(rawEvent?.channel_type)
    event.user = asString(rawEvent?.user)
    event.bot_id = asString(rawEvent?.bot_id)
    event.text = asString(rawEvent?.text)
    event.timestamp = messageTs
    event.thread_ts = asString(rawEvent?.thread_ts)
    event.team_id = asString(b?.team_id) || asString(rawEvent?.team)
    event.event_id = asString(b?.event_id)
    event.api_app_id = asString(b?.api_app_id)
    event.app_id =
      asString(rawEvent?.app_id) ||
      asString((rawEvent?.bot_profile as Record<string, unknown> | undefined)?.app_id)
    event.reaction = asString(rawEvent?.reaction)
    event.item_user = asString(rawEvent?.item_user)
    event.message_ts = messageTs

    return { input: { event } }
  },
}
