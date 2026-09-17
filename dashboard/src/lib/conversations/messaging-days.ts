import { parseChatTimestamp } from "../chat-time-separators.ts";

/** Calendar dates in the device's local timezone, including daylight saving. */
export function messagingDayKey(value: string | Date): string | null {
  const timestamp = value instanceof Date ? value.getTime() : parseChatTimestamp(value);
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

/** Use creation time so a long-running turn cannot carry yesterday's chat forward. */
export function conversationIsSameDay(createdAt: string, now: Date): boolean {
  const timestamp = parseChatTimestamp(createdAt);
  return timestamp !== null && timestamp <= now.getTime() &&
    messagingDayKey(createdAt) === messagingDayKey(now);
}
