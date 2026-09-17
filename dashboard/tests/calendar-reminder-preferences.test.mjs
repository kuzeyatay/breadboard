import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { CalendarStore, CalendarError } from "../src/lib/calendar/store.ts";
import { readEventPatch } from "../src/lib/calendar/payload.ts";

function setup(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2)");
  const store = new CalendarStore(db);
  const [calendar] = store.listCalendarsEnsuringDefault(1);
  return { db, store, calendar };
}

const meeting = (calendarId, patch = {}) => ({
  calendarId, title: "Class", startsAt: "2026-09-08T09:00", endsAt: "2026-09-08T10:00", ...patch,
});

test("new and existing events default on; a saved false survives re-opening and unrelated edits", t => {
  const { db, store, calendar } = setup(t);
  const event = store.createEvent(1, meeting(calendar.id));
  assert.equal(event.leadReminderEnabled, true);
  assert.equal(event.notificationsEnabled, true);
  assert.deepEqual(readEventPatch({ leadReminderEnabled: false }), { leadReminderEnabled: false });
  assert.deepEqual(readEventPatch({ title: "Renamed" }), { title: "Renamed" });
  store.updateEvent(1, event.id, readEventPatch({ leadReminderEnabled: false }));
  const reopened = new CalendarStore(db);
  assert.equal(reopened.getEvent(1, event.id).leadReminderEnabled, false);
  assert.equal(reopened.updateEvent(1, event.id, { title: "Renamed" }).leadReminderEnabled, false);
  assert.equal(reopened.occurrencesInRange(1, "2026-09-08", "2026-09-08")[0].leadReminderEnabled, false);
  assert.equal(store.createEvent(1, meeting(calendar.id, { leadReminderEnabled: false })).leadReminderEnabled, false);
});

test("the notification switch saves independently, survives reloads, and preserves the advance reminder", t => {
  const { db, store, calendar } = setup(t);
  const event = store.createEvent(1, meeting(calendar.id, { notificationsEnabled: false, leadReminderEnabled: false }));
  assert.equal(event.notificationsEnabled, false);
  const reopened = new CalendarStore(db);
  assert.equal(reopened.getEvent(1, event.id).notificationsEnabled, false);
  assert.equal(reopened.updateEvent(1, event.id, { title: "Renamed" }).notificationsEnabled, false);
  assert.equal(reopened.occurrencesInRange(1, "2026-09-08", "2026-09-08")[0].notificationsEnabled, false);
  const enabled = reopened.updateEvent(1, event.id, readEventPatch({ notificationsEnabled: true }));
  assert.equal(enabled.notificationsEnabled, true);
  assert.equal(enabled.leadReminderEnabled, false);
  const muted = reopened.updateEvent(1, event.id, readEventPatch({ notificationsEnabled: false, leadReminderEnabled: true }));
  assert.equal(muted.notificationsEnabled, false);
  assert.equal(muted.leadReminderEnabled, true);
  assert.throws(() => reopened.updateEvent(1, event.id, { notificationsEnabled: "false" }), CalendarError);
});

test("adding the notification switch defaults on without resetting an existing advance preference", t => {
  const { db, store, calendar } = setup(t);
  const event = store.createEvent(1, meeting(calendar.id, { leadReminderEnabled: false }));
  db.exec("ALTER TABLE calendar_events DROP COLUMN notifications_enabled");
  const upgraded = new CalendarStore(db).getEvent(1, event.id);
  assert.equal(upgraded.notificationsEnabled, true);
  assert.equal(upgraded.leadReminderEnabled, false);
});

test("upgrading an existing database enables reminders and preserves its events", t => {
  const { db, store, calendar } = setup(t);
  const event = store.createEvent(1, meeting(calendar.id));
  db.exec("ALTER TABLE calendar_events DROP COLUMN lead_reminder_enabled");
  db.exec(`
    DROP TRIGGER trg_calendar_events_content_dirty_update;
    CREATE TRIGGER trg_calendar_events_dirty_update AFTER UPDATE ON calendar_events
    WHEN NEW.remote_dirty = 0 AND OLD.remote_dirty = 0
    BEGIN UPDATE calendar_events SET remote_dirty = 1 WHERE id = NEW.id; END;
  `);
  const upgraded = new CalendarStore(db);
  assert.equal(upgraded.getEvent(1, event.id).title, "Class");
  assert.equal(upgraded.getEvent(1, event.id).leadReminderEnabled, true);
  assert.equal(new CalendarStore(db).getEvent(1, event.id).leadReminderEnabled, true);
  db.prepare("UPDATE calendar_events SET remote_dirty = 0 WHERE id = ?").run(event.id);
  upgraded.updateEvent(1, event.id, { leadReminderEnabled: false });
  assert.equal(db.prepare("SELECT remote_dirty FROM calendar_events WHERE id = ?").get(event.id).remote_dirty, 0);
});

test("recurring edits inherit the setting; a series reminder change includes existing overrides", t => {
  const { store, calendar } = setup(t);
  const master = store.createEvent(1, meeting(calendar.id, {
    notificationsEnabled: false, leadReminderEnabled: false, recurrence: { frequency: "daily", count: 5 },
  }));
  const override = store.updateEventScoped(1, {
    eventId: master.id, recurrenceId: "2026-09-09T09:00", scope: "instance", patch: { title: "Room change" },
  });
  assert.equal(override.leadReminderEnabled, false);
  assert.equal(override.notificationsEnabled, false);
  store.updateEventScoped(1, {
    eventId: override.id, scope: "series", patch: { notificationsEnabled: true, leadReminderEnabled: true },
  });
  assert.equal(store.getEvent(1, override.id).leadReminderEnabled, true);
  assert.ok(store.occurrencesInRange(1, "2026-09-08", "2026-09-12").every(item => item.notificationsEnabled));
  assert.ok(store.occurrencesInRange(1, "2026-09-08", "2026-09-12").every(item => item.leadReminderEnabled));
  store.updateEventScoped(1, {
    eventId: master.id, scope: "series", patch: { title: "New class", notificationsEnabled: false, leadReminderEnabled: false },
  });
  assert.equal(store.getEvent(1, override.id).leadReminderEnabled, false);
  assert.equal(store.getEvent(1, override.id).notificationsEnabled, false);
  const following = store.updateEventScoped(1, {
    eventId: master.id, scope: "following", recurrenceId: "2026-09-10T09:00", patch: { title: "Next classes" },
  });
  assert.equal(following.leadReminderEnabled, false);
  assert.equal(following.notificationsEnabled, false);
});

test("subscribed events allow personal reminders, retain them on refresh, and enforce ownership", t => {
  const { db, store } = setup(t);
  const calendar = store.createCalendar(1, { name: "Classes", readOnly: true, sourceUrl: "https://example.com/classes.ics" });
  const input = meeting(calendar.id, { uid: "class@example.com", recurrence: { frequency: "daily", count: 5 } });
  store.ingestEvents(1, calendar.id, [input]);
  const event = store.listEvents(1).find(item => item.calendarId === calendar.id);
  db.prepare("UPDATE calendar_events SET remote_dirty = 0 WHERE id = ?").run(event.id);
  const updated = store.updateEventScoped(1, {
    eventId: event.id, scope: "series", patch: { notificationsEnabled: false, leadReminderEnabled: false },
  });
  assert.equal(updated.leadReminderEnabled, false);
  assert.equal(updated.notificationsEnabled, false);
  assert.equal(db.prepare("SELECT remote_dirty FROM calendar_events WHERE id = ?").get(event.id).remote_dirty, 0);
  assert.throws(() => store.updateEventScoped(2, {
    eventId: event.id, scope: "series", patch: { notificationsEnabled: true },
  }), CalendarError);
  assert.throws(() => store.updateEventScoped(1, {
    eventId: event.id, scope: "series", patch: { notificationsEnabled: true, leadReminderEnabled: true, title: "Changed" },
  }), CalendarError);
  store.ingestEvents(1, calendar.id, [{ ...input, title: "Updated class" }], { replace: true });
  assert.equal(store.getEvent(1, event.id).title, "Updated class");
  assert.equal(store.getEvent(1, event.id).leadReminderEnabled, false);
  assert.equal(store.getEvent(1, event.id).notificationsEnabled, false);
  assert.ok(store.occurrencesInRange(1, "2026-09-08", "2026-09-12").every(item => !item.leadReminderEnabled));
  store.ingestEvents(1, calendar.id, [input, {
    ...input, title: "New room", recurrence: null,
    recurrenceId: "2026-09-09T09:00", startsAt: "2026-09-09T09:00", endsAt: "2026-09-09T10:00",
  }], { replace: true });
  const override = store.listEvents(1).find(item => item.parentEventId === event.id);
  assert.equal(override.leadReminderEnabled, false, "new remote overrides inherit the series preference");
  assert.equal(override.notificationsEnabled, false);
});

test("the schema upgrade keeps content edits dirty for CalDAV while preferences remain local", t => {
  const { db, store, calendar } = setup(t);
  const event = store.createEvent(1, meeting(calendar.id));
  const clean = () => db.prepare("UPDATE calendar_events SET remote_dirty = 0 WHERE id = ?").run(event.id);
  const dirty = () => db.prepare("SELECT remote_dirty FROM calendar_events WHERE id = ?").get(event.id).remote_dirty;
  clean();
  store.updateEvent(1, event.id, { leadReminderEnabled: false });
  assert.equal(dirty(), 0);
  store.updateEvent(1, event.id, { notificationsEnabled: false });
  assert.equal(dirty(), 0);
  store.updateEvent(1, event.id, { notificationsEnabled: true, leadReminderEnabled: false });
  assert.equal(dirty(), 0);
  store.updateEvent(1, event.id, { title: "New title", leadReminderEnabled: true });
  assert.equal(dirty(), 1);
  clean();
  store.updateEvent(1, event.id, { title: "Another title" });
  assert.equal(dirty(), 1);
});
