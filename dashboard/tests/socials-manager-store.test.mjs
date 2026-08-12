// The SQLite-backed Socials Manager store and its calendar bridge, run against an
// in-memory database holding both schemas — the join between a post and the
// calendar event it occupies is the part worth proving.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { SocialsManagerError, SocialsManagerStore } from "../src/lib/socials-manager/store.ts";
import { CalendarStore } from "../src/lib/calendar/store.ts";
import {
  SOCIAL_CALENDAR_NAME,
  deletePostWithEvent,
  ensureSocialCalendar,
  reconcileOrphanedSchedules,
  schedulePost,
  syncPostFromCalendar,
  unschedulePost,
} from "../src/lib/socials-manager/calendar-bridge.ts";
import {
  findSocialsManagerProvider,
  OFFLINE_DRAFT_PROVIDER_IDS,
  SOCIALS_MANAGER_PROVIDERS,
  resolveProviderMention,
} from "../src/lib/socials-manager/providers.ts";
import {
  parseSocialsManagerRequest,
  socialsManagerUserMessage,
  taskFromSocialsManagerCommand,
} from "../src/lib/socials-manager/identity.ts";

function createStores() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  // The calendar schema must exist first: socials_manager_posts references it.
  const calendar = new CalendarStore(db);
  const socialsManager = new SocialsManagerStore(db);
  return { socialsManager, calendar };
}

// ------------------------------------------------------------------ providers

test("every provider carries a usable character limit and editor", () => {
  assert.ok(SOCIALS_MANAGER_PROVIDERS.length >= 30);
  for (const provider of SOCIALS_MANAGER_PROVIDERS) {
    assert.ok(provider.maxCharacters > 0, `${provider.id} has no limit`);
    assert.ok(["normal", "markdown", "html"].includes(provider.editor));
  }
});

test("provider ids are unique", () => {
  const ids = SOCIALS_MANAGER_PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("offline drafting covers broad text social formats including Instagram", () => {
  assert.ok(OFFLINE_DRAFT_PROVIDER_IDS.includes("instagram"));
  assert.ok(OFFLINE_DRAFT_PROVIDER_IDS.includes("x"));
  assert.ok(OFFLINE_DRAFT_PROVIDER_IDS.length >= 5);
  assert.ok(
    OFFLINE_DRAFT_PROVIDER_IDS.every((providerId) => findSocialsManagerProvider(providerId)),
  );
});

test("common aliases resolve to the ported provider ids", () => {
  assert.equal(resolveProviderMention("twitter")?.id, "x");
  assert.equal(resolveProviderMention("LinkedIn")?.id, "linkedin");
  assert.equal(resolveProviderMention("warpcast")?.id, "wrapcast");
  assert.equal(resolveProviderMention("nonsense"), null);
});

// ------------------------------------------------------------------- identity

test("the slash command is parsed and round-trips", () => {
  assert.equal(taskFromSocialsManagerCommand("/agents:socials-manager launch day"), "launch day");
  assert.equal(taskFromSocialsManagerCommand("/agents:socials-manager"), "");
  assert.equal(taskFromSocialsManagerCommand("just text"), null);
  assert.equal(socialsManagerUserMessage("hi"), "/agents:socials-manager hi");
});

test("preceding capability tokens survive the socials-manager token", () => {
  assert.equal(
    taskFromSocialsManagerCommand("/unslop /agents:socials-manager launch day"),
    "/unslop launch day",
  );
});

test("inline flags choose networks and pin the publish time", () => {
  const request = parseSocialsManagerRequest(
    "our launch --on twitter,linkedin --at 2026-08-05T09:00",
  );
  assert.deepEqual(request.providerIds, ["x", "linkedin"]);
  assert.equal(request.scheduleAt, "2026-08-05T09:00");
  assert.equal(request.brief, "our launch");
});

test("a bare date flag defaults to a 09:00 slot", () => {
  assert.equal(parseSocialsManagerRequest("news --at 2026-08-05").scheduleAt, "2026-08-05T09:00");
});

test("an unparseable flag stays part of the brief", () => {
  const request = parseSocialsManagerRequest("ship it --at yesterday");
  assert.equal(request.scheduleAt, null);
  assert.match(request.brief, /--at yesterday/);
});

test("no network flag delegates network choice to account or offline defaults", () => {
  assert.deepEqual(parseSocialsManagerRequest("hello").providerIds, []);
});

// ---------------------------------------------------------------------- posts

test("a post is rejected when it exceeds its own network's limit", () => {
  const { socialsManager } = createStores();
  const limit = findSocialsManagerProvider("x").maxCharacters;
  assert.throws(
    () => socialsManager.createPost(1, { providerId: "x", content: "a".repeat(limit + 1) }),
    (error) => error instanceof SocialsManagerError && error.status === 400,
  );
});

test("the same copy can be legal on one network and illegal on another", () => {
  const { socialsManager } = createStores();
  const content = "a".repeat(500);
  assert.ok(socialsManager.createPost(1, { providerId: "linkedin", content }));
  assert.throws(() => socialsManager.createPost(1, { providerId: "x", content }));
});

test("an unknown network is refused", () => {
  const { socialsManager } = createStores();
  assert.throws(
    () => socialsManager.createPost(1, { providerId: "myspace", content: "hi" }),
    (error) => error instanceof SocialsManagerError && error.status === 400,
  );
});

test("posts are scoped to their owner", () => {
  const { socialsManager } = createStores();
  const post = socialsManager.createPost(1, { providerId: "x", content: "mine" });
  assert.throws(
    () => socialsManager.getPost(2, post.id),
    (error) => error instanceof SocialsManagerError && error.status === 404,
  );
});

test("posts can be listed back by the run that drafted them", () => {
  const { socialsManager } = createStores();
  socialsManager.createPost(1, { providerId: "x", content: "one", runId: "run_a" });
  socialsManager.createPost(1, { providerId: "linkedin", content: "two", runId: "run_a" });
  socialsManager.createPost(1, { providerId: "x", content: "three", runId: "run_b" });
  assert.equal(socialsManager.listPostsByRun(1, "run_a").length, 2);
});

test("a channel must belong to the post's own network", () => {
  const { socialsManager } = createStores();
  const channel = socialsManager.createChannel(1, { providerId: "x", handle: "@me" });
  assert.throws(
    () =>
      socialsManager.createPost(1, {
        providerId: "linkedin",
        content: "hi",
        channelId: channel.id,
      }),
    (error) => error instanceof SocialsManagerError && error.status === 400,
  );
});

// ------------------------------------------------------------- calendar bridge

test("scheduling a post creates a real calendar event in the Social calendar", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });

  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");

  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.scheduledAt, "2026-08-05T09:00");
  assert.ok(scheduled.calendarEventId);

  const event = stores.calendar.getEvent(1, scheduled.calendarEventId);
  assert.equal(event.startsAt, "2026-08-05T09:00");
  assert.match(event.title, /^X: launch/);
  assert.equal(event.description, "launch");

  const social = stores.calendar
    .listCalendars(1)
    .find((calendar) => calendar.id === event.calendarId);
  assert.equal(social.name, SOCIAL_CALENDAR_NAME);
});

test("the Social calendar is created once and reused", () => {
  const stores = createStores();
  const first = ensureSocialCalendar(stores, 1);
  const second = ensureSocialCalendar(stores, 1);
  assert.equal(first, second);
  assert.equal(
    stores.calendar.listCalendars(1).filter((c) => c.name === SOCIAL_CALENDAR_NAME).length,
    1,
  );
});

test("rescheduling moves the existing event rather than making a second one", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const first = schedulePost(stores, 1, post.id, "2026-08-05T09:00");
  const second = schedulePost(stores, 1, post.id, "2026-08-06T14:30");

  assert.equal(first.calendarEventId, second.calendarEventId);
  assert.equal(
    stores.calendar.getEvent(1, second.calendarEventId).startsAt,
    "2026-08-06T14:30",
  );
});

test("a post deleted from the calendar by hand is rescheduled onto a fresh event", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");

  stores.calendar.deleteEvent(1, scheduled.calendarEventId);
  const rescheduled = schedulePost(stores, 1, post.id, "2026-08-07T10:00");

  assert.ok(rescheduled.calendarEventId);
  assert.notEqual(rescheduled.calendarEventId, scheduled.calendarEventId);
});

test("unscheduling removes the calendar event and returns the post to a draft", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");
  const eventId = scheduled.calendarEventId;

  const drafted = unschedulePost(stores, 1, post.id);

  assert.equal(drafted.status, "draft");
  assert.equal(drafted.scheduledAt, null);
  assert.equal(drafted.calendarEventId, null);
  assert.throws(() => stores.calendar.getEvent(1, eventId));
});

test("moving the event in the calendar reschedules the post", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");

  stores.calendar.updateEvent(1, scheduled.calendarEventId, {
    startsAt: "2026-08-09T18:00",
    endsAt: "2026-08-09T18:15",
  });
  const synced = syncPostFromCalendar(stores, 1, scheduled.calendarEventId);

  assert.equal(synced.scheduledAt, "2026-08-09T18:00");
  assert.equal(synced.status, "scheduled");
});

test("deleting the event in the calendar unschedules the post", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");

  stores.calendar.deleteEvent(1, scheduled.calendarEventId);

  // The foreign key nulls the link before anything can observe the deletion, so
  // the post is found by reconciliation rather than by event id.
  assert.equal(syncPostFromCalendar(stores, 1, scheduled.calendarEventId), null);
  const [reconciled] = reconcileOrphanedSchedules(stores, 1);

  assert.equal(reconciled.status, "draft");
  assert.equal(reconciled.scheduledAt, null);
});

test("reconciliation leaves posts whose events are intact alone", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  schedulePost(stores, 1, post.id, "2026-08-05T09:00");
  assert.deepEqual(reconcileOrphanedSchedules(stores, 1), []);
  assert.equal(stores.socialsManager.getPost(1, post.id).status, "scheduled");
});

test("an unchanged event reports no move", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");
  assert.equal(syncPostFromCalendar(stores, 1, scheduled.calendarEventId), null);
});

test("deleting a post takes its calendar slot with it", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");

  deletePostWithEvent(stores, 1, post.id);

  assert.throws(() => stores.socialsManager.getPost(1, post.id));
  assert.throws(() => stores.calendar.getEvent(1, scheduled.calendarEventId));
});

test("creating a post with a schedule lands it on the calendar in one step", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, {
    providerId: "linkedin",
    content: "hello",
    scheduledAt: "2026-08-05T09:00",
  });
  assert.equal(post.status, "scheduled");

  const scheduled = schedulePost(stores, 1, post.id, post.scheduledAt);
  assert.ok(scheduled.calendarEventId);
});

test("a published post cannot be rescheduled", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  stores.socialsManager.markPublished(1, post.id, "2026-08-05T09:00");
  assert.throws(
    () => schedulePost(stores, 1, post.id, "2026-08-06T09:00"),
    (error) => error instanceof SocialsManagerError && error.status === 409,
  );
});

test("dropping the calendar event leaves the post but clears the link", () => {
  const stores = createStores();
  const post = stores.socialsManager.createPost(1, { providerId: "x", content: "launch" });
  const scheduled = schedulePost(stores, 1, post.id, "2026-08-05T09:00");

  // ON DELETE SET NULL: the draft is the product and must outlive its slot.
  stores.calendar.deleteEvent(1, scheduled.calendarEventId);

  const survivor = stores.socialsManager.getPost(1, post.id);
  assert.equal(survivor.content, "launch");
  assert.equal(survivor.calendarEventId, null);
});
