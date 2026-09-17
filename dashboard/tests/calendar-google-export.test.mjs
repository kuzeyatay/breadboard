import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { CalendarStore } from "../src/lib/calendar/store.ts";
import { exportGoogleCalendarEvents, googleExportBody, googleExportEventId, previewGoogleCalendarExport, readGoogleExportOptions } from "../src/lib/calendar/google-export.ts";
import { listCalendars } from "../src/lib/calendar/agent-query.ts";
import { buildNangoActionInvocation, nangoActionSummariesForConnections } from "../src/lib/nango/actions.ts";

function fixture(count = 1) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  const store = new CalendarStore(db);
  const [calendar] = store.listCalendarsEnsuringDefault(1);
  for (let i = 0; i < count; i++) store.createEvent(1, { calendarId: calendar.id, title: `Local ${i}`, startsAt: "2020-01-01T09:00", endsAt: "2020-01-01T10:00" });
  const remote = new Map(), requests = [];
  let fault = null;
  const client = { request: async (method, path, body) => {
    requests.push({ method, path, body });
    if (path.includes("/users/me/calendarList/")) return { status: 200, data: { id: "owner@example.com", summary: "Primary", accessRole: "owner" } };
    if (method === "GET") return { status: remote.has(path.split("/").at(-1)) ? 200 : 404, data: remote.get(path.split("/").at(-1)) };
    if (fault) return fault(body);
    if (remote.has(body.id)) return { status: 409, data: {} };
    remote.set(body.id, structuredClone(body));
    return { status: 200, data: { ...body, status: "confirmed" } };
  } };
  return { db, store, calendar, client, remote, requests, setFault: (fn) => { fault = fn; },
    options: readGoogleExportOptions({ timeZone: "Europe/Amsterdam" }) };
}

test("preview counts the entire calendar, including past and subscribed events, while skipping Google mirrors", async () => {
  const f = fixture(230);
  try {
    const subscription = f.store.createCalendar(1, { name: "Timetable", readOnly: true, sourceUrl: "https://example.com/timetable.ics" });
    f.store.ingestEvents(1, subscription.id, [{ calendarId: subscription.id, uid: "class", title: "Class", startsAt: "2026-09-08T10:00", endsAt: "2026-09-08T11:00" }]);
    const google = f.store.ensureGoogleCalendar(1, "account", "google-id", { name: "Google" });
    f.store.ingestEvents(1, google.id, [{ calendarId: google.id, uid: "google:a", title: "Already there", startsAt: "2026-09-08T10:00", endsAt: "2026-09-08T11:00" }]);
    const result = await previewGoogleCalendarExport(f.store, 1, f.options, f.client);
    assert.equal(result.totalEvents, 231);
    assert.equal(result.skippedGoogleCalendars, 1);
    assert.equal(result.exportArgs.calendarId, "owner@example.com");
    assert.equal(f.requests.filter((r) => r.method === "POST").length, 0);
    assert.equal(listCalendars(f.store, 1).calendars.find((c) => c.id === google.id).canCopyToGoogle, false);
  } finally { f.db.close(); }
});

test("bulk export spans batches without truncation and repeated export does not duplicate events", async () => {
  const f = fixture(56);
  try {
    const preview = await previewGoogleCalendarExport(f.store, 1, f.options, f.client);
    let options = preview.exportArgs, created = 0, batches = 0;
    do {
      const result = await exportGoogleCalendarEvents(f.store, 1, options, f.client);
      created += result.created; batches++;
      assert.ok(result.created <= 25);
      assert.deepEqual(result.failures, []);
      assert.equal(result.complete, result.remaining === 0);
      options = result.nextArgs;
    } while (options);
    assert.equal(created, 56); assert.equal(batches, 3); assert.equal(f.remote.size, 56);
    const retry = await exportGoogleCalendarEvents(f.store, 1, preview.exportArgs, f.client);
    assert.equal(retry.created, 0); assert.equal(retry.alreadyPresent, 25); assert.equal(f.remote.size, 56);
    assert.ok(f.requests.filter((r) => r.method === "POST").every((r) => !r.body.attendees));
  } finally { f.db.close(); }
});

test("a timed-out write resumes safely even when Google actually created the event", async () => {
  const f = fixture(3);
  try {
    let posts = 0;
    f.setFault((body) => {
      f.remote.set(body.id, body);
      if (++posts === 2) throw new Error("Request timed out after commit");
      return { status: 200, data: body };
    });
    const partial = await exportGoogleCalendarEvents(f.store, 1, f.options, f.client);
    assert.equal(partial.created, 1); assert.equal(partial.remaining, 2); assert.equal(partial.complete, false);
    assert.equal(partial.failures.length, 1);
    f.setFault(null);
    const resumed = await exportGoogleCalendarEvents(f.store, 1, partial.nextArgs, f.client);
    assert.equal(resumed.alreadyPresent, 1); assert.equal(resumed.created, 1); assert.equal(resumed.complete, true);
    assert.equal(f.remote.size, 3);
  } finally { f.db.close(); }
});

test("a missing confirmation never advances the cursor or claims success", async () => {
  const f = fixture(2);
  try {
    f.setFault(() => ({ status: 200, data: { id: "unrelated" } }));
    const result = await exportGoogleCalendarEvents(f.store, 1, f.options, f.client);
    assert.equal(result.created, 0); assert.equal(result.remaining, 2); assert.equal(result.complete, false);
    assert.equal(result.nextArgs.afterEventId, 0); assert.equal(result.failures.length, 1);
  } finally { f.db.close(); }
});

test("a conflicting Google ID must belong to this source before it is counted as already copied", async () => {
  const f = fixture();
  try {
    const id = googleExportEventId(1, f.store.listEvents(1)[0]);
    f.remote.set(id, { id, summary: "Unrelated event" });
    const result = await exportGoogleCalendarEvents(f.store, 1, f.options, f.client);
    assert.equal(result.alreadyPresent, 0); assert.equal(result.complete, false);
    assert.match(result.failures[0].message, /could not be verified/);
  } finally { f.db.close(); }
});

test("all-day ends, recurrence limits, cancelled slots and moved overrides survive export", async () => {
  const f = fixture(0);
  try {
    const series = f.store.createEvent(1, { calendarId: f.calendar.id, title: "Weekly", startsAt: "2026-09-01T09:00", endsAt: "2026-09-01T10:00", recurrence: { frequency: "weekly", interval: 1, until: "2026-09-30" } });
    f.store.updateEventScoped(1, { eventId: series.id, scope: "instance", recurrenceId: "2026-09-08T09:00", patch: { startsAt: "2026-09-09T11:00", endsAt: "2026-09-09T12:00" } });
    f.store.deleteEventScoped(1, { eventId: series.id, scope: "instance", recurrenceId: "2026-09-15T09:00" });
    const holiday = f.store.createEvent(1, { calendarId: f.calendar.id, title: "Holiday", allDay: true, startsAt: "2026-09-08T00:00", endsAt: "2026-09-09T23:59" });
    const all = f.store.listEvents(1), master = all.find((event) => event.id === series.id), override = all.find((event) => event.parentEventId === series.id);
    const body = googleExportBody(1, master, all, "Europe/Amsterdam");
    assert.deepEqual(body.start, { dateTime: "2026-09-01T09:00:00", timeZone: "Europe/Amsterdam" });
    assert.match(body.recurrence[0], /UNTIL=20260930T215900Z/);
    assert.match(body.recurrence[1], /20260908T090000/); assert.match(body.recurrence[1], /20260915T090000/);
    const moved = googleExportBody(1, override, all, "Europe/Amsterdam");
    assert.notEqual(moved.id, body.id); assert.equal(moved.recurrence, undefined);
    assert.equal(moved.start.dateTime, "2026-09-09T11:00:00");
    assert.deepEqual(googleExportBody(1, holiday, all, "Europe/Amsterdam").end, { date: "2026-09-10" });
    const result = await exportGoogleCalendarEvents(f.store, 1, readGoogleExportOptions({ eventIds: [series.id] }), f.client);
    assert.equal(result.created, 2, "choosing a series includes its moved overrides");
  } finally { f.db.close(); }
});

test("user ownership and explicit source selection are enforced before any provider request", async () => {
  const f = fixture();
  try {
    const [other] = f.store.listCalendarsEnsuringDefault(2);
    const event = f.store.createEvent(2, { calendarId: other.id, title: "Private", startsAt: "2026-09-08T10:00", endsAt: "2026-09-08T11:00" });
    await assert.rejects(exportGoogleCalendarEvents(f.store, 1, readGoogleExportOptions({ sourceCalendarIds: [other.id] }), f.client), /does not exist/);
    await assert.rejects(exportGoogleCalendarEvents(f.store, 1, readGoogleExportOptions({ eventIds: [event.id] }), f.client), /does not exist/);
    assert.equal(f.requests.length, 0);
    assert.throws(() => readGoogleExportOptions({ sourceCalendarIds: [] }), /non-empty/);
    assert.throws(() => readGoogleExportOptions({ timeZone: "fake" }), /valid IANA/);
    assert.throws(() => readGoogleExportOptions({ userId: 2 }), /Unknown/);
  } finally { f.db.close(); }
});

test("the snapshot boundary excludes events added while the export is in progress", async () => {
  const f = fixture(26);
  try {
    const first = await exportGoogleCalendarEvents(f.store, 1, f.options, f.client);
    f.store.createEvent(1, { calendarId: f.calendar.id, title: "Added later", startsAt: "2026-10-01T09:00", endsAt: "2026-10-01T10:00" });
    const final = await exportGoogleCalendarEvents(f.store, 1, first.nextArgs, f.client);
    assert.equal(final.created, 1); assert.equal(final.complete, true); assert.equal(f.remote.size, 26);
  } finally { f.db.close(); }
});

test("bulk actions are discoverable only with Google connected and retain read/write approval boundaries", () => {
  const preview = buildNangoActionInvocation("google_calendar_preview_breadboard_export", {});
  const write = buildNangoActionInvocation("google_calendar_export_breadboard_events", {});
  assert.equal(preview.action.readOnly, true); assert.equal(write.action.readOnly, false);
  assert.equal(write.action.risk, "write"); assert.equal(write.connectionSlug, "google-calendar");
  assert.ok(nangoActionSummariesForConnections(["google-calendar"]).some((action) => action.name === write.action.name));
  assert.ok(!nangoActionSummariesForConnections(["gmail"]).some((action) => action.name === write.action.name));
  assert.throws(() => buildNangoActionInvocation(write.action.name, { eventIds: [-1] }), /positive/);
});
