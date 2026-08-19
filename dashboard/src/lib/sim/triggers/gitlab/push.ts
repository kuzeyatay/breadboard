// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/gitlab/push.ts, adapted for Breadboard.

import { buildTriggerSubBlocks } from '../subblocks'
import {
  buildGitLabExtraFields,
  buildGitLabPushOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from './utils'
import type { TriggerConfig } from '../types'

export const gitlabPushTrigger: TriggerConfig = {
  id: 'gitlab_push',
  name: 'GitLab Push',
  provider: 'gitlab',
  description: 'Trigger workflow when commits are pushed to a GitLab project',
  version: '1.0.0',
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_push',
    triggerOptions: gitlabTriggerOptions,
    includeDropdown: true,
    setupInstructions: gitlabSetupInstructions('Push'),
    extraFields: buildGitLabExtraFields('gitlab_push'),
  }),
  outputs: buildGitLabPushOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Push Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
