// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/gitlab/webhook.ts, adapted for Breadboard.

import { buildTriggerSubBlocks } from '../subblocks'
import {
  buildGitLabExtraFields,
  buildGitLabWebhookOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from './utils'
import type { TriggerConfig } from '../types'

export const gitlabWebhookTrigger: TriggerConfig = {
  id: 'gitlab_webhook',
  name: 'GitLab Event',
  provider: 'gitlab',
  description: 'Trigger workflow from any GitLab webhook event',
  version: '1.0.0',
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_webhook',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('all'),
    extraFields: buildGitLabExtraFields('gitlab_webhook'),
  }),
  outputs: buildGitLabWebhookOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Push Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
