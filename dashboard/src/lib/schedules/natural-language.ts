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
  /** A relative request such as "in 90 minutes" runs once, not every day. */
  oneShot: boolean;
  /** Exact fire time for a one-shot request; null for recurring cron schedules. */
  runAt: string | null;
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

interface RelativeDelay {
  matched: string;
  milliseconds: number;
}

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

const NUMBER_TOKEN = String.raw`(?:\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;

function numberFromToken(value: string): number {
  return NUMBER_WORDS[value.toLowerCase()] ?? Number(value);
}

/** Read "in an hour and a half", "after 1.5 hours", and "in 90 minutes". */
function readRelativeDelay(text: string): RelativeDelay | null {
  const halfHour = /\b(?:in|after)\s+half\s+(?:an?\s+)?hour\b/i.exec(text);
  if (halfHour) {
    return { matched: halfHour[0], milliseconds: 30 * 60_000 };
  }

  const pattern = new RegExp(
    String.raw`\b(?:in|after)\s+(${NUMBER_TOKEN})\s*(hours?|hrs?|minutes?|mins?)` +
      String.raw`(\s*(?:and\s+)?(?:an?\s+)?half)?` +
      String.raw`(?:\s*(?:and\s+)?(${NUMBER_TOKEN})\s*(minutes?|mins?))?\b`,
    "i",
  );
  const match = pattern.exec(text);
  if (!match) return null;

  const amount = numberFromToken(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const primaryIsHours = /^h/i.test(match[2]);
  let minutes = primaryIsHours ? amount * 60 : amount;
  if (primaryIsHours && match[3]) minutes += 30;
  if (match[4]) minutes += numberFromToken(match[4]);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return {
    matched: match[0],
    // The scheduler has minute resolution. Round a fractional minute up so a
    // request never fires earlier than the person asked.
    milliseconds: Math.ceil(minutes) * 60_000,
  };
}

function cronForOneShot(runAt: Date): string {
  return `${runAt.getMinutes()} ${runAt.getHours()} ${runAt.getDate()} ${runAt.getMonth() + 1} *`;
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

export function parseScheduleRequest(
  input: string,
  now: Date = new Date(),
): ParsedScheduleRequest {
  const text = input.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const relative = readRelativeDelay(lower);
  const time = readTimeOfDay(lower);
  const consumed: string[] = [];
  if (time.matched) consumed.push(time.matched);

  let cron: string;
  let recognized = time.matched !== null;
  let oneShot = false;
  let runAt: string | null = null;

  const weekdayIndex = DAY_NAMES.findIndex((day) =>
    new RegExp(`\\b(?:every |each |on )?${day}s?\\b`).test(lower),
  );
  const hourly = /\b(?:every|each) hour\b|\bhourly\b/.test(lower);
  const weekends = /\bweekends?\b/.test(lower);
  const weekdays = /\bweekdays?\b|\bwork ?days?\b|\bevery business day\b/.test(lower);
  const monthly = /\b(?:every|each) month\b|\bmonthly\b/.test(lower);
  const dayOfMonth = /\bon the (\d{1,2})(?:st|nd|rd|th)?\b/.exec(lower);
  const weekly = /\b(?:every|each) week\b|\bweekly\b/.test(lower);

  if (relative) {
    const due = new Date(now.getTime() + relative.milliseconds);
    cron = cronForOneShot(due);
    recognized = true;
    oneShot = true;
    runAt = due.toISOString();
    consumed.push(relative.matched);
  } else if (hourly) {
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
    description: oneShot ? "Once" : describeCronExpression(cron),
    prompt,
    title: titleFrom(prompt),
    recognized,
    oneShot,
    runAt,
  };
}

const RECURRING_SCHEDULE_CUE =
  /\b(?:every|each|hourly|daily|weekly|monthly|weekdays?|weekends?|work ?days?)\b/i;
const SCHEDULE_ACTION_CUE =
  /\b(?:schedule|start|begin|run|launch|execute|do|remind|send|check|write|create|make|prepare|draft|research|review|summarize|analyse|analyze|build|update|fetch|find|look up)\b/i;

/**
 * Conservative intent gate for the ordinary chat composer.
 *
 * The Scheduled panel can parse any draft and show its assumption. A normal
 * chat must be stricter: a question that merely mentions "at 3pm" must still
 * be sent as a question. Only an explicit recurring cadence, or a relative
 * delay paired with an action verb, is diverted into the scheduler.
 */
export function parseExplicitScheduleRequest(
  input: string,
  now: Date = new Date(),
): ParsedScheduleRequest | null {
  const parsed = parseScheduleRequest(input, now);
  if (!parsed.recognized) return null;
  if (RECURRING_SCHEDULE_CUE.test(input)) return parsed;
  if (parsed.oneShot && SCHEDULE_ACTION_CUE.test(input)) return parsed;
  return null;
}
