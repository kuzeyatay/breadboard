// Naive wall-clock arithmetic for the calendar.
//
// Events are stored as timezone-free local stamps ("YYYY-MM-DDTHH:MM"), the way
// a paper calendar records them: 09:00 stays 09:00 regardless of the machine's
// zone or whether a DST boundary sits between the event and today. Every
// calculation therefore routes through `Date.UTC` — the local `Date`
// constructor would silently shift a stamp by an hour across a DST change, and
// the same stamp would then render differently on the server and the client.
//
// The module is dependency-free on purpose so both the SQLite store and the
// browser views can share it.

export interface WallClock {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
}

const STAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MINUTES_PER_DAY = 24 * 60;

export const MIN_STAMP = "1970-01-01T00:00";
export const MAX_STAMP = "2999-12-31T23:59";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Parse a "YYYY-MM-DDTHH:MM" stamp. Returns null for anything malformed. */
export function parseStamp(value: unknown): WallClock | null {
  if (typeof value !== "string") return null;
  const match = STAMP_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (!isRealDate(year, month, day)) return null;
  if (hour > 23 || minute > 59) return null;

  return { year, month, day, hour, minute };
}

/** Parse a "YYYY-MM-DD" date. Returns null for anything malformed. */
export function parseDate(value: unknown): WallClock | null {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;

  return { year, month, day, hour: 0, minute: 0 };
}

export function formatStamp(clock: WallClock): string {
  return (
    `${String(clock.year).padStart(4, "0")}-${pad2(clock.month)}-${pad2(clock.day)}` +
    `T${pad2(clock.hour)}:${pad2(clock.minute)}`
  );
}

export function formatDate(clock: WallClock): string {
  return `${String(clock.year).padStart(4, "0")}-${pad2(clock.month)}-${pad2(clock.day)}`;
}

/** Minutes since the epoch, treating the wall clock as if it were UTC. */
export function toEpochMinutes(clock: WallClock): number {
  return (
    Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute) / 60_000
  );
}

export function fromEpochMinutes(minutes: number): WallClock {
  const date = new Date(minutes * 60_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/** The date half of a stamp ("2026-08-01T09:30" -> "2026-08-01"). */
export function dateOf(stamp: string): string {
  return stamp.slice(0, 10);
}

/** The time half of a stamp ("2026-08-01T09:30" -> "09:30"). */
export function timeOf(stamp: string): string {
  return stamp.slice(11, 16);
}

export function stampOf(date: string, time: string): string {
  return `${date}T${time}`;
}

export function startOfDay(date: string): string {
  return `${dateOf(date)}T00:00`;
}

/** 23:59 on the given day — the inclusive end used for all-day events. */
export function endOfDay(date: string): string {
  return `${dateOf(date)}T23:59`;
}

export function addMinutes(stamp: string, minutes: number): string {
  const clock = parseStamp(stamp);
  if (!clock) return stamp;
  return formatStamp(fromEpochMinutes(toEpochMinutes(clock) + minutes));
}

export function addDays(stamp: string, days: number): string {
  return addMinutes(stamp, days * MINUTES_PER_DAY);
}

/**
 * Add whole months, preserving the day of month. Returns null when the result
 * would not be a real date (31 January + 1 month), which RFC 5545 treats as a
 * skipped recurrence rather than a clamp to the 28th.
 */
export function addMonths(stamp: string, months: number): string | null {
  const clock = parseStamp(stamp);
  if (!clock) return null;

  const total = (clock.year * 12 + (clock.month - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (!isRealDate(year, month, clock.day)) return null;

  return formatStamp({ ...clock, year, month });
}

/** Add whole years. Returns null for 29 February in a non-leap year. */
export function addYears(stamp: string, years: number): string | null {
  const clock = parseStamp(stamp);
  if (!clock) return null;

  const year = clock.year + years;
  if (!isRealDate(year, clock.month, clock.day)) return null;

  return formatStamp({ ...clock, year });
}

export function minutesBetween(from: string, to: string): number {
  const start = parseStamp(from);
  const end = parseStamp(to);
  if (!start || !end) return 0;
  return toEpochMinutes(end) - toEpochMinutes(start);
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(minutesBetween(startOfDay(fromDate), startOfDay(toDate)) / MINUTES_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(stamp: string): number {
  const clock = parseStamp(startOfDay(stamp));
  if (!clock) return 0;
  return new Date(toEpochMinutes(clock) * 60_000).getUTCDay();
}

/** Minutes from midnight — the vertical offset of an event in a time grid. */
export function minutesIntoDay(stamp: string): number {
  const clock = parseStamp(stamp);
  if (!clock) return 0;
  return clock.hour * 60 + clock.minute;
}

/**
 * Monday-first start of the week containing `stamp`, as a date string. Sunday
 * belongs to the week that ends on it, matching the ISO layout the month grid
 * and the week view both draw.
 */
export function startOfWeek(stamp: string, weekStartsOn: 0 | 1 = 1): string {
  const weekday = weekdayOf(stamp);
  const delta = (weekday - weekStartsOn + 7) % 7;
  return dateOf(addDays(startOfDay(stamp), -delta));
}

export function startOfMonth(stamp: string): string {
  return `${dateOf(stamp).slice(0, 8)}01`;
}

export function endOfMonth(stamp: string): string {
  const clock = parseStamp(startOfDay(stamp));
  if (!clock) return dateOf(stamp);
  return formatDate({ ...clock, day: daysInMonth(clock.year, clock.month) });
}

/** The current wall clock in the runtime's own timezone. */
export function nowStamp(reference: Date = new Date()): string {
  return formatStamp({
    year: reference.getFullYear(),
    month: reference.getMonth() + 1,
    day: reference.getDate(),
    hour: reference.getHours(),
    minute: reference.getMinutes(),
  });
}

export function todayDate(reference: Date = new Date()): string {
  return dateOf(nowStamp(reference));
}

/** Round a stamp down to the nearest `step` minutes (default: half an hour). */
export function floorToStep(stamp: string, step = 30): string {
  const clock = parseStamp(stamp);
  if (!clock) return stamp;
  const total = clock.hour * 60 + clock.minute;
  const floored = Math.floor(total / step) * step;
  return formatStamp({
    ...clock,
    hour: Math.floor(floored / 60),
    minute: floored % 60,
  });
}

/**
 * Do two closed intervals touch? Both the query window and all-day events use
 * inclusive ends (23:59), so a zero-length event on the boundary still counts.
 */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}
