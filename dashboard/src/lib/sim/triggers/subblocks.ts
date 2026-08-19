// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/index.ts
// (buildTriggerSubBlocks), adapted for Breadboard. Split into its own module so
// trigger definition files can use it without importing the registry (avoids
// the registry → definition → index evaluation cycle sim tolerates).

import type { SubBlockConfig } from './types'

/**
 * Options for building trigger subBlocks
 */
export interface BuildTriggerSubBlocksOptions {
  /** The trigger ID (e.g., 'gitlab_push') */
  triggerId: string
  /** Dropdown options for selecting trigger type */
  triggerOptions: Array<{ label: string; id: string }>
  /** Whether to include the trigger type dropdown (only for primary trigger) */
  includeDropdown?: boolean
  /** HTML setup instructions to display */
  setupInstructions: string
  /** Additional fields to insert before the save button (e.g., campaign filters) */
  extraFields?: SubBlockConfig[]
  /** Webhook URL placeholder text */
  webhookPlaceholder?: string
}

/**
 * Generic builder for trigger subBlocks.
 * Creates a consistent structure: [dropdown?] -> webhookUrl -> extraFields -> instructions
 */
export function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[] {
  const {
    triggerId,
    triggerOptions,
    includeDropdown = false,
    setupInstructions,
    extraFields = [],
    webhookPlaceholder = 'Webhook URL will be generated',
  } = options

  const blocks: SubBlockConfig[] = []

  // Only the primary trigger includes the dropdown
  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: triggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  // Webhook URL display (common to all triggers)
  // ID will be namespaced by getTrigger() when merged into blocks
  blocks.push({
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    useWebhookUrl: true,
    placeholder: webhookPlaceholder,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  // Insert any extra fields (campaign filters, event types, etc.)
  if (extraFields.length > 0) {
    blocks.push(...extraFields)
  }

  // Setup instructions
  // ID will be namespaced by getTrigger() when merged into blocks
  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: setupInstructions,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}
