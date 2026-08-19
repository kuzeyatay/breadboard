// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/registry.ts, adapted for Breadboard.
// Pruned to the 7 vendored trigger definitions per the triggers-report tiers
// (generic, github + its per-event variants, telegram, stripe, slack, linear,
// gitlab). Sim's registry statically imports ~70 provider directories; this
// one imports only what was vendored.

import { genericWebhookTrigger } from './generic'
import {
  githubIssueClosedTrigger,
  githubIssueCommentTrigger,
  githubIssueOpenedTrigger,
  githubPRClosedTrigger,
  githubPRCommentTrigger,
  githubPRMergedTrigger,
  githubPROpenedTrigger,
  githubPRReviewedTrigger,
  githubPushTrigger,
  githubReleasePublishedTrigger,
  githubWebhookTrigger,
  githubWorkflowRunTrigger,
} from './github'
import { telegramWebhookTrigger } from './telegram'
import { stripeWebhookTrigger } from './stripe'
import { slackWebhookTrigger } from './slack'
import { linearWebhookTrigger } from './linear'
import { gitlabWebhookTrigger } from './gitlab'
import type { TriggerRegistry } from './types'

export const TRIGGER_REGISTRY: TriggerRegistry = {
  generic_webhook: genericWebhookTrigger,
  github_webhook: githubWebhookTrigger,
  github_issue_opened: githubIssueOpenedTrigger,
  github_issue_closed: githubIssueClosedTrigger,
  github_issue_comment: githubIssueCommentTrigger,
  github_pr_opened: githubPROpenedTrigger,
  github_pr_closed: githubPRClosedTrigger,
  github_pr_merged: githubPRMergedTrigger,
  github_pr_comment: githubPRCommentTrigger,
  github_pr_reviewed: githubPRReviewedTrigger,
  github_push: githubPushTrigger,
  github_release_published: githubReleasePublishedTrigger,
  github_workflow_run: githubWorkflowRunTrigger,
  telegram_webhook: telegramWebhookTrigger,
  stripe_webhook: stripeWebhookTrigger,
  slack_webhook: slackWebhookTrigger,
  linear_webhook: linearWebhookTrigger,
  gitlab_webhook: gitlabWebhookTrigger,
}
