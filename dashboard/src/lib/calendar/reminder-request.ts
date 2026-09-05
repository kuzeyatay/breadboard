// Deterministic parsing and planning for short, calendar-backed reminder
// requests typed into Terminal. This deliberately handles a narrow promise:
// remind the user before today's classes. Anything broader stays in the normal
// assistant path instead of making a silent scheduling guess.

import type { CalendarCollection, CalendarOccurrence } from "./types.ts";
import {
  addMinutes,
  dateOf,
  nowStamp,
  parseStamp,
  timeOf,
  todayDate,
} from "./wallclock.ts";

export type ReminderDeliveryPreference = "telegram" | "whatsapp" | null;

export interface ParsedCalendarReminderRequest {
  kind: "today_classes";
  leadMinutes: number;
  deliveryPreference: ReminderDeliveryPreference;
}

export interface PlannedClassReminder {
  occurrence: CalendarOccurrence;
  /** ISO instant consumed by the existing one-shot scheduler. */
  runAt: string;
  /** Short text; the runner adds the standard `Reminder:` prefix. */
  prompt: string;
  /** True when the requested lead time had already passed, so it runs promptly. */
  catchingUp: boolean;
}

export interface ClassReminderPlan {
  reminders: PlannedClassReminder[];
  /** No event/class label matched, so all timed events were treated as classes. */
  usedTimedEventFallback: boolean;
}

const CLASS_CUE = /\b(?:class|classes|lecture|lectures|seminar|tutorial|workshop|lab|laboratory|course|school|college|university)\b/i;
const REMINDER_CUE = /\bremind(?:er|ers|ing)?\b/i;
const TODAY_CUE = /\btoday\b/i;
const BEFORE_CUE = /\b(?:earlier|before|ahead)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const NUMBER_TOKEN = String.raw`(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;

function normalizedRequest(input: string): string {
  return input
    .toLowerCase()
    // These are common dictation/typing slips in exactly this short phrase.
    .replace(/\berlier\b/g, "earlier")
    .replace(/\band\s+hour\b/g, "an hour")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromToken(value: string): number {
  return NUMBER_WORDS[value] ?? Number(value);
}

function leadMinutes(text: string): number | null {
  const half = /\bhalf\s+(?:an?\s+)?hour\s+(?:earlier|before|ahead)\b/i.exec(text);
  if (half) return 30;

  const pattern = new RegExp(
    String.raw`\b(${NUMBER_TOKEN})\s*(hours?|hrs?|minutes?|mins?)` +
      String.raw`(?:\s+and\s+(?:a\s+)?half)?\s+(?:earlier|before|ahead)\b`,
    "i",
  );
  const match = pattern.exec(text);
  if (!match) return null;
  const amount = numberFromToken(match[1].toLowerCase());
  const isHours = /^h/i.test(match[2]);
  const includesHalf = /\band\s+(?:a\s+)?half\b/i.test(match[0]);
  const minutes = Math.round(amount * (isHours ? 60 : 1) + (includesHalf ? 30 : 0));
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60
    ? minutes
    : null;
}

/**
 * Recognize requests such as “remind my classes an hour earlier today”.
 * The exact user-reported “and hour erlier” spelling is normalized too.
 */
export function parseCalendarReminderRequest(
  input: string,
): ParsedCalendarReminderRequest | null {
  const text = normalizedRequest(input);
  if (
    !REMINDER_CUE.test(text) ||
    !CLASS_CUE.test(text) ||
    !TODAY_CUE.test(text) ||
    !BEFORE_CUE.test(text)
  ) {
    return null;
  }
  const lead = leadMinutes(text);
  if (lead === null) return null;
  return {
    kind: "today_classes",
    leadMinutes: lead,
    deliveryPreference: /\btelegram\b/i.test(text)
      ? "telegram"
      : /\bwhats\s*app\b/i.test(text)
        ? "whatsapp"
        : null,
  };
}

function wallClockDate(stamp: string): Date | null {
  const clock = parseStamp(stamp);
  if (!clock) return null;
  const value = new Date(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    0,
    0,
  );
  return Number.isNaN(value.getTime()) ? null : value;
}

function classLike(
  occurrence: CalendarOccurrence,
  calendarNames: ReadonlyMap<number, string>,
): boolean {
  return CLASS_CUE.test(
    [
      occurrence.title,
      occurrence.description ?? "",
      calendarNames.get(occurrence.calendarId) ?? "",
    ].join(" "),
  );
}

function reminderPrompt(occurrence: CalendarOccurrence): string {
  const title = occurrence.title.trim() || "Your class";
  const location = occurrence.location?.trim();
  return `${title} starts at ${timeOf(occurrence.start)}${location ? ` at ${location}` : ""}`;
}

/** Build one one-shot reminder for each upcoming class occurrence today. */
export function planTodayClassReminders(input: {
  request: ParsedCalendarReminderRequest;
  occurrences: readonly CalendarOccurrence[];
  calendars: readonly CalendarCollection[];
  now?: Date;
}): ClassReminderPlan {
  const now = input.now ?? new Date();
  const today = todayDate(now);
  const currentStamp = nowStamp(now);
  const calendarNames = new Map(
    input.calendars.map((calendar) => [calendar.id, calendar.name]),
  );
  const unique = new Map<string, CalendarOccurrence>();
  for (const occurrence of input.occurrences) {
    if (
      occurrence.allDay ||
      dateOf(occurrence.start) !== today ||
      occurrence.start <= currentStamp
    ) {
      continue;
    }
    unique.set(occurrence.key, occurrence);
  }
  const upcoming = [...unique.values()].sort((left, right) =>
    left.start.localeCompare(right.start),
  );
  const labelled = upcoming.filter((occurrence) => classLike(occurrence, calendarNames));
  // Course titles are often opaque codes (5EPF0, CS101). If no explicit class
  // label exists, the user's own wording is stronger evidence than guessing
  // that their timed events are unrelated.
  const selected = labelled.length > 0 ? labelled : upcoming;
  const immediate = new Date(now.getTime() + 5_000);
  const reminders = selected.flatMap((occurrence): PlannedClassReminder[] => {
    const requestedStamp = addMinutes(occurrence.start, -input.request.leadMinutes);
    const requestedDate = wallClockDate(requestedStamp);
    if (!requestedDate) return [];
    const catchingUp = requestedDate.getTime() <= now.getTime();
    return [{
      occurrence,
      runAt: (catchingUp ? immediate : requestedDate).toISOString(),
      prompt: reminderPrompt(occurrence),
      catchingUp,
    }];
  });
  return {
    reminders,
    usedTimedEventFallback: labelled.length === 0 && upcoming.length > 0,
  };
}

export function describeLeadTime(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}
