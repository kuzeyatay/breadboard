// Display strings for the calendar.
//
// Deliberately fixed English names and a 24-hour clock rather than
// `Intl.DateTimeFormat`: the grid is rendered on the server first and then
// hydrated, and a locale or timezone that differs between the two produces a
// hydration mismatch on every cell. Fixed labels also match the stored stamp
// format, so "09:00" in the editor is "09:00" in the grid.

import { dateOf, parseStamp, startOfDay, timeOf } from "./wallclock.ts";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Monday-first, matching the grid layout. */
export const WEEKDAY_ABBREVIATIONS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function monthName(date: string): string {
  return MONTH_NAMES[Number(date.slice(5, 7)) - 1] ?? "";
}

export function monthAbbreviation(date: string): string {
  return MONTH_ABBREVIATIONS[Number(date.slice(5, 7)) - 1] ?? "";
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** "1 August 2026" */
export function formatLongDate(date: string): string {
  return `${dayOfMonth(date)} ${monthName(date)} ${yearOf(date)}`;
}

/** "Sat 1 Aug" */
export function formatShortDate(date: string): string {
  const clock = parseStamp(startOfDay(date));
  if (!clock) return date;
  // getUTCDay is Sunday-first; the label table is Monday-first.
  const weekday = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
  const label = WEEKDAY_ABBREVIATIONS[(weekday + 6) % 7];
  return `${label} ${dayOfMonth(date)} ${monthAbbreviation(date)}`;
}

/** "09:00" — the time half of a stamp. */
export function formatTime(stamp: string): string {
  return timeOf(stamp);
}

/** "09:00 – 10:30", or just the start when the event is a single moment. */
export function formatTimeRange(start: string, end: string): string {
  const from = formatTime(start);
  const to = formatTime(end);
  return from === to ? from : `${from} – ${to}`;
}

/**
 * The heading above the grid: "August 2026", "28 Jul – 3 Aug 2026",
 * "Saturday 1 August 2026".
 */
export function formatRangeTitle(from: string, to: string): string {
  const fromDate = dateOf(from);
  const toDate = dateOf(to);

  if (fromDate === toDate) {
    const clock = parseStamp(startOfDay(fromDate));
    if (!clock) return formatLongDate(fromDate);
    const weekday = new Date(
      Date.UTC(clock.year, clock.month - 1, clock.day),
    ).getUTCDay();
    return `${WEEKDAY_NAMES[(weekday + 6) % 7]} ${formatLongDate(fromDate)}`;
  }

  const sameYear = fromDate.slice(0, 4) === toDate.slice(0, 4);
  const sameMonth = sameYear && fromDate.slice(5, 7) === toDate.slice(5, 7);

  if (sameMonth) {
    // A whole calendar month reads better as just its name.
    const lastOfMonth = dayOfMonth(toDate);
    if (dayOfMonth(fromDate) === 1 && lastOfMonth >= 28) {
      return `${monthName(fromDate)} ${yearOf(fromDate)}`;
    }
    return `${dayOfMonth(fromDate)} – ${lastOfMonth} ${monthAbbreviation(fromDate)} ${yearOf(toDate)}`;
  }

  const left = `${dayOfMonth(fromDate)} ${monthAbbreviation(fromDate)}${
    sameYear ? "" : ` ${yearOf(fromDate)}`
  }`;
  const right = `${dayOfMonth(toDate)} ${monthAbbreviation(toDate)} ${yearOf(toDate)}`;
  return `${left} – ${right}`;
}

/** "1h 30m", "45m", "All day" — the duration chip in the agenda. */
export function formatDuration(minutes: number, allDay: boolean): string {
  if (allDay) return "All day";
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
