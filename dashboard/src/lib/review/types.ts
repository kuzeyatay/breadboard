// Shared spaced-repetition types.
//
// Kept free of the SQLite store and of the vendored FSRS module so client
// components can import these shapes without pulling better-sqlite3 — or a
// scheduler that reasons in `Date` objects — into the browser bundle. The same
// split the scheduled-chat types already make (see ../schedules/types.ts).

/**
 * Where a garden's questions are delivered.
 *
 * A single per-user choice rather than a per-garden one: the point of review is
 * that it arrives without being sought, and a person has one phone, not one per
 * garden. `off` is distinct from having no row — it means the user was asked and
 * declined, so nothing should nag them to pick a channel again.
 */
export type ReviewChannel = "off" | "whatsapp" | "telegram";

export const REVIEW_CHANNELS: readonly ReviewChannel[] = ["off", "whatsapp", "telegram"] as const;

export function isReviewChannel(value: unknown): value is ReviewChannel {
  return typeof value === "string" && (REVIEW_CHANNELS as readonly string[]).includes(value);
}

/**
 * The four FSRS grades, mirrored from the vendored `Rating` enum.
 *
 * Mirrored rather than re-exported so this module stays importable from a client
 * component. The numbers are load-bearing — they are what gets handed back to
 * FSRS — so ./scheduling.ts asserts they still line up with the vendored enum.
 */
export const REVIEW_GRADES = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
} as const;

export type ReviewGradeName = keyof typeof REVIEW_GRADES;
export type ReviewGradeValue = (typeof REVIEW_GRADES)[ReviewGradeName];

/** Per-user delivery preference, set on the profile page. */
export interface ReviewUserSettings {
  channel: ReviewChannel;
  /** Max questions sent across all gardens in one day. */
  dailyLimit: number;
  /** Local hour (0–23) at which the day's questions go out. */
  sendHour: number;
  /**
   * FSRS target recall probability. 0.9 is upstream's default and means
   * "schedule me so I recall ~90% of what I'm asked".
   */
  desiredRetention: number;
}

export const DEFAULT_REVIEW_USER_SETTINGS: ReviewUserSettings = {
  channel: "off",
  dailyLimit: 5,
  sendHour: 8,
  desiredRetention: 0.9,
};

/** Per-garden participation, set from the garden chat's settings panel. */
export interface ReviewGardenSettings {
  gardenSlug: string;
  enabled: boolean;
  /** How many of the daily budget this garden may claim. */
  dailyLimit: number;
  cardCount: number;
  dueCount: number;
  /** ISO timestamp of the most recent seed pass, or null if never seeded. */
  lastSeededAt: string | null;
}

export interface ReviewCardSummary {
  id: number;
  gardenSlug: string;
  pageSlug: string;
  pageTitle: string;
  question: string;
  due: string;
  state: number;
  reps: number;
  lapses: number;
  suspended: boolean;
}

export interface ReviewStats {
  total: number;
  due: number;
  newCards: number;
  learning: number;
  review: number;
  /** Reviews answered in the last 30 days. */
  answered30d: number;
  /** Share of those graded `good` or `easy`, or null when nothing was answered. */
  retention30d: number | null;
}

export function clampDailyLimit(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, n));
}

export function clampSendHour(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, n));
}

export function clampDesiredRetention(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Upstream rejects anything outside this band: below 0.7 the intervals grow
  // absurd, and above 0.97 they collapse to daily drilling.
  return Math.min(0.97, Math.max(0.7, n));
}
