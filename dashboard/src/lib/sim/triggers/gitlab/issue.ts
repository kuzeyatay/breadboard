// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/gitlab/issue.ts, adapted for Breadboard.

import { buildTriggerSubBlocks } from '../subblocks'
import {
  buildGitLabExtraFields,
  buildGitLabIssueOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from './utils'
import type { TriggerConfig } from '../types'

export const gitlabIssueTrigger: TriggerConfig = {
  id: 'gitlab_issue',
  name: 'GitLab Issue',
  provider: 'gitlab',
  description: 'Trigger workflow when an issue is opened, updated, or closed in GitLab',
  version: '1.0.0',
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_issue',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Issue'),
    extraFields: buildGitLabExtraFields('gitlab_issue'),
  }),
  outputs: buildGitLabIssueOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Issue Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
