import type Database from "better-sqlite3";
import type {
  ChatNotificationRecord,
  ChatNotificationTitle,
} from "../chat-notification-inbox.ts";
import { isLearnRunningStatus, learnStageLabel } from "../learn-stage-labels.ts";

/**
 * Learn-pipeline notices in the same account-scoped inbox as chat answers.
 *
 * A Learn run is one row in `learn_jobs` that moves through planning, writing,
 * validation and publication over many minutes, usually while the person is
 * somewhere else. Two kinds of notice describe it. A *status* notice follows
 * the run while it is active — its stage and percentage update on every poll,
 * so the card in the corner behaves like a progress indicator rather than a
 * stack of separate messages. A *terminal* notice announces where the run
 * ended: complete, failed, cancelled, or parked (paused, or waiting for the
 * Learning Map to be reviewed).
 *
 * Dismissals are recorded per job *phase*, not per job: closing the progress
 * card must not silence the completion that follows it, and closing the
 * completion must not resurrect the progress card. Like the chat inbox, all
 * of this lives in the database so every window agrees.
 */

export const MAX_PENDING_LEARN_NOTIFICATIONS = 12;

export type LearnNotificationPhase =
  | "active"
  | "awaiting_confirmation"
  | "paused"
  | "complete"
  | "failed"
  | "cancelled";

const PHASES: readonly LearnNotificationPhase[] = [
  "active",
  "awaiting_confirmation",
  "paused",
  "complete",
  "failed",
  "cancelled",
];

const PHASE_TITLES: Record<LearnNotificationPhase, ChatNotificationTitle> = {
  active: "Learn in progress",
  awaiting_confirmation: "Learn awaiting review",
  paused: "Learn paused",
  complete: "Learn complete",
  failed: "Learn failed",
  cancelled: "Learn cancelled",
};

const MAX_ERROR_CHARS = 240;

interface LearnJobNoticeRow {
  id: string;
  garden_id: string;
  garden_name: string;
  status: string;
  current_step: string | null;
  progress_percent: number;
  current_section_title: string | null;
  current_page_title: string | null;
  error: string | null;
  paused_from_status: string | null;
  updated_at: string;
}

interface LearnBaselineRow {
  baseline_at: string;
}

export function ensureLearnNotificationSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS learn_notification_baselines (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      baseline_at TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS learn_notification_dismissals (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id       TEXT NOT NULL,
      phase        TEXT NOT NULL,
      dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, job_id, phase)
    );
  `);
}

export function learnNotificationPhaseForStatus(
  status: string,
): LearnNotificationPhase | null {
  if (isLearnRunningStatus(status)) return "active";
  switch (status) {
    case "awaiting_confirmation":
    case "paused":
    case "complete":
    case "failed":
    case "cancelled":
      return status;
    default:
      return null;
  }
}

export function learnNotificationId(
  jobId: string,
  phase: LearnNotificationPhase,
): string {
  return `learn_${jobId}:${phase}`;
}

/** Parse `learn_<jobId>:<phase>`; anything else (including SQL-shaped ids) is null. */
export function parseLearnNotificationId(
  id: string,
): { jobId: string; phase: LearnNotificationPhase } | null {
  const match = /^learn_([A-Za-z0-9][A-Za-z0-9_-]{0,119}):([a-z_]{1,32})$/.exec(id.trim());
  if (!match) return null;
  const phase = match[2] as LearnNotificationPhase;
  if (!PHASES.includes(phase)) return null;
  return { jobId: match[1], phase };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function shortError(error: string | null): string {
  const text = (error ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "The Learn run stopped with an error.";
  return text.length > MAX_ERROR_CHARS
    ? `${text.slice(0, MAX_ERROR_CHARS - 1).trimEnd()}…`
    : text;
}

/** One line of detail for the card; the panel shows the rest. */
export function learnNotificationMessage(
  row: Pick<
    LearnJobNoticeRow,
    | "status"
    | "current_step"
    | "progress_percent"
    | "current_section_title"
    | "current_page_title"
    | "error"
    | "paused_from_status"
  >,
  phase: LearnNotificationPhase,
): string {
  switch (phase) {
    case "complete":
      return "The lessons are ready to read.";
    case "failed":
      return shortError(row.error);
    case "cancelled":
      return "The Learn run was cancelled.";
    case "awaiting_confirmation":
      return "The Learning Map is ready for review.";
    case "paused": {
      const resumesInto = row.paused_from_status
        ? learnStageLabel(row.paused_from_status)
        : null;
      return resumesInto ? `Paused during: ${resumesInto}.` : "Paused.";
    }
    case "active": {
      const parts = [
        row.current_step?.trim() || learnStageLabel(row.status),
        `${clampPercent(row.progress_percent)}%`,
      ];
      if (row.current_section_title?.trim()) {
        parts.push(`Section: ${row.current_section_title.trim()}`);
      }
      if (row.current_page_title?.trim()) {
        parts.push(`Page: ${row.current_page_title.trim()}`);
      }
      return parts.join(" · ");
    }
  }
}

function recordFromRow(
  row: LearnJobNoticeRow,
  phase: LearnNotificationPhase,
): ChatNotificationRecord {
  return {
    id: learnNotificationId(row.id, phase),
    kind: "learn",
    title: PHASE_TITLES[phase],
    type: phase === "failed" ? "error" : "success",
    response: "",
    message: learnNotificationMessage(row, phase),
    chatTitle: row.garden_name,
    target: { surface: "garden_learn", gardenSlug: row.garden_id, chatId: row.id },
    updatedAt: row.updated_at,
    ...(phase === "active"
      ? { progressPercent: clampPercent(row.progress_percent) }
      : {}),
  };
}

/**
 * The first read for an account draws a line under everything that already
 * happened. A run that finished last week is history, not news; a run that is
 * active right now keeps updating its row, so it crosses the line on its own.
 */
export function ensureLearnNotificationBaseline(
  database: Database.Database,
  userId: number,
  now: () => string = () => new Date().toISOString(),
): string {
  const existing = database.prepare(`
    SELECT baseline_at FROM learn_notification_baselines WHERE user_id = ?
  `).get(userId) as LearnBaselineRow | undefined;
  if (existing) return existing.baseline_at;
  const baseline = now();
  database.prepare(`
    INSERT OR IGNORE INTO learn_notification_baselines (user_id, baseline_at)
    VALUES (?, ?)
  `).run(userId, baseline);
  return baseline;
}

const LEARN_NOTICE_ROWS_SQL = `
  SELECT j.id, j.garden_id, c.name AS garden_name, j.status, j.current_step,
         j.progress_percent, j.current_section_title, j.current_page_title,
         j.error, j.paused_from_status, j.updated_at
  FROM learn_jobs j
  JOIN clusters c ON c.slug = j.garden_id AND c.user_id = @userId
  WHERE j.updated_at > @baselineAt
    AND j.status <> 'idle'
`;

function pendingRows(
  database: Database.Database,
  userId: number,
  gardenSlug: string | null,
): Array<{ row: LearnJobNoticeRow; phase: LearnNotificationPhase }> {
  const hasLearnTables = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'learn_jobs'
  `).get();
  if (!hasLearnTables) return [];
  const baselineAt = ensureLearnNotificationBaseline(database, userId);
  const rows = database.prepare(`
    ${LEARN_NOTICE_ROWS_SQL}
    ${gardenSlug === null ? "" : "AND j.garden_id = @gardenSlug"}
    ORDER BY j.updated_at DESC, j.rowid DESC
    LIMIT @limit
  `).all({
    userId,
    baselineAt,
    gardenSlug: gardenSlug ?? "",
    limit: MAX_PENDING_LEARN_NOTIFICATIONS * 3,
  }) as LearnJobNoticeRow[];
  const dismissed = database.prepare(`
    SELECT 1 FROM learn_notification_dismissals
    WHERE user_id = ? AND job_id = ? AND phase = ?
  `);
  const seenGardensActive = new Set<string>();
  const pending: Array<{ row: LearnJobNoticeRow; phase: LearnNotificationPhase }> = [];
  for (const row of rows) {
    const phase = learnNotificationPhaseForStatus(row.status);
    if (!phase) continue;
    // Only the newest run per Garden may claim the live status card; an
    // older row still marked active is a stale worker the recovery pass will
    // reclaim, not a second pipeline.
    if (phase === "active") {
      if (seenGardensActive.has(row.garden_id)) continue;
      seenGardensActive.add(row.garden_id);
    }
    if (dismissed.get(userId, row.id, phase)) continue;
    pending.push({ row, phase });
  }
  return pending.slice(0, MAX_PENDING_LEARN_NOTIFICATIONS);
}

/** Every Learn notice the account has not yet dismissed, oldest first. */
export function listPendingLearnNotifications(
  database: Database.Database,
  userId: number,
): ChatNotificationRecord[] {
  return pendingRows(database, userId, null)
    .map(({ row, phase }) => recordFromRow(row, phase))
    .reverse();
}

/** Dismiss specific notices. Ids for jobs outside the account's Gardens are ignored. */
export function dismissLearnNotifications(
  database: Database.Database,
  userId: number,
  ids: readonly { jobId: string; phase: LearnNotificationPhase }[],
): number {
  if (ids.length === 0) return 0;
  const hasLearnTables = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'learn_jobs'
  `).get();
  if (!hasLearnTables) return 0;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO learn_notification_dismissals (user_id, job_id, phase)
    SELECT @userId, j.id, @phase
    FROM learn_jobs j
    JOIN clusters c ON c.slug = j.garden_id AND c.user_id = @userId
    WHERE j.id = @jobId
  `);
  let dismissed = 0;
  const run = database.transaction(() => {
    for (const { jobId, phase } of ids) {
      dismissed += insert.run({ userId, jobId, phase }).changes;
    }
  });
  run();
  return dismissed;
}

/**
 * The person is looking at this Garden's Learn panel, which already shows
 * everything a notice would say: every pending Learn notice for the Garden
 * is now seen.
 */
export function dismissLearnNotificationsForGarden(
  database: Database.Database,
  userId: number,
  gardenSlug: string,
): number {
  const pending = pendingRows(database, userId, gardenSlug);
  return dismissLearnNotifications(
    database,
    userId,
    pending.map(({ row, phase }) => ({ jobId: row.id, phase })),
  );
}
