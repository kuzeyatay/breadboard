// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/gitlab/pipeline.ts, adapted for Breadboard.

import { buildTriggerSubBlocks } from '../subblocks'
import {
  buildGitLabExtraFields,
  buildGitLabPipelineOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from './utils'
import type { TriggerConfig } from '../types'

export const gitlabPipelineTrigger: TriggerConfig = {
  id: 'gitlab_pipeline',
  name: 'GitLab Pipeline',
  provider: 'gitlab',
  description: 'Trigger workflow when a pipeline status changes in GitLab',
  version: '1.0.0',
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_pipeline',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Pipeline'),
    extraFields: buildGitLabExtraFields('gitlab_pipeline'),
  }),
  outputs: buildGitLabPipelineOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Pipeline Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
