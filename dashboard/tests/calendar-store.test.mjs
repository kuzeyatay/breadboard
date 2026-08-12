// The SQLite-backed calendar store, run against an in-memory database.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  CalendarError,
  CalendarStore,
  DEFAULT_CALENDAR_NAME,
  MAX_CALENDARS_PER_USER,
  MAX_RANGE_DAYS,
} from "../src/lib/calendar/store.ts";
import { readEventPatch } from "../src/lib/calendar/payload.ts";

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return new CalendarStore(db);
}

function seed(store, userId = 1) {
  const [calendar] = store.listCalendarsEnsuringDefault(userId);
  return calendar;
}

const meeting = (calendarId, overrides = {}) => ({
  calendarId,
  title: "Standup",
  startsAt: "2026-08-03T09:00",
  endsAt: "2026-08-03T09:30",
  ...overrides,
});

// ------------------------------------------------------------------ calendars

test("the first visit seeds exactly one Personal calendar", () => {
  const store = createStore();
  const first = store.listCalendarsEnsuringDefault(1);
  const second = store.listCalendarsEnsuringDefault(1);

  assert.equal(first.length, 1);
  assert.equal(first[0].name, DEFAULT_CALENDAR_NAME);
  assert.equal(first[0].visible, true);
  assert.equal(second.length, 1, "seeding is idempotent");
  assert.equal(store.listCalendars(2).length, 0, "and is per user");
});

test("new calendars take an unused swatch and keep their own order", () => {
  const store = createStore();
  seed(store);
  const work = store.createCalendar(1, { name: "Work" });
  const trips = store.createCalendar(1, { name: "Trips" });

  assert.notEqual(work.color, trips.color);
  assert.deepEqual(
    store.listCalendars(1).map((calendar) => calendar.name),
    [DEFAULT_CALENDAR_NAME, "Work", "Trips"],
  );
});

test("calendars are capped, named and colour-validated", () => {
  const store = createStore();
  seed(store);

  assert.throws(() => store.createCalendar(1, { name: "   " }), CalendarError);
  assert.equal(
    store.createCalendar(1, { name: "Odd", color: "not-a-color" }).color,
    "#4f6f68",
    "an unparseable colour falls back rather than persisting garbage",
  );

  while (store.listCalendars(1).length < MAX_CALENDARS_PER_USER) {
    store.createCalendar(1, { name: `Cal ${store.listCalendars(1).length}` });
  }
  assert.throws(() => store.createCalendar(1, { name: "One too many" }), CalendarError);
});

test("the last calendar cannot be deleted, and deleting one takes its events", () => {
  const store = createStore();
  const personal = seed(store);
  assert.throws(() => store.deleteCalendar(1, personal.id), CalendarError);

  const work = store.createCalendar(1, { name: "Work" });
  store.createEvent(1, meeting(work.id));
  assert.equal(store.listEvents(1).length, 1);

  store.deleteCalendar(1, work.id);
  assert.equal(store.listEvents(1).length, 0, "events cascade with their calendar");
});

test("one user cannot see or touch another's calendar", () => {
  const store = createStore();
  const mine = seed(store, 1);
  seed(store, 2);

  assert.throws(() => store.getCalendar(2, mine.id), CalendarError);
  assert.throws(() => store.updateCalendar(2, mine.id, { name: "Hijacked" }), CalendarError);
  assert.throws(() => store.createEvent(2, meeting(mine.id)), CalendarError);
});

// --------------------------------------------------------------------- events

test("an event round-trips with its recurrence rule", () => {
  const store = createStore();
  const calendar = seed(store);

  const created = store.createEvent(
    1,
    meeting(calendar.id, {
      description: "  daily sync  ",
      location: "Kitchen",
      recurrence: { frequency: "weekly", interval: 2, count: 5 },
    }),
  );

  assert.equal(created.title, "Standup");
  assert.equal(created.description, "daily sync", "text is trimmed");
  assert.equal(created.allDay, false);
  assert.deepEqual(created.recurrence, {
    frequency: "weekly",
    interval: 2,
    until: null,
    count: 5,
  });
  assert.deepEqual(store.getEvent(1, created.id), created);
});

test("all-day events are snapped to whole days", () => {
  const store = createStore();
  const calendar = seed(store);

  const created = store.createEvent(
    1,
    meeting(calendar.id, {
      allDay: true,
      startsAt: "2026-08-03T14:23",
      endsAt: "2026-08-05T02:00",
    }),
  );

  assert.equal(created.startsAt, "2026-08-03T00:00");
  assert.equal(created.endsAt, "2026-08-05T23:59");
});

test("invalid events are refused with a 400", () => {
  const store = createStore();
  const calendar = seed(store);

  const rejects = (input, why) => {
    assert.throws(
      () => store.createEvent(1, meeting(calendar.id, input)),
      (error) => error instanceof CalendarError && error.status === 400,
      why,
    );
  };

  rejects({ title: "" }, "a blank title");
  rejects({ startsAt: "tomorrow" }, "an unparseable start");
  rejects({ startsAt: "2026-08-03T10:00", endsAt: "2026-08-03T09:00" }, "an end before start");
  rejects({ recurrence: { frequency: "hourly" } }, "an unsupported frequency");
  rejects({ recurrence: { frequency: "daily", interval: 0 } }, "a zero interval");
  rejects({ recurrence: { frequency: "daily", count: 9999 } }, "an absurd count");
  rejects(
    { recurrence: { frequency: "daily", until: "2026-01-01" } },
    "a repeat ending before the event starts",
  );
  assert.throws(() => store.createEvent(1, meeting(9999)), CalendarError, "a foreign calendar");
});

test("a patch only changes the fields it mentions", () => {
  const store = createStore();
  const calendar = seed(store);
  const created = store.createEvent(
    1,
    meeting(calendar.id, { location: "Kitchen", recurrence: { frequency: "daily" } }),
  );

  const updated = store.updateEvent(1, created.id, { title: "Standup (moved)" });

  assert.equal(updated.title, "Standup (moved)");
  assert.equal(updated.location, "Kitchen", "untouched fields survive");
  assert.equal(updated.recurrence.frequency, "daily");
  assert.equal(updated.startsAt, created.startsAt);

  // An explicit null does clear an optional field.
  assert.equal(store.updateEvent(1, created.id, { location: null }).location, null);
});

test("moving an event's start re-checks the repeat rule it carries", () => {
  const store = createStore();
  const calendar = seed(store);
  const created = store.createEvent(
    1,
    meeting(calendar.id, { recurrence: { frequency: "daily", until: "2026-08-10" } }),
  );

  assert.throws(
    () => store.updateEvent(1, created.id, { startsAt: "2026-09-01T09:00", endsAt: "2026-09-01T10:00" }),
    CalendarError,
    "the inherited `until` now precedes the new start",
  );
});

test("deleting is scoped to the owner", () => {
  const store = createStore();
  const calendar = seed(store);
  seed(store, 2);
  const created = store.createEvent(1, meeting(calendar.id));

  assert.throws(() => store.deleteEvent(2, created.id), CalendarError);
  store.deleteEvent(1, created.id);
  assert.equal(store.listEvents(1).length, 0);
});

// ---------------------------------------------------------------- occurrences

test("a range query expands recurrences and honours calendar filters", () => {
  const store = createStore();
  const personal = seed(store);
  const work = store.createCalendar(1, { name: "Work" });

  store.createEvent(
    1,
    meeting(personal.id, { title: "Weekly", recurrence: { frequency: "weekly" } }),
  );
  store.createEvent(
    1,
    meeting(work.id, {
      title: "Offsite",
      allDay: true,
      startsAt: "2026-08-12T00:00",
      endsAt: "2026-08-14T00:00",
    }),
  );

  const all = store.occurrencesInRange(1, "2026-08-01T00:00", "2026-08-31T23:59");
  assert.equal(all.filter((item) => item.title === "Weekly").length, 5);
  assert.equal(all.filter((item) => item.title === "Offsite").length, 1);

  const onlyWork = store.occurrencesInRange(1, "2026-08-01T00:00", "2026-08-31T23:59", {
    calendarIds: [work.id],
  });
  assert.deepEqual([...new Set(onlyWork.map((item) => item.calendarId))], [work.id]);
});

test("occurrences come back sorted, keyed and flagged", () => {
  const store = createStore();
  const calendar = seed(store);
  store.createEvent(1, meeting(calendar.id, { title: "Later", startsAt: "2026-08-03T15:00", endsAt: "2026-08-03T16:00" }));
  store.createEvent(1, meeting(calendar.id, { title: "Earlier" }));

  const found = store.occurrencesInRange(1, "2026-08-03T00:00", "2026-08-03T23:59");
  assert.deepEqual(
    found.map((item) => item.title),
    ["Earlier", "Later"],
  );
  assert.equal(found[0].key, `${found[0].eventId}@2026-08-03T09:00`);
  assert.equal(found[0].recurring, false);
  assert.equal(new Set(found.map((item) => item.key)).size, found.length, "keys are unique");
});

test("a range query never leaks another user's events", () => {
  const store = createStore();
  const mine = seed(store, 1);
  const theirs = seed(store, 2);
  store.createEvent(1, meeting(mine.id, { title: "Mine" }));
  store.createEvent(2, meeting(theirs.id, { title: "Theirs" }));

  const found = store.occurrencesInRange(1, "2026-08-01T00:00", "2026-08-31T23:59");
  assert.deepEqual(
    found.map((item) => item.title),
    ["Mine"],
  );
});

test("an over-wide or inverted range is refused", () => {
  const store = createStore();
  seed(store);

  assert.throws(
    () => store.occurrencesInRange(1, "2026-08-31T00:00", "2026-08-01T00:00"),
    CalendarError,
  );
  assert.throws(
    () => store.occurrencesInRange(1, "2020-01-01T00:00", "2030-01-01T00:00"),
    (error) => error instanceof CalendarError && /at most \d+ days/.test(error.message),
  );
  // The widest allowed window is accepted.
  assert.doesNotThrow(() =>
    store.occurrencesInRange(1, "2026-01-01T00:00", `2026-01-01T00:00`),
  );
  assert.ok(MAX_RANGE_DAYS >= 400);
});

test("listEventsByIds returns the masters behind a set of occurrences", () => {
  const store = createStore();
  const calendar = seed(store);
  const created = store.createEvent(1, meeting(calendar.id, { recurrence: { frequency: "daily" } }));

  const occurrences = store.occurrencesInRange(1, "2026-08-03T00:00", "2026-08-09T23:59");
  const events = store.listEventsByIds(1, occurrences.map((item) => item.eventId));

  assert.equal(occurrences.length, 7);
  assert.equal(events.length, 1, "seven instances, one master");
  assert.equal(events[0].id, created.id);
  assert.deepEqual(store.listEventsByIds(2, [created.id]), [], "scoped to the owner");
  assert.deepEqual(store.listEventsByIds(1, []), []);
});

// -------------------------------------------------------------------- payload

test("readEventPatch forwards only the keys the client actually sent", () => {
  assert.deepEqual(readEventPatch({ title: "Hi" }), { title: "Hi" });
  assert.deepEqual(readEventPatch({}), {}, "an empty body is an empty patch");
  assert.deepEqual(readEventPatch({ location: null }), { location: null });
  assert.deepEqual(readEventPatch({ title: 42 }), {}, "wrong types are dropped, not coerced");
  assert.deepEqual(readEventPatch({ recurrence: null }), { recurrence: null });
  assert.deepEqual(readEventPatch({ recurrence: { frequency: "daily", interval: "3", until: "" } }), {
    recurrence: { frequency: "daily", interval: 3, until: null },
  });
});
