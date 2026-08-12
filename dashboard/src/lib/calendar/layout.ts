// Grid geometry for the calendar views.
//
// Pure functions over occurrences, kept out of the components so the tricky
// parts — which weeks a month view covers, how many lanes a run of overlapping
// meetings needs — can be unit tested without rendering React.

import type { CalendarOccurrence } from "./types.ts";
import {
  addDays,
  dateOf,
  daysBetween,
  endOfDay,
  minutesBetween,
  minutesIntoDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./wallclock.ts";

export type CalendarView = "month" | "week" | "day" | "agenda";

export const CALENDAR_VIEWS: readonly CalendarView[] = ["month", "week", "day", "agenda"];

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === "string" && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Days shown by the agenda list, and the step its prev/next buttons take. */
export const AGENDA_SPAN_DAYS = 30;

/** A month view always draws six week rows so its height never jumps. */
export const MONTH_WEEK_ROWS = 6;

export interface DateRange {
  /** Inclusive wall-clock start, "YYYY-MM-DDTHH:MM". */
  from: string;
  /** Inclusive wall-clock end. */
  to: string;
}

/** The 42 dates of a month grid: six Monday-first weeks around `anchor`. */
export function buildMonthGrid(anchor: string): string[][] {
  const firstCell = startOfWeek(startOfDay(startOfMonth(anchor)));
  const weeks: string[][] = [];

  for (let week = 0; week < MONTH_WEEK_ROWS; week += 1) {
    const days: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push(dateOf(addDays(startOfDay(firstCell), week * 7 + day)));
    }
    weeks.push(days);
  }

  return weeks;
}

/** The seven dates of the Monday-first week containing `anchor`. */
export function buildWeekDays(anchor: string): string[] {
  const first = startOfWeek(startOfDay(anchor));
  return Array.from({ length: 7 }, (_, index) => dateOf(addDays(startOfDay(first), index)));
}

/** The window a view needs to fetch — the grid's own extent, not the month. */
export function rangeForView(view: CalendarView, anchor: string): DateRange {
  switch (view) {
    case "month": {
      const weeks = buildMonthGrid(anchor);
      return {
        from: startOfDay(weeks[0][0]),
        to: endOfDay(weeks[weeks.length - 1][6]),
      };
    }
    case "week": {
      const days = buildWeekDays(anchor);
      return { from: startOfDay(days[0]), to: endOfDay(days[6]) };
    }
    case "day":
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    case "agenda":
    default:
      return {
        from: startOfDay(anchor),
        to: endOfDay(addDays(startOfDay(anchor), AGENDA_SPAN_DAYS - 1)),
      };
  }
}

/** Where prev/next lands: one month, one week, one day, one agenda page. */
export function shiftAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === "month") {
    const [year, month] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
    const total = year * 12 + (month - 1) + direction;
    const nextYear = Math.floor(total / 12);
    const nextMonth = (total % 12) + 1;
    return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  }

  const step = view === "week" ? 7 : view === "day" ? 1 : AGENDA_SPAN_DAYS;
  return dateOf(addDays(startOfDay(anchor), step * direction));
}

/**
 * An occurrence is drawn as a banner — a bar spanning whole day columns —
 * when it is all-day or when it runs past midnight. Everything else is placed
 * on the time grid.
 */
export function isBanner(occurrence: CalendarOccurrence): boolean {
  return occurrence.allDay || dateOf(occurrence.start) !== dateOf(occurrence.end);
}

export interface BannerSegment {
  occurrence: CalendarOccurrence;
  /** 0-based column within the row. */
  startColumn: number;
  /** Number of columns covered, at least 1. */
  span: number;
  /** Stacking row within the banner area. */
  lane: number;
  /** The event began before this row / continues past it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Place banner occurrences into lanes across one row of day columns.
 *
 * Longest-first within a start date so a week-long bar sits above the one-day
 * bars it contains, which is how the eye expects to read them.
 */
export function layoutBanners(
  occurrences: readonly CalendarOccurrence[],
  days: readonly string[],
): { segments: BannerSegment[]; laneCount: number } {
  if (days.length === 0) return { segments: [], laneCount: 0 };

  const first = days[0];
  const last = days[days.length - 1];

  const candidates = occurrences
    .filter(isBanner)
    .filter(
      (occurrence) => dateOf(occurrence.start) <= last && dateOf(occurrence.end) >= first,
    )
    .sort((a, b) => {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      if (a.end !== b.end) return a.end > b.end ? -1 : 1;
      return a.eventId - b.eventId;
    });

  // laneEnds[lane] = last column that lane is occupied through.
  const laneEnds: number[] = [];
  const segments: BannerSegment[] = [];

  for (const occurrence of candidates) {
    const rawStart = daysBetween(first, dateOf(occurrence.start));
    const rawEnd = daysBetween(first, dateOf(occurrence.end));
    const startColumn = Math.max(0, rawStart);
    const endColumn = Math.min(days.length - 1, rawEnd);
    if (endColumn < startColumn) continue;

    let lane = laneEnds.findIndex((end) => end < startColumn);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endColumn);
    } else {
      laneEnds[lane] = endColumn;
    }

    segments.push({
      occurrence,
      startColumn,
      span: endColumn - startColumn + 1,
      lane,
      continuesBefore: rawStart < 0,
      continuesAfter: rawEnd > days.length - 1,
    });
  }

  return { segments, laneCount: laneEnds.length };
}

export interface TimedBlock {
  occurrence: CalendarOccurrence;
  /** Fraction of the day, 0-1, for CSS `top`. */
  top: number;
  /** Fraction of the day, 0-1, for CSS `height`. */
  height: number;
  /** 0-based column among simultaneous events. */
  column: number;
  /** How many columns this event's overlap cluster needs. */
  columns: number;
}

const MINUTES_PER_DAY = 24 * 60;

/** Shortest block that still shows a title; below this, events become slivers. */
const MIN_BLOCK_MINUTES = 24;

/**
 * Position one day's timed occurrences, splitting runs of mutually overlapping
 * events into side-by-side columns. Multi-day events are clipped to the day, so
 * a meeting crossing midnight shows on both days at the right height.
 */
export function layoutTimedDay(
  occurrences: readonly CalendarOccurrence[],
  date: string,
): TimedBlock[] {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const clipped = occurrences
    .filter((occurrence) => !isBanner(occurrence))
    .filter((occurrence) => occurrence.start <= dayEnd && occurrence.end >= dayStart)
    .map((occurrence) => ({
      occurrence,
      start: occurrence.start < dayStart ? dayStart : occurrence.start,
      end: occurrence.end > dayEnd ? dayEnd : occurrence.end,
    }))
    .sort((a, b) => {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      if (a.end !== b.end) return a.end > b.end ? -1 : 1;
      return a.occurrence.eventId - b.occurrence.eventId;
    });

  const blocks: TimedBlock[] = [];

  // Walk the day once, breaking it into clusters of transitively overlapping
  // events; column count is decided per cluster so an isolated meeting stays
  // full width even if the morning was triple-booked.
  let cluster: typeof clipped = [];
  let clusterEnd = "";

  const flush = () => {
    if (cluster.length === 0) return;

    const laneEnds: string[] = [];
    const lanes: number[] = [];

    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      lanes.push(lane);
    }

    cluster.forEach((item, index) => {
      const startMinutes = minutesIntoDay(item.start);
      const rawMinutes = Math.max(0, minutesBetween(item.start, item.end));
      const minutes = Math.max(MIN_BLOCK_MINUTES, rawMinutes);

      blocks.push({
        occurrence: item.occurrence,
        top: startMinutes / MINUTES_PER_DAY,
        height: Math.min(1 - startMinutes / MINUTES_PER_DAY, minutes / MINUTES_PER_DAY),
        column: lanes[index],
        columns: laneEnds.length,
      });
    });

    cluster = [];
    clusterEnd = "";
  };

  for (const item of clipped) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    cluster.push(item);
    if (item.end > clusterEnd) clusterEnd = item.end;
  }
  flush();

  return blocks;
}

/** Occurrences grouped by day, for the agenda list. Empty days are dropped. */
export function groupByDay(
  occurrences: readonly CalendarOccurrence[],
  range: DateRange,
): { date: string; occurrences: CalendarOccurrence[] }[] {
  const days = new Map<string, CalendarOccurrence[]>();
  const firstDate = dateOf(range.from);
  const lastDate = dateOf(range.to);

  for (const occurrence of occurrences) {
    // A multi-day event appears under every day it touches inside the window.
    let cursor = dateOf(occurrence.start);
    if (cursor < firstDate) cursor = firstDate;
    const stop = dateOf(occurrence.end) > lastDate ? lastDate : dateOf(occurrence.end);

    while (cursor <= stop) {
      const bucket = days.get(cursor);
      if (bucket) bucket.push(occurrence);
      else days.set(cursor, [occurrence]);
      cursor = dateOf(addDays(startOfDay(cursor), 1));
    }
  }

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, items]) => ({ date, occurrences: items }));
}
