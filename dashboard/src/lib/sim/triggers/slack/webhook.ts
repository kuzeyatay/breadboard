// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/slack/webhook.ts, adapted for Breadboard.
// Adaptation: icon and the editor-only setup-wizard modal subblock are dropped.

import { SLACK_TRIGGER_OUTPUTS } from './shared'
import type { TriggerConfig } from '../types'

export const slackWebhookTrigger: TriggerConfig = {
  id: 'slack_webhook',
  name: 'Slack Webhook',
  provider: 'slack',
  description: 'Trigger workflow from Slack events like mentions, messages, and reactions',
  version: '1.0.0',

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'signingSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Enter your Slack app signing secret',
      description: 'The signing secret from your Slack app to validate request authenticity.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'xoxb-...',
      description:
        'The bot token from your Slack app. Optional; used to fetch the message text for reaction events.',
      password: true,
      required: false,
      mode: 'trigger',
    },
  ],

  outputs: SLACK_TRIGGER_OUTPUTS,

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
