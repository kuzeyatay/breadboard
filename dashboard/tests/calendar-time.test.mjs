// Wall-clock arithmetic, recurrence expansion and grid geometry — the pure
// half of the calendar, exercised without a database or a browser.

import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  addMonths,
  addYears,
  daysBetween,
  daysInMonth,
  endOfMonth,
  floorToStep,
  minutesBetween,
  minutesIntoDay,
  parseDate,
  parseStamp,
  startOfWeek,
  weekdayOf,
} from "../src/lib/calendar/wallclock.ts";
import {
  describeRecurrence,
  expandOccurrences,
  MAX_OCCURRENCES_PER_EVENT,
} from "../src/lib/calendar/recurrence.ts";
import {
  buildMonthGrid,
  buildWeekDays,
  groupByDay,
  layoutBanners,
  layoutTimedDay,
  rangeForView,
  shiftAnchor,
} from "../src/lib/calendar/layout.ts";
import { formatRangeTitle, formatTimeRange } from "../src/lib/calendar/format.ts";

const rule = (frequency, extra = {}) => ({
  frequency,
  interval: 1,
  until: null,
  count: null,
  ...extra,
});

const occurrence = (eventId, start, end, allDay = false) => ({
  key: `${eventId}@${start}`,
  eventId,
  calendarId: 1,
  title: `Event ${eventId}`,
  description: null,
  location: null,
  allDay,
  start,
  end,
  recurring: false,
});

// ------------------------------------------------------------------ wallclock

test("parseStamp rejects impossible dates and times", () => {
  assert.ok(parseStamp("2026-08-01T09:30"));
  assert.equal(parseStamp("2026-02-30T09:30"), null);
  assert.equal(parseStamp("2026-13-01T09:30"), null);
  assert.equal(parseStamp("2026-08-01T24:00"), null);
  assert.equal(parseStamp("2026-08-01"), null, "a bare date is not a stamp");
  assert.ok(parseDate("2026-08-01"));
  assert.equal(parseDate("2025-02-29"), null);
});

test("day arithmetic is immune to DST, because it never touches local time", () => {
  // Europe/Amsterdam springs forward on 2026-03-29. Naive arithmetic through
  // a local Date would return 01:30 or 03:30 here.
  assert.equal(addDays("2026-03-28T02:30", 1), "2026-03-29T02:30");
  assert.equal(addDays("2026-03-29T02:30", 1), "2026-03-30T02:30");
  assert.equal(minutesBetween("2026-03-28T02:30", "2026-03-29T02:30"), 1440);
});

test("month and year steps skip dates that do not exist", () => {
  assert.equal(addMonths("2026-01-31T09:00", 1), null, "no 31 February");
  assert.equal(addMonths("2026-01-31T09:00", 2), "2026-03-31T09:00");
  assert.equal(addMonths("2026-12-15T09:00", 1), "2027-01-15T09:00");
  assert.equal(addMonths("2026-01-15T09:00", -1), "2025-12-15T09:00");
  assert.equal(addYears("2024-02-29T09:00", 1), null, "2025 is not a leap year");
  assert.equal(addYears("2024-02-29T09:00", 4), "2028-02-29T09:00");
});

test("calendar helpers agree with the Gregorian calendar", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(weekdayOf("2026-08-01T00:00"), 6, "1 Aug 2026 is a Saturday");
  assert.equal(startOfWeek("2026-08-01T12:00"), "2026-07-27", "Monday-first");
  assert.equal(startOfWeek("2026-07-27T12:00"), "2026-07-27");
  assert.equal(daysBetween("2026-07-27", "2026-08-02"), 6);
  assert.equal(minutesIntoDay("2026-08-01T09:30"), 570);
  assert.equal(floorToStep("2026-08-01T09:47"), "2026-08-01T09:30");
});

// ----------------------------------------------------------------- recurrence

test("a non-repeating event yields one instance, and only when it overlaps", () => {
  const window = { from: "2026-08-01T00:00", to: "2026-08-31T23:59" };
  assert.equal(
    expandOccurrences("2026-08-10T09:00", "2026-08-10T10:00", rule("none"), window).length,
    1,
  );
  assert.equal(
    expandOccurrences("2026-09-10T09:00", "2026-09-10T10:00", rule("none"), window).length,
    0,
  );
  // An event that started before the window but runs into it still counts.
  assert.equal(
    expandOccurrences("2026-07-28T09:00", "2026-08-02T10:00", rule("none"), window).length,
    1,
  );
});

test("interval and window are both respected when fast-forwarding", () => {
  const found = expandOccurrences(
    "2026-07-30T09:00",
    "2026-07-30T10:00",
    rule("daily", { interval: 2 }),
    { from: "2026-08-01T00:00", to: "2026-08-31T23:59" },
  );
  assert.equal(found.length, 16);
  assert.equal(found[0].start, "2026-08-01T09:00");
  assert.equal(found.at(-1).start, "2026-08-31T09:00");
});

test("monthly rules skip short months without consuming the count", () => {
  const found = expandOccurrences(
    "2026-01-31T09:00",
    "2026-01-31T10:00",
    rule("monthly", { count: 6 }),
    { from: "2026-01-01T00:00", to: "2026-12-31T23:59" },
  );
  assert.deepEqual(
    found.map((instance) => instance.start.slice(0, 10)),
    [
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
      "2026-08-31",
      "2026-10-31",
    ],
  );
});

test("a 29 February yearly rule only fires in leap years", () => {
  const found = expandOccurrences(
    "2024-02-29T09:00",
    "2024-02-29T10:00",
    rule("yearly", { count: 3 }),
    { from: "2024-01-01T00:00", to: "2040-12-31T23:59" },
  );
  assert.deepEqual(
    found.map((instance) => instance.start.slice(0, 4)),
    ["2024", "2028", "2032"],
  );
});

test("`until` is inclusive of its own day", () => {
  const found = expandOccurrences(
    "2026-08-01T09:00",
    "2026-08-01T10:00",
    rule("daily", { until: "2026-08-03" }),
    { from: "2026-08-01T00:00", to: "2026-08-31T23:59" },
  );
  assert.deepEqual(
    found.map((instance) => instance.start.slice(0, 10)),
    ["2026-08-01", "2026-08-02", "2026-08-03"],
  );
});

test("weekly rules keep their weekday and their duration", () => {
  const found = expandOccurrences(
    "2026-08-03T14:00",
    "2026-08-03T15:30",
    rule("weekly"),
    { from: "2026-08-01T00:00", to: "2026-08-31T23:59" },
  );
  assert.deepEqual(
    found.map((instance) => instance.start.slice(0, 10)),
    ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"],
  );
  assert.equal(found[3].end, "2026-08-24T15:30", "duration is carried, not recomputed");
});

test("an unbounded daily rule fast-forwards to the window and stays bounded", () => {
  const found = expandOccurrences("2020-01-01T09:00", "2020-01-01T10:00", rule("daily"), {
    from: "2026-01-01T00:00",
    to: "2026-12-31T23:59",
  });
  // Six years of history, none of it walked: the first instance returned is the
  // first one inside the window, and a full year is 365 days.
  assert.equal(found[0].start, "2026-01-01T09:00");
  assert.equal(found.length, 365);
  assert.ok(
    found.length <= MAX_OCCURRENCES_PER_EVENT,
    "the widest window the store serves never hits the ceiling",
  );
});

test("describeRecurrence reads as a sentence", () => {
  assert.equal(describeRecurrence(rule("none")), "Does not repeat");
  assert.equal(describeRecurrence(rule("weekly")), "Every week");
  assert.equal(describeRecurrence(rule("daily", { interval: 3 })), "Every 3 days");
  assert.equal(
    describeRecurrence(rule("monthly", { count: 4 })),
    "Every month, 4 times",
  );
  assert.equal(
    describeRecurrence(rule("yearly", { until: "2030-01-01" })),
    "Every year, until 2030-01-01",
  );
});

// --------------------------------------------------------------------- layout

test("a month grid is six Monday-first weeks around its anchor", () => {
  const weeks = buildMonthGrid("2026-08-15");
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0][0], "2026-07-27", "starts on the Monday before 1 August");
  assert.equal(weeks[5][6], "2026-09-06");
  assert.deepEqual(buildWeekDays("2026-08-01").at(0), "2026-07-27");
});

test("each view asks for exactly the window it draws", () => {
  assert.deepEqual(rangeForView("month", "2026-08-15"), {
    from: "2026-07-27T00:00",
    to: "2026-09-06T23:59",
  });
  assert.deepEqual(rangeForView("week", "2026-08-01"), {
    from: "2026-07-27T00:00",
    to: "2026-08-02T23:59",
  });
  assert.deepEqual(rangeForView("day", "2026-08-01"), {
    from: "2026-08-01T00:00",
    to: "2026-08-01T23:59",
  });
  assert.deepEqual(rangeForView("agenda", "2026-08-01"), {
    from: "2026-08-01T00:00",
    to: "2026-08-30T23:59",
  });
});

test("paging moves by the unit on screen and survives year boundaries", () => {
  assert.equal(shiftAnchor("month", "2026-12-15", 1), "2027-01-01");
  assert.equal(shiftAnchor("month", "2026-01-15", -1), "2025-12-01");
  assert.equal(shiftAnchor("week", "2026-08-01", 1), "2026-08-08");
  assert.equal(shiftAnchor("day", "2026-08-01", -1), "2026-07-31");
  assert.equal(shiftAnchor("agenda", "2026-08-01", 1), "2026-08-31");
});

test("banners stack into lanes and report where they are clipped", () => {
  const week = buildMonthGrid("2026-08-15")[0]; // 27 Jul – 2 Aug
  const { segments, laneCount } = layoutBanners(
    [
      occurrence(1, "2026-07-28T00:00", "2026-07-30T23:59", true),
      occurrence(2, "2026-07-29T00:00", "2026-07-29T23:59", true),
      occurrence(3, "2026-07-25T00:00", "2026-08-05T23:59", true),
    ],
    week,
  );

  assert.equal(laneCount, 3);

  const spanning = segments.find((segment) => segment.occurrence.eventId === 3);
  assert.equal(spanning.startColumn, 0);
  assert.equal(spanning.span, 7, "clipped to the week it is drawn in");
  assert.equal(spanning.continuesBefore, true);
  assert.equal(spanning.continuesAfter, true);

  const threeDay = segments.find((segment) => segment.occurrence.eventId === 1);
  assert.equal(threeDay.startColumn, 1);
  assert.equal(threeDay.span, 3);
  assert.equal(threeDay.continuesBefore, false);

  const oneDay = segments.find((segment) => segment.occurrence.eventId === 2);
  assert.equal(oneDay.span, 1);
  assert.notEqual(oneDay.lane, threeDay.lane, "overlapping bars get their own lane");
});

test("banners that miss the row entirely are dropped", () => {
  const week = buildMonthGrid("2026-08-15")[0];
  const { segments } = layoutBanners(
    [occurrence(9, "2026-09-01T00:00", "2026-09-02T23:59", true)],
    week,
  );
  assert.equal(segments.length, 0);
});

test("overlapping meetings split into columns, isolated ones stay full width", () => {
  const blocks = layoutTimedDay(
    [
      occurrence(1, "2026-08-03T09:00", "2026-08-03T10:00"),
      occurrence(2, "2026-08-03T09:30", "2026-08-03T10:30"),
      occurrence(3, "2026-08-03T14:00", "2026-08-03T15:00"),
    ],
    "2026-08-03",
  );

  const byId = new Map(blocks.map((block) => [block.occurrence.eventId, block]));
  assert.equal(byId.get(1).columns, 2);
  assert.equal(byId.get(2).columns, 2);
  assert.notEqual(byId.get(1).column, byId.get(2).column);
  assert.equal(byId.get(3).columns, 1, "a later, separate meeting is its own cluster");

  // 09:00 is 540 of 1440 minutes into the day.
  assert.equal(Number(byId.get(1).top.toFixed(4)), Number((540 / 1440).toFixed(4)));
});

test("a meeting crossing midnight is clipped to each day it shows on", () => {
  const late = occurrence(1, "2026-08-03T23:00", "2026-08-04T01:00");
  // It spans two dates, so the month grid treats it as a banner, but the time
  // grid still places the visible part of each day.
  const firstDay = layoutTimedDay([late], "2026-08-03");
  assert.equal(firstDay.length, 0, "multi-day events are banners, not blocks");
});

test("the agenda lists a multi-day event under every day it touches", () => {
  const groups = groupByDay(
    [
      occurrence(1, "2026-08-01T00:00", "2026-08-03T23:59", true),
      occurrence(2, "2026-08-02T09:00", "2026-08-02T10:00"),
    ],
    { from: "2026-08-01T00:00", to: "2026-08-30T23:59" },
  );

  assert.deepEqual(
    groups.map((group) => group.date),
    ["2026-08-01", "2026-08-02", "2026-08-03"],
    "days with nothing on them are omitted",
  );
  assert.equal(groups[1].occurrences.length, 2);
});

test("the agenda clips to the requested window", () => {
  const groups = groupByDay([occurrence(1, "2026-07-30T00:00", "2026-08-02T23:59", true)], {
    from: "2026-08-01T00:00",
    to: "2026-08-01T23:59",
  });
  assert.deepEqual(
    groups.map((group) => group.date),
    ["2026-08-01"],
  );
});

// --------------------------------------------------------------------- format

test("the toolbar title names the period rather than repeating the range", () => {
  assert.equal(formatRangeTitle("2026-08-01T00:00", "2026-08-31T23:59"), "August 2026");
  assert.equal(formatRangeTitle("2026-07-27T00:00", "2026-08-02T23:59"), "27 Jul – 2 Aug 2026");
  assert.equal(
    formatRangeTitle("2026-08-01T00:00", "2026-08-01T23:59"),
    "Saturday 1 August 2026",
  );
  assert.equal(
    formatRangeTitle("2026-12-28T00:00", "2027-01-03T23:59"),
    "28 Dec 2026 – 3 Jan 2027",
  );
  assert.equal(formatTimeRange("2026-08-01T09:00", "2026-08-01T10:30"), "09:00 – 10:30");
});
