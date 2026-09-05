import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseCalendarReminderRequest,
  planTodayClassReminders,
} from "../src/lib/calendar/reminder-request.ts";

const occurrence = (overrides = {}) => ({
  key: `${overrides.eventId ?? 1}@${overrides.start ?? "2026-09-03T10:00"}`,
  eventId: overrides.eventId ?? 1,
  seriesId: null,
  recurrenceId: null,
  isOverride: false,
  calendarId: 1,
  title: "Physics lecture",
  description: null,
  location: "Room 2",
  allDay: false,
  start: "2026-09-03T10:00",
  end: "2026-09-03T11:00",
  recurring: false,
  attendeeCount: 0,
  readOnly: false,
  ...overrides,
});

const calendar = (name = "Personal") => ({ id: 1, name });

test("the reported typo still creates a one-hour class reminder request", () => {
  assert.deepEqual(
    parseCalendarReminderRequest("remind my classes and hour erlier today"),
    {
      kind: "today_classes",
      leadMinutes: 60,
      deliveryPreference: null,
    },
  );
  assert.equal(
    parseCalendarReminderRequest("what classes do I have today?"),
    null,
    "an ordinary calendar question must stay in chat",
  );
});

test("minutes, half-hours and explicit messaging preferences are understood", () => {
  assert.equal(
    parseCalendarReminderRequest("remind me 45 minutes before my classes today on WhatsApp")
      ?.leadMinutes,
    45,
  );
  assert.equal(
    parseCalendarReminderRequest("remind me half an hour before class today")
      ?.leadMinutes,
    30,
  );
  assert.equal(
    parseCalendarReminderRequest("remind me one hour before class today on Telegram")
      ?.deliveryPreference,
    "telegram",
  );
});

test("only labelled class occurrences are planned when labels exist", () => {
  const now = new Date(2026, 8, 3, 8, 0, 0, 0);
  const request = parseCalendarReminderRequest("remind my classes an hour earlier today");
  assert.ok(request);
  const plan = planTodayClassReminders({
    request,
    calendars: [calendar()],
    occurrences: [
      occurrence(),
      occurrence({ eventId: 2, title: "Dentist", start: "2026-09-03T15:00" }),
      occurrence({ eventId: 3, title: "Study day", allDay: true, start: "2026-09-03T00:00" }),
    ],
    now,
  });
  assert.equal(plan.usedTimedEventFallback, false);
  assert.equal(plan.reminders.length, 1);
  assert.equal(plan.reminders[0].occurrence.title, "Physics lecture");
  assert.deepEqual(new Date(plan.reminders[0].runAt), new Date(2026, 8, 3, 9, 0));
  assert.equal(plan.reminders[0].prompt, "Physics lecture starts at 10:00 at Room 2");
});

test("opaque course codes fall back to upcoming timed events and missed lead times catch up", () => {
  const now = new Date(2026, 8, 3, 9, 30, 0, 0);
  const request = parseCalendarReminderRequest("remind my classes an hour earlier today");
  assert.ok(request);
  const plan = planTodayClassReminders({
    request,
    calendars: [calendar()],
    occurrences: [occurrence({ title: "5EPF0", location: null })],
    now,
  });
  assert.equal(plan.usedTimedEventFallback, true);
  assert.equal(plan.reminders[0].catchingUp, true);
  assert.equal(new Date(plan.reminders[0].runAt).getTime(), now.getTime() + 5_000);
});

test("the terminal routes class reminders before generic scheduled prompts", () => {
  const terminal = fs.readFileSync(
    new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(terminal, /parseCalendarReminderRequest\(text\)/);
  assert.match(terminal, /fetch\("\/api\/calendar\/reminder-requests"/);
  assert.ok(
    terminal.indexOf("if (calendarReminder)") <
      terminal.indexOf("const schedule = textOverride"),
  );
});
