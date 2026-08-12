// Shared scheduled-chat types. Kept free of the SQLite store so client
// components can import the shape the API returns without pulling better-sqlite3
// into the browser bundle.

export type ScheduledChatSurface = "dashboard_terminal" | "garden_chat";
export type ScheduledChatRunStatus = "ok" | "failed";

/** The shape the API and the UI exchange. */
export interface ScheduledChatJob {
  id: number;
  title: string;
  prompt: string;
  cron: string;
  cronDescription: string;
  surface: ScheduledChatSurface;
  gardenSlug: string | null;
  promptSlug: string | null;
  enabled: boolean;
  /** ISO timestamp; null while the schedule is paused. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: ScheduledChatRunStatus | null;
  lastError: string | null;
  lastConversationId: string | null;
  runCount: number;
  createdAt: string;
  /**
   * Whether a firing of this schedule is in flight right now.
   *
   * Read from the execution lease rather than tracked separately, so it cannot
   * disagree with the thing that actually decides whether the job may fire
   * again — and so a process that dies mid-run stops claiming to be running
   * once its lease lapses.
   */
  running: boolean;
}

export function scheduleTargetLabel(
  job: Pick<ScheduledChatJob, "surface" | "gardenSlug">,
): string {
  return job.surface === "garden_chat" && job.gardenSlug
    ? `${job.gardenSlug} chat`
    : "Dashboard terminal";
}
