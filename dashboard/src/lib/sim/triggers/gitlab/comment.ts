// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/gitlab/comment.ts, adapted for Breadboard.

import { buildTriggerSubBlocks } from '../subblocks'
import {
  buildGitLabCommentOutputs,
  buildGitLabExtraFields,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from './utils'
import type { TriggerConfig } from '../types'

export const gitlabCommentTrigger: TriggerConfig = {
  id: 'gitlab_comment',
  name: 'GitLab Comment',
  provider: 'gitlab',
  description: 'Trigger workflow when a comment is added on a commit, merge request, or issue',
  version: '1.0.0',
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_comment',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Comment'),
    extraFields: buildGitLabExtraFields('gitlab_comment'),
  }),
  outputs: buildGitLabCommentOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Note Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
