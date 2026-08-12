// "every friday at 6pm send me a summary of the week" → a cron expression and
// the instruction with the timing words taken back out.
//
// This is a deliberately small, deterministic reader, not an intent model: it
// recognizes the handful of cadences the scheduler can actually express, and
// falls back to a daily 09:00 job it then shows the user, so an unparsed phrase
// produces a schedule you can see and correct rather than a silent guess.

import { describeCronExpression } from "./cron.ts";

export interface ParsedScheduleRequest {
  cron: string;
  /** Wording of the cron expression, for confirming what was understood. */
  description: string;
  /** The instruction with the recognized timing phrases removed. */
  prompt: string;
  title: string;
  /** False when nothing about the timing was recognized and the default applied. */
  recognized: boolean;
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const NAMED_TIMES: Array<{ pattern: RegExp; hour: number; minute: number }> = [
  { pattern: /\bmidnight\b/, hour: 0, minute: 0 },
  { pattern: /\bnoon\b|\bmidday\b/, hour: 12, minute: 0 },
  { pattern: /\b(?:in the )?morning\b|\beach morning\b/, hour: 9, minute: 0 },
  { pattern: /\b(?:in the )?afternoon\b/, hour: 14, minute: 0 },
  { pattern: /\b(?:in the )?evening\b|\btonight\b/, hour: 19, minute: 0 },
  { pattern: /\b(?:at )?night\b/, hour: 21, minute: 0 },
];

const LEADING_NOISE =
  /^(?:please\s+)?(?:can you\s+)?(?:schedule|set up|set|create|make|add|remind me to|remind me|have (?:it|you)|i want you to|i'd like you to)\s+/i;

interface TimeOfDay {
  hour: number;
  minute: number;
  matched: string | null;
}

function readTimeOfDay(text: string): TimeOfDay {
  const clock = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (clock) {
    const rawHour = Number(clock[1]) % 12;
    const hour = clock[3].toLowerCase() === "pm" ? rawHour + 12 : rawHour;
    return { hour, minute: Number(clock[2] ?? 0), matched: clock[0] };
  }

  const twentyFour = /\bat\s+(\d{1,2}):(\d{2})\b/.exec(text);
  if (twentyFour) {
    return {
      hour: Math.min(23, Number(twentyFour[1])),
      minute: Math.min(59, Number(twentyFour[2])),
      matched: twentyFour[0],
    };
  }

  const bareHour = /\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th))/.exec(text);
  if (bareHour) {
    return { hour: Math.min(23, Number(bareHour[1])), minute: 0, matched: bareHour[0] };
  }

  for (const named of NAMED_TIMES) {
    const match = named.pattern.exec(text);
    if (match) return { hour: named.hour, minute: named.minute, matched: match[0] };
  }

  return { hour: 9, minute: 0, matched: null };
}

function titleFrom(prompt: string): string {
  const words = prompt.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return "Scheduled chat";
  const title = words.slice(0, 6).join(" ");
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`.slice(0, 80);
}

export function parseScheduleRequest(input: string): ParsedScheduleRequest {
  const text = input.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const time = readTimeOfDay(lower);
  const consumed: string[] = [];
  if (time.matched) consumed.push(time.matched);

  let cron: string;
  let recognized = time.matched !== null;

  const weekdayIndex = DAY_NAMES.findIndex((day) =>
    new RegExp(`\\b(?:every |each |on )?${day}s?\\b`).test(lower),
  );
  const hourly = /\b(?:every|each) hour\b|\bhourly\b/.test(lower);
  const weekends = /\bweekends?\b/.test(lower);
  const weekdays = /\bweekdays?\b|\bwork ?days?\b|\bevery business day\b/.test(lower);
  const monthly = /\b(?:every|each) month\b|\bmonthly\b/.test(lower);
  const dayOfMonth = /\bon the (\d{1,2})(?:st|nd|rd|th)?\b/.exec(lower);
  const weekly = /\b(?:every|each) week\b|\bweekly\b/.test(lower);

  if (hourly) {
    cron = `${time.minute} * * * *`;
    recognized = true;
    consumed.push("every hour", "each hour", "hourly");
  } else if (weekdays) {
    cron = `${time.minute} ${time.hour} * * 1-5`;
    recognized = true;
    consumed.push("every weekday", "each weekday", "weekdays", "weekday", "work days", "workdays");
  } else if (weekends) {
    cron = `${time.minute} ${time.hour} * * 0,6`;
    recognized = true;
    consumed.push("every weekend", "weekends", "weekend");
  } else if (weekdayIndex >= 0) {
    cron = `${time.minute} ${time.hour} * * ${weekdayIndex}`;
    recognized = true;
    consumed.push(
      `every ${DAY_NAMES[weekdayIndex]}`,
      `each ${DAY_NAMES[weekdayIndex]}`,
      `on ${DAY_NAMES[weekdayIndex]}`,
      `${DAY_NAMES[weekdayIndex]}s`,
      DAY_NAMES[weekdayIndex],
    );
  } else if (monthly || dayOfMonth) {
    const day = Math.min(28, Math.max(1, Number(dayOfMonth?.[1] ?? 1)));
    cron = `${time.minute} ${time.hour} ${day} * *`;
    recognized = true;
    consumed.push("every month", "each month", "monthly");
    if (dayOfMonth) consumed.push(dayOfMonth[0]);
  } else if (weekly) {
    cron = `${time.minute} ${time.hour} * * 1`;
    recognized = true;
    consumed.push("every week", "each week", "weekly");
  } else {
    cron = `${time.minute} ${time.hour} * * *`;
    if (/\b(?:every|each) day\b|\bdaily\b|\bevery morning\b|\bevery evening\b/.test(lower)) {
      recognized = true;
    }
    consumed.push("every day", "each day", "daily", "every morning", "every evening");
  }

  let prompt = text;
  for (const phrase of consumed) {
    if (!phrase) continue;
    prompt = prompt.replace(
      new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      " ",
    );
  }
  prompt = prompt
    .replace(LEADING_NOISE, "")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
  if (!prompt) prompt = text;

  return {
    cron,
    description: describeCronExpression(cron),
    prompt,
    title: titleFrom(prompt),
    recognized,
  };
}
