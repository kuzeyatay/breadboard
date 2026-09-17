import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { CalendarStore } from "../src/lib/calendar/store.ts";
import { googleEventInput, googleSyncRange, syncGoogleCalendars } from "../src/lib/calendar/google-sync.ts";

const range = googleSyncRange("2026-09-01", "2026-09-30");
const event = (id, fields = {}) => ({ id, summary: "Meeting", start: { dateTime: "2026-09-08T08:00:00Z" }, end: { dateTime: "2026-09-08T09:00:00Z" }, ...fields });
function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  const store = new CalendarStore(db);
  const state = { events: [event("a")], calls: [], failPage: false, malformed: false, connected: true, second: [] };
  const deps = {
    accounts: async () => state.connected ? [{ connectionId: "account-1", slug: "google-calendar" }] : [],
    get: async (account, path, query) => {
      state.calls.push({ account, path, query });
      if (path.endsWith("calendarList")) return { kind: "calendar#calendarList", items: [{ id: "work@example.com", summary: "Work", selected: true }] };
      if (state.malformed) return { data: {} };
      if (query.pageToken) {
        if (state.failPage) throw new Error("Private upstream response");
        return { kind: "calendar#events", items: state.second };
      }
      return { kind: "calendar#events", items: state.events, ...(state.second.length || state.failPage ? { nextPageToken: "page2" } : {}) };
    },
  };
  const sync = () => syncGoogleCalendars(store, 1, range, deps, "Europe/Amsterdam");
  const mirror = () => store.listCalendars(1).find((calendar) => calendar.googleCalendarId);
  const occurrences = () => store.occurrencesInRange(1, range.from, range.to);
  return { db, store, state, deps, sync, mirror, occurrences };
}

test("Google timed events convert to the display timezone, including winter DST", () => {
  assert.equal(googleEventInput(event("a"), 1, "Europe/Amsterdam").startsAt, "2026-09-08T10:00");
  assert.equal(googleEventInput(event("a", { start: { dateTime: "2026-12-08T08:00:00Z" }, end: { dateTime: "2026-12-08T09:00:00Z" } }), 1, "Europe/Amsterdam").startsAt, "2026-12-08T09:00");
});

test("Google exclusive all-day ends become inclusive local calendar days", () => {
  const input = googleEventInput(event("day", { start: { date: "2026-09-08" }, end: { date: "2026-09-10" } }), 1, "Europe/Amsterdam");
  assert.equal(input.startsAt, "2026-09-08T00:00");
  assert.equal(input.endsAt, "2026-09-09T23:59");
  assert.equal(input.allDay, true);
  assert.equal(googleEventInput({ id: "cancelled", status: "cancelled" }, 1, "UTC"), null);
});

test("first connection creates a visible read-only Google calendar and refresh preserves IDs and preferences", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.sync(), { connected: true, synced: 1, error: null });
    const calendar = f.mirror();
    const first = f.occurrences()[0];
    assert.equal(calendar.name, "Work");
    assert.equal(calendar.visible, true);
    assert.equal(calendar.readOnly, true);
    assert.ok(calendar.lastSyncedAt);
    assert.equal(f.store.listCalendars(1).length, 2, "Personal stays writable");
    f.store.updateCalendar(1, calendar.id, { visible: false });
    f.store.updateEvent(1, first.eventId, { notificationsEnabled: false });
    f.state.events[0].summary = "Updated meeting";
    await f.sync();
    assert.equal(f.mirror().id, calendar.id);
    assert.equal(f.mirror().visible, false);
    assert.equal(f.occurrences().length, 1);
    assert.equal(f.occurrences()[0].eventId, first.eventId);
    assert.equal(f.occurrences()[0].title, "Updated meeting");
    assert.equal(f.occurrences()[0].notificationsEnabled, false);
    assert.equal(f.store.listCalendars(2).length, 0);
    assert.throws(() => f.store.createEvent(1, { ...googleEventInput(event("x"), calendar.id, "UTC") }), /cannot be edited/);
  } finally { f.db.close(); }
});

test("pagination retains recurring instances that share iCalUID", async () => {
  const f = fixture();
  try {
    f.state.events = [event("series_1", { iCalUID: "same" })];
    f.state.second = [event("series_2", { iCalUID: "same" })];
    await f.sync();
    assert.equal(f.occurrences().length, 2);
    assert.equal(f.state.calls.at(-1).query.pageToken, "page2");
    assert.equal(f.state.calls.at(-1).query.singleEvents, "true");
    assert.match(f.state.calls.at(-1).path, /work%40example.com/);
  } finally { f.db.close(); }
});

test("cancelled and deleted events disappear only inside the refreshed range", async () => {
  const f = fixture();
  try {
    await f.sync();
    const calendar = f.mirror();
    f.store.ingestEvents(1, calendar.id, [googleEventInput(event("old", { start: { dateTime: "2026-08-01T08:00:00Z" }, end: { dateTime: "2026-08-01T09:00:00Z" } }), calendar.id, "Europe/Amsterdam")]);
    f.state.events = [{ id: "a", status: "cancelled" }];
    await f.sync();
    assert.equal(f.occurrences().length, 0);
    assert.equal(f.store.occurrencesInRange(1, "2026-08-01", "2026-08-02").length, 1);
  } finally { f.db.close(); }
});

test("a failed later page keeps the entire existing snapshot and reports a safe error", async () => {
  const f = fixture();
  try {
    await f.sync();
    f.state.events = [event("new")];
    f.state.failPage = true;
    const result = await f.sync();
    assert.equal(result.synced, 0);
    assert.ok(result.error);
    assert.doesNotMatch(result.error, /Private upstream/);
    assert.equal(f.occurrences().length, 1);
    assert.equal(f.store.getEvent(1, f.occurrences()[0].eventId).uid, "google:a");
    assert.equal(f.mirror().syncError, result.error);
  } finally { f.db.close(); }
});

test("unexpected provider envelopes cannot empty a calendar; a valid empty collection can", async () => {
  const f = fixture();
  try {
    await f.sync();
    f.state.malformed = true;
    assert.ok((await f.sync()).error);
    assert.equal(f.occurrences().length, 1);
    f.state.malformed = false;
    f.state.events = [];
    assert.equal((await f.sync()).error, null);
    assert.equal(f.occurrences().length, 0);
  } finally { f.db.close(); }
});

test("disconnection retains cached events and exposes a reconnect status", async () => {
  const f = fixture();
  try {
    await f.sync();
    f.state.connected = false;
    assert.equal((await f.sync()).connected, false);
    assert.equal(f.occurrences().length, 1);
    assert.match(f.mirror().syncError, /disconnected/);
  } finally { f.db.close(); }
});

test("invalid ranges and malformed events are rejected", () => {
  assert.throws(() => googleSyncRange("2026-02-30", "2026-03-01"), /valid calendar/);
  assert.throws(() => googleSyncRange("2026-09-30", "2026-09-01"), /valid calendar/);
  assert.throws(() => googleEventInput(event("a", { start: { dateTime: "wrong" } }), 1, "UTC"), /invalid event time/);
});
