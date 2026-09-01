import type { AssistantReasoningEffort } from "../assistant-reasoning.ts";

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
  model: string;
  reasoningEffort: AssistantReasoningEffort;
  /** Runs once at nextRunAt, then disarms itself. */
  oneShot: boolean;
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

/**
 * Small, durable subset of a schedule attached to the assistant confirmation
 * that created it. Keeping this separate from the live job means an old chat
 * can still explain what it scheduled even after that job has been edited or
 * deleted.
 */
export interface ScheduledChatReceipt {
  id: number;
  title: string;
  cronDescription: string;
  oneShot: boolean;
  nextRunAt: string | null;
}

export function normalizeScheduledChatReceipt(
  value: unknown,
): ScheduledChatReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  const id = Number(receipt.id);
  const title = typeof receipt.title === "string" ? receipt.title.trim() : "";
  const cronDescription = typeof receipt.cronDescription === "string"
    ? receipt.cronDescription.trim()
    : "";
  const nextRunAt = receipt.nextRunAt === null
    ? null
    : typeof receipt.nextRunAt === "string" &&
        Number.isFinite(Date.parse(receipt.nextRunAt))
      ? receipt.nextRunAt
      : undefined;
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !title ||
    !cronDescription ||
    typeof receipt.oneShot !== "boolean" ||
    nextRunAt === undefined
  ) {
    return null;
  }
  return {
    id,
    title: title.slice(0, 200),
    cronDescription: cronDescription.slice(0, 200),
    oneShot: receipt.oneShot,
    nextRunAt,
  };
}

export function scheduledChatReceiptFromJob(
  job: Pick<
    ScheduledChatJob,
    "id" | "title" | "cronDescription" | "oneShot" | "nextRunAt"
  >,
): ScheduledChatReceipt {
  return {
    id: job.id,
    title: job.title,
    cronDescription: job.cronDescription,
    oneShot: job.oneShot,
    nextRunAt: job.nextRunAt,
  };
}

/** One concise line above the richer receipt card in the transcript. */
export function scheduledChatConfirmationText(
  receipt: ScheduledChatReceipt,
): string {
  if (receipt.oneShot && receipt.nextRunAt) {
    const runAt = new Date(receipt.nextRunAt);
    if (!Number.isNaN(runAt.getTime())) {
      return `Scheduled “${receipt.title}” for ${runAt.toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}.`;
    }
  }
  return `Scheduled “${receipt.title}” (${receipt.cronDescription}).`;
}

/** The exact phone text emitted when a messaging-origin reminder comes due. */
export function scheduledReminderText(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  const message = clean
    ? `${clean.charAt(0).toLocaleUpperCase()}${clean.slice(1)}`
    : "Your reminder is due";
  return `Reminder: ${message}${/[.!?]$/u.test(message) ? "" : "."}`;
}

export function scheduleTargetLabel(
  job: Pick<ScheduledChatJob, "surface" | "gardenSlug">,
): string {
  return job.surface === "garden_chat" && job.gardenSlug
    ? `${job.gardenSlug} chat`
    : "Dashboard terminal";
}
