// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/constants.ts, adapted for Breadboard.

/**
 * System subblock IDs that are part of the trigger UI infrastructure
 * and should NOT be aggregated into triggerConfig or validated as user fields.
 *
 * These subblocks provide UI/UX functionality but aren't configuration data.
 */
export const SYSTEM_SUBBLOCK_IDS: string[] = [
  'triggerCredentials', // OAuth credentials subblock
  'triggerInstructions', // Setup instructions text
  'webhookUrlDisplay', // Webhook URL display
  'samplePayload', // Example payload display
  'setupScript', // Setup script code (e.g., Apps Script)
  'scheduleInfo', // Schedule status display (next run, last run)
]

/**
 * Trigger-related subblock IDs that represent runtime metadata. They should remain
 * in the workflow state but must not be modified or cleared by diff operations.
 *
 * Note: 'triggerConfig' is included because it's an aggregate of individual trigger
 * field subblocks. Those individual fields are compared separately, so comparing
 * triggerConfig would be redundant. Additionally, the client populates triggerConfig
 * with default values from the trigger definition on load, which aren't present in
 * the deployed state, causing false positive change detection.
 */
export const TRIGGER_RUNTIME_SUBBLOCK_IDS: string[] = [
  'webhookId',
  'triggerPath',
  'triggerConfig',
  'triggerId',
]

/**
 * Synthesized read-only field exposing a webhook trigger block's public URL in the
 * copilot's read view of workflow state. The URL is derived at read time — it is
 * never persisted.
 */
export const TRIGGER_WEBHOOK_URL_FIELD = 'triggerWebhookUrl'

/**
 * Maximum number of consecutive failures before a trigger (schedule/webhook) is auto-disabled.
 * This prevents runaway errors from continuously executing failing workflows.
 */
export const MAX_CONSECUTIVE_FAILURES = 100

/**
 * Set of webhook provider names that use polling-based triggers.
 * Mirrors the `polling: true` flag on TriggerConfig entries.
 * Breadboard's pruned registry ships no polling providers, but the receive
 * route still rejects them by name so a future addition cannot silently open
 * a push path onto a poll-only provider.
 */
export const POLLING_PROVIDERS = new Set([
  'gmail',
  'google-calendar',
  'google-drive',
  'google-sheets',
  'hubspot',
  'imap',
  'outlook',
  'rss',
])

export function isPollingWebhookProvider(provider: string | null): boolean {
  return provider !== null && POLLING_PROVIDERS.has(provider)
}

/**
 * Providers whose triggers fire internally rather than via external HTTP
 * webhooks. The public trigger route must reject deliveries to them.
 */
export const INTERNAL_TRIGGER_PROVIDERS = new Set(['sim', 'table'])

export function isInternalTriggerProvider(provider: string | null): boolean {
  return provider !== null && INTERNAL_TRIGGER_PROVIDERS.has(provider)
}
