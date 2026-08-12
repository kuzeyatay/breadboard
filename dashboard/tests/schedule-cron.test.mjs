import assert from "node:assert/strict";
import test from "node:test";

import {
  CronError,
  describeCronExpression,
  isValidCronExpression,
  nextCronOccurrence,
  parseCronExpression,
} from "../src/lib/schedules/cron.ts";

const at = (year, month, day, hour, minute) =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

test("parses the five standard fields", () => {
  const fields = parseCronExpression("30 9 * * 1-5");
  assert.deepEqual(fields.minutes, [30]);
  assert.deepEqual(fields.hours, [9]);
  assert.deepEqual(fields.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(fields.dayOfWeekRestricted, true);
  assert.equal(fields.dayOfMonthRestricted, false);
});

test("supports steps, lists, ranges, names, and aliases", () => {
  assert.deepEqual(parseCronExpression("*/15 * * * *").minutes, [0, 15, 30, 45]);
  assert.deepEqual(parseCronExpression("0 8,20 * * *").hours, [8, 20]);
  assert.deepEqual(parseCronExpression("0 0 * jan-mar *").months, [1, 2, 3]);
  assert.deepEqual(parseCronExpression("0 0 * * sun").daysOfWeek, [0]);
  assert.deepEqual(parseCronExpression("@daily").hours, [0]);
  // Cron accepts both 0 and 7 for Sunday.
  assert.deepEqual(parseCronExpression("0 0 * * 7").daysOfWeek, [0]);
});

test("rejects malformed expressions instead of scheduling something surprising", () => {
  for (const bad of ["", "0 9 * *", "60 9 * * *", "0 24 * * *", "0 9 * * 8", "a b c d e", "0 9-5 * * *"]) {
    assert.throws(() => parseCronExpression(bad), CronError, `expected "${bad}" to be rejected`);
    assert.equal(isValidCronExpression(bad), false);
  }
});

test("next occurrence is strictly after the reference time", () => {
  // Exactly on the boundary: the run happening now must not be returned again.
  const now = at(2026, 7, 30, 9, 0);
  assert.deepEqual(nextCronOccurrence("0 9 * * *", now), at(2026, 7, 31, 9, 0));
  assert.deepEqual(nextCronOccurrence("0 9 * * *", at(2026, 7, 30, 8, 59)), at(2026, 7, 30, 9, 0));
});

test("weekday, monthly, and hourly cadences roll forward correctly", () => {
  // 2026-07-31 is a Friday, so the next weekday run is Monday 2026-08-03.
  assert.deepEqual(
    nextCronOccurrence("0 9 * * 1-5", at(2026, 7, 31, 12, 0)),
    at(2026, 8, 3, 9, 0),
  );
  assert.deepEqual(
    nextCronOccurrence("0 6 1 * *", at(2026, 7, 30, 12, 0)),
    at(2026, 8, 1, 6, 0),
  );
  assert.deepEqual(
    nextCronOccurrence("15 * * * *", at(2026, 7, 30, 23, 20)),
    at(2026, 7, 31, 0, 15),
  );
});

test("a restricted day-of-month and day-of-week match as a union", () => {
  // Vixie cron: "1st of the month OR any Monday", not the intersection.
  const next = nextCronOccurrence("0 0 1 * 1", at(2026, 7, 30, 12, 0));
  assert.deepEqual(next, at(2026, 8, 1, 0, 0));
  const afterFirst = nextCronOccurrence("0 0 1 * 1", at(2026, 8, 1, 1, 0));
  assert.equal(afterFirst.getDay(), 1);
});

test("descriptions read like the cadence a person picked", () => {
  assert.equal(describeCronExpression("0 9 * * *"), "At 09:00 every day");
  assert.equal(describeCronExpression("0 9 * * 1-5"), "At 09:00 on weekdays");
  assert.equal(describeCronExpression("30 * * * *"), "Every hour at :30");
  assert.equal(describeCronExpression("*/15 * * * *"), "Every 15 minutes");
  assert.equal(describeCronExpression("0 7 1 * *"), "At 07:00 on day 1 of the month");
  assert.equal(describeCronExpression("nope"), "Invalid schedule");
});
