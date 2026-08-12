// Recurrence expansion.
//
// Nextcloud Calendar leans on ical.js for full RFC 5545 RRULEs. Breadboard's
// calendar keeps the subset a personal calendar actually uses — a frequency, an
// interval, and an end condition — and expands it here, purely, so it can be
// unit-tested without a database.
//
// Two RFC 5545 behaviours are deliberately preserved because getting them wrong
// is visible: a monthly rule anchored on the 31st skips the months that have no
// 31st (rather than sliding to the 30th), and 29 February yearly rules only
// fire in leap years. Skipped dates do not consume a COUNT.

import type { RecurrenceRule } from "./types.ts";
import {
  addDays,
  addMinutes,
  addMonths,
  addYears,
  endOfDay,
  minutesBetween,
  overlaps,
  parseStamp,
} from "./wallclock.ts";

/**
 * Ceiling on instances returned for a single event in a single window. Set
 * above the widest window the store will serve (MAX_RANGE_DAYS = 400) so a
 * daily rule is never silently truncated; it exists to bound a pathological
 * rule, not to trim ordinary ones.
 */
export const MAX_OCCURRENCES_PER_EVENT = 450;

/**
 * Ceiling on rule steps walked per event. Only reachable when most candidate
 * dates are skipped (a monthly-on-the-31st rule skips 7 months in 12), because
 * the common cases fast-forward arithmetically instead of stepping.
 */
const MAX_STEPS = 1_000;

export interface OccurrenceWindow {
  /** Inclusive window start, "YYYY-MM-DDTHH:MM". */
  from: string;
  /** Inclusive window end. */
  to: string;
}

export interface ExpandedOccurrence {
  start: string;
  end: string;
  /** 0 for the master instance, 1+ for later instances of a rule. */
  index: number;
}

/** The start of the `index`-th instance, or null when that date does not exist. */
function occurrenceStart(
  base: string,
  rule: RecurrenceRule,
  index: number,
): string | null {
  if (index === 0) return base;
  const step = rule.interval * index;

  switch (rule.frequency) {
    case "daily":
      return addDays(base, step);
    case "weekly":
      return addDays(base, step * 7);
    case "monthly":
      return addMonths(base, step);
    case "yearly":
      return addYears(base, step);
    default:
      return null;
  }
}

/**
 * How many whole steps can be skipped before the window opens. Only used when
 * the rule has no COUNT: with a COUNT, skipped invalid dates must be walked so
 * they are not miscounted as instances.
 */
function fastForwardIndex(
  base: string,
  rule: RecurrenceRule,
  windowFrom: string,
  durationMinutes: number,
): number {
  const baseClock = parseStamp(base);
  const fromClock = parseStamp(windowFrom);
  if (!baseClock || !fromClock) return 0;

  // An instance is visible while its *end* is still inside the window, so aim
  // at the window start pulled back by the event's own length.
  const target = addMinutes(windowFrom, -durationMinutes);
  if (target <= base) return 0;

  let steps = 0;
  if (rule.frequency === "daily" || rule.frequency === "weekly") {
    const perStep = rule.frequency === "weekly" ? 7 : 1;
    const days = minutesBetween(base, target) / (24 * 60);
    steps = Math.floor(days / (perStep * rule.interval));
  } else if (rule.frequency === "monthly") {
    const targetClock = parseStamp(target);
    if (!targetClock) return 0;
    const months =
      (targetClock.year - baseClock.year) * 12 + (targetClock.month - baseClock.month);
    steps = Math.floor(months / rule.interval);
  } else if (rule.frequency === "yearly") {
    const targetClock = parseStamp(target);
    if (!targetClock) return 0;
    steps = Math.floor((targetClock.year - baseClock.year) / rule.interval);
  }

  return steps > 0 ? steps : 0;
}

/**
 * Expand an event into the instances that touch `window`.
 *
 * `start`/`end` are the master instance's wall-clock stamps and `end` is
 * inclusive, matching how all-day events are stored (23:59 on their last day).
 */
export function expandOccurrences(
  start: string,
  end: string,
  rule: RecurrenceRule,
  window: OccurrenceWindow,
): ExpandedOccurrence[] {
  if (!parseStamp(start) || !parseStamp(end)) return [];

  const duration = Math.max(0, minutesBetween(start, end));

  if (rule.frequency === "none") {
    return overlaps(start, end, window.from, window.to)
      ? [{ start, end, index: 0 }]
      : [];
  }

  const interval = Number.isInteger(rule.interval) && rule.interval > 0 ? rule.interval : 1;
  const normalized: RecurrenceRule = { ...rule, interval };

  // `until` is an inclusive date: a rule ending "2026-08-31" still fires that
  // day, so compare against the very end of it.
  const untilStamp = normalized.until ? endOfDay(normalized.until) : null;
  const hasCount = typeof normalized.count === "number" && normalized.count > 0;

  const firstIndex = hasCount
    ? 0
    : fastForwardIndex(start, normalized, window.from, duration);

  const results: ExpandedOccurrence[] = [];
  let generated = firstIndex;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const index = firstIndex + step;

    if (hasCount && generated >= (normalized.count as number)) break;

    const occStart = occurrenceStart(start, normalized, index);
    if (occStart === null) continue; // 31 February and friends: skipped, not counted.
    generated += 1;

    if (untilStamp && occStart > untilStamp) break;
    if (occStart > window.to) break;

    const occEnd = addMinutes(occStart, duration);
    if (occEnd >= window.from) {
      results.push({ start: occStart, end: occEnd, index });
      if (results.length >= MAX_OCCURRENCES_PER_EVENT) break;
    }
  }

  return results;
}

/**
 * The first `limit` instance starts of a rule, ignoring any window.
 *
 * Splitting a series ("change this and all following") has to know how many
 * instances fall before the split point so a COUNT can be divided between the
 * two halves; a windowed expansion cannot answer that. Bounded by COUNT, by
 * UNTIL, and by `limit`, so an unbounded rule still terminates.
 */
export function takeOccurrenceStarts(
  start: string,
  rule: RecurrenceRule,
  limit: number,
): string[] {
  if (!parseStamp(start) || limit <= 0) return [];
  if (rule.frequency === "none") return [start];

  const interval = Number.isInteger(rule.interval) && rule.interval > 0 ? rule.interval : 1;
  const normalized: RecurrenceRule = { ...rule, interval };
  const untilStamp = normalized.until ? endOfDay(normalized.until) : null;
  const cap = normalized.count && normalized.count > 0
    ? Math.min(limit, normalized.count)
    : limit;

  const starts: string[] = [];
  for (let index = 0; index < MAX_STEPS && starts.length < cap; index += 1) {
    const occStart = occurrenceStart(start, normalized, index);
    if (occStart === null) continue;
    if (untilStamp && occStart > untilStamp) break;
    starts.push(occStart);
  }

  return starts;
}

/**
 * How many instances of a rule begin strictly before `boundary`. Used to give
 * the earlier half of a split series the right COUNT.
 */
export function countOccurrencesBefore(
  start: string,
  rule: RecurrenceRule,
  boundary: string,
  limit = MAX_STEPS,
): number {
  return takeOccurrenceStarts(start, rule, limit).filter((occ) => occ < boundary).length;
}

/** Human-readable summary of a rule, for the event editor and agenda rows. */
export function describeRecurrence(rule: RecurrenceRule): string {
  if (rule.frequency === "none") return "Does not repeat";

  const every = rule.interval > 1 ? `Every ${rule.interval} ` : "Every ";
  const unit =
    rule.frequency === "daily"
      ? rule.interval > 1 ? "days" : "day"
      : rule.frequency === "weekly"
        ? rule.interval > 1 ? "weeks" : "week"
        : rule.frequency === "monthly"
          ? rule.interval > 1 ? "months" : "month"
          : rule.interval > 1 ? "years" : "year";

  let suffix = "";
  if (rule.count && rule.count > 0) {
    suffix = `, ${rule.count} time${rule.count === 1 ? "" : "s"}`;
  } else if (rule.until) {
    suffix = `, until ${rule.until}`;
  }

  return `${every}${unit}${suffix}`;
}
