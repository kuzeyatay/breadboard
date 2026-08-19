// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/linear/utils.ts, adapted for Breadboard.
// Pruned: only what the manual `linear_webhook` trigger and the Linear webhook
// provider handler need — the setup instructions, the shared actor output
// schema, and the event-match table. The v2 auto-registration machinery
// (LINEAR_RESOURCE_TYPE_MAP, buildLinearV2SubBlocks) and the per-event output
// builders are not vendored.

/**
 * Generate setup instructions for manual Linear webhook configuration (v1 triggers)
 */
export function linearSetupInstructions(eventType: string, additionalNotes?: string): string {
  const instructions = [
    '<strong>Note:</strong> You must have admin permissions in your Linear workspace to create webhooks.',
    'In Linear, navigate to <a href="https://linear.app/settings/api" target="_blank" rel="noopener noreferrer">Settings > API</a> (or Settings > Administration > API).',
    'Scroll down to the <strong>Webhooks</strong> section and click <strong>"Create webhook"</strong>.',
    'Paste the <strong>Webhook URL</strong> from above into the URL field.',
    'Optionally, enter the <strong>Webhook Secret</strong> from above into the secret field for added security.',
    `Select the resource types this webhook should listen to. For this trigger, select <strong>${eventType}</strong>.`,
    'Click <strong>"Create"</strong> to activate the webhook.',
  ]

  if (additionalNotes) {
    instructions.push(additionalNotes)
  }

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Shared user/actor output schema (Linear data-change webhook `actor` object).
 * @see https://linear.app/developers/webhooks — actor may be a User, OauthClient, or Integration; `type` is mapped to `actorType` (TriggerOutput reserves nested `type` for field kinds).
 */
export const userOutputs = {
  id: {
    type: 'string',
    description: 'User ID',
  },
  name: {
    type: 'string',
    description: 'User display name',
  },
  /** Linear sends this as `actor.type`; exposed as `actorType` here (TriggerOutput reserves `type`). */
  actorType: {
    type: 'string',
    description: 'Actor type from Linear (e.g. user, OauthClient, Integration)',
  },
  email: {
    type: 'string',
    description: 'Actor email (present for user actors in Linear webhook payloads)',
  },
  url: {
    type: 'string',
    description: 'Actor profile URL in Linear (distinct from the top-level subject entity `url`)',
  },
} as const

export function isLinearEventMatch(triggerId: string, eventType: string, action?: string): boolean {
  const eventMap: Record<string, { type: string; actions?: string[] }> = {
    linear_issue_created: { type: 'Issue', actions: ['create'] },
    linear_issue_updated: { type: 'Issue', actions: ['update'] },
    linear_issue_removed: { type: 'Issue', actions: ['remove'] },
    linear_comment_created: { type: 'Comment', actions: ['create'] },
    linear_comment_updated: { type: 'Comment', actions: ['update'] },
    linear_project_created: { type: 'Project', actions: ['create'] },
    linear_project_updated: { type: 'Project', actions: ['update'] },
    linear_cycle_created: { type: 'Cycle', actions: ['create'] },
    linear_cycle_updated: { type: 'Cycle', actions: ['update'] },
    linear_label_created: { type: 'IssueLabel', actions: ['create'] },
    linear_label_updated: { type: 'IssueLabel', actions: ['update'] },
    linear_project_update_created: { type: 'ProjectUpdate', actions: ['create'] },
    linear_customer_request_created: { type: 'CustomerNeed', actions: ['create'] },
    linear_customer_request_updated: { type: 'CustomerNeed', actions: ['update'] },
  }

  const normalizedId = triggerId.replace(/_v2$/, '')
  const config = eventMap[normalizedId]
  if (!config) {
    return false
  }

  if (config.type !== eventType) {
    return false
  }

  if (config.actions && action && !config.actions.includes(action)) {
    return false
  }

  return true
}
