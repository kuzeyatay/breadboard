// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/gitlab/merge_request.ts, adapted for Breadboard.

import { buildTriggerSubBlocks } from '../subblocks'
import {
  buildGitLabExtraFields,
  buildGitLabMergeRequestOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from './utils'
import type { TriggerConfig } from '../types'

export const gitlabMergeRequestTrigger: TriggerConfig = {
  id: 'gitlab_merge_request',
  name: 'GitLab Merge Request',
  provider: 'gitlab',
  description: 'Trigger workflow when a merge request is opened, updated, or merged in GitLab',
  version: '1.0.0',
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_merge_request',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Merge Request'),
    extraFields: buildGitLabExtraFields('gitlab_merge_request'),
  }),
  outputs: buildGitLabMergeRequestOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Merge Request Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
