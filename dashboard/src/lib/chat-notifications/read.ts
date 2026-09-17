import type Database from "better-sqlite3";
import { listPendingChatNotifications } from "./store.ts";
import { listPendingLearnNotifications } from "./learn.ts";
import { listPendingQuestionNotifications } from "./questions.ts";

export const DEFAULT_NOTIFICATION_LIMIT = 5;
export const MAX_NOTIFICATION_LIMIT = 10;
const MAX_CONTENT_LENGTH = 6_000;

/** SQLite timestamps are UTC even though they do not carry a timezone suffix. */
export function notificationTimestamp(value: string): number {
  const normalized = value.replace(" ", "T");
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)
    ? `${normalized}Z` : normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Read the same pending inbox as the product, without dismissing any notices. */
export function readLatestNotifications(database: Database.Database, userId: number, limit = DEFAULT_NOTIFICATION_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NOTIFICATION_LIMIT) {
    throw new RangeError(`Limit must be an integer from 1 to ${MAX_NOTIFICATION_LIMIT}.`);
  }
  const pending = [
    ...listPendingChatNotifications(database, userId),
    ...listPendingQuestionNotifications(database, userId),
    ...listPendingLearnNotifications(database, userId),
  ].reverse().sort((left, right) => notificationTimestamp(right.updatedAt) - notificationTimestamp(left.updatedAt));
  return {
    capturedAt: new Date().toISOString(),
    scope: "undismissed" as const,
    order: "newest_first" as const,
    availableCount: pending.length,
    hasMore: pending.length > limit,
    notifications: pending.slice(0, limit).map(notice => {
      const content = (notice.response || notice.message || "").trim();
      return {
        id: notice.id,
        kind: notice.kind ?? "chat_response",
        title: notice.title,
        source: notice.chatTitle.slice(0, 300),
        updatedAt: notice.updatedAt,
        content: content.slice(0, MAX_CONTENT_LENGTH),
        contentTruncated: content.length > MAX_CONTENT_LENGTH,
        target: notice.target,
        ...(notice.progressPercent !== undefined ? { progressPercent: notice.progressPercent } : {}),
      };
    }),
  };
}
