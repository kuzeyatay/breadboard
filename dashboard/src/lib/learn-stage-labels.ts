import type { LearnStatus } from "./learn-utils.ts";

/**
 * Human wording for each phase a Learn run passes through. The Learn panel,
 * the corner notices, and the Hermes process-status tool all describe the
 * same row from `learn_jobs`, so they must all say the same thing about it.
 */
export const LEARN_ACTIVE_STAGE_LABELS: Partial<Record<LearnStatus, string>> = {
  planning: "Planning the Learning Map",
  analyzing_issues: "Analyzing validation issues",
  repairing: "Repairing affected pages and components",
  revalidating: "Revalidating the complete garden",
  publishing_repair: "Publishing repaired projection",
  generating_learning_pages: "Writing lesson pages",
  generating_textbook: "Writing lesson pages",
  generating_visuals: "Generating lesson visuals",
  writing_quartz: "Writing Quartz files",
  building_navigation: "Validating and rebuilding navigation",
  paused: "Paused",
};

export const LEARN_STAGE_LABELS: Partial<Record<LearnStatus, string>> = {
  ...LEARN_ACTIVE_STAGE_LABELS,
  awaiting_confirmation: "Learning Map ready for review",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
  idle: "Idle",
};

/** Statuses during which a worker is actively producing the garden. */
export const LEARN_RUNNING_STATUSES: readonly LearnStatus[] = [
  "planning",
  "analyzing_issues",
  "repairing",
  "revalidating",
  "publishing_repair",
  "generating_learning_pages",
  "generating_textbook",
  "generating_visuals",
  "writing_quartz",
  "building_navigation",
];

export function learnStageLabel(status: LearnStatus | string): string {
  return LEARN_STAGE_LABELS[status as LearnStatus] ?? String(status).replace(/_/g, " ");
}

export function isLearnRunningStatus(status: string): boolean {
  return LEARN_RUNNING_STATUSES.includes(status as LearnStatus);
}
