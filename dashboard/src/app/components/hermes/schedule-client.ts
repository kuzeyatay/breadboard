// Framework-free helpers shared by the Scheduled panel and the dashboard dock:
// which surfaces can host a scheduled chat, how the cadence picker maps onto
// cron, and how run times are worded. Kept out of the .tsx so it stays directly
// unit-testable.

import type { HermesSurface } from "@/lib/hermes/config.ts";
import type { ScheduledChatSurface } from "@/lib/schedules/types.ts";

export const SCHEDULES_CHANGED_EVENT = "breadboard:schedules-changed";
export const OPEN_SCHEDULES_PANEL_EVENT = "breadboard:open-schedules-panel";

export type ScheduleCadence =
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "hourly"
  | "custom";

export const SCHEDULE_CADENCES: Array<{ id: ScheduleCadence; label: string }> = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Every weekday" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "hourly", label: "Every hour" },
  { id: "custom", label: "Custom cron" },
];

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Only surfaces that own a chat history can host a scheduled chat. */
export function schedulableSurface(
  surface: HermesSurface,
  gardenSlug?: string | null,
): ScheduledChatSurface | null {
  if (surface === "dashboard_terminal") return "dashboard_terminal";
  if (surface === "garden_chat" && gardenSlug) return "garden_chat";
  return null;
}

export function notifySchedulesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCHEDULES_CHANGED_EVENT));
}

export function requestOpenSchedulesPanel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SCHEDULES_PANEL_EVENT));
}

export function cronFromCadence(input: {
  cadence: ScheduleCadence;
  time: string;
  weekday: number;
  dayOfMonth: number;
  custom: string;
}): string {
  if (input.cadence === "custom") return input.custom.trim();
  const [rawHour, rawMinute] = input.time.split(":");
  const hour = Math.min(23, Math.max(0, Number(rawHour) || 0));
  const minute = Math.min(59, Math.max(0, Number(rawMinute) || 0));
  switch (input.cadence) {
    case "hourly":
      return `${minute} * * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${input.weekday}`;
    case "monthly":
      // Clamped to a day every month actually has, so a monthly job never skips.
      return `${minute} ${hour} ${Math.min(28, Math.max(1, input.dayOfMonth))} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

export function formatRunTime(value: string | null): string {
  if (!value) return "Paused";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in 4 min" / "in 3 h" / "tomorrow" — a glanceable countdown. */
export function formatRelativeRunTime(
  value: string | null,
  now: number = Date.now(),
): string {
  if (!value) return "Paused";
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "Unknown";
  const minutes = Math.round((target - now) / 60_000);
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
