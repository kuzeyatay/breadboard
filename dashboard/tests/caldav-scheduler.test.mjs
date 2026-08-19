// The background tick that keeps synced calendars synced.
//
// Two things are worth pinning down: when a calendar is due — which is a pure
// function, so it is tested as one — and what a pass does with the ones that
// are, including the calendar whose password has gone missing and the one
// somebody else is already syncing.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  MAX_BACKOFF_MS,
  PENDING_INTERVAL_MS,
  SYNC_INTERVAL_MS,
  isDue,
  nextAttemptIn,
  runDueCaldavSyncs,
} from "../src/lib/calendar/caldav-scheduler.ts";
import { CalendarStore } from "../src/lib/calendar/store.ts";
import { SYNC_LEASE_MS } from "../src/lib/calendar/caldav-sync.ts";
import { nowStamp } from "../src/lib/calendar/wallclock.ts";

const COLLECTION = "https://dav.example/calendars/user/work/";

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return new CalendarStore(db);
}

const calendar = (overrides = {}) => ({
  userId: 1,
  calendarId: 1,
  name: "Work",
  url: COLLECTION,
  username: "sarah",
  lastSyncedAt: "2026-08-19T12:00",
  failures: 0,
  leaseUntil: null,
  ...overrides,
});

// ------------------------------------------------------------------ due-ness

test("a calendar that has never synced is due immediately", () => {
  assert.equal(
    isDue(calendar({ lastSyncedAt: null }), { pending: false, now: Date.now() }),
    true,
  );
});

test("nothing pending means the polite interval, something pending means a minute", () => {
  assert.equal(nextAttemptIn({ failures: 0 }, { pending: false }), SYNC_INTERVAL_MS);
  assert.equal(nextAttemptIn({ failures: 0 }, { pending: true }), PENDING_INTERVAL_MS);
});

test("failures double the wait, up to a ceiling", () => {
  const base = SYNC_INTERVAL_MS;
  assert.equal(nextAttemptIn({ failures: 1 }, { pending: false }), base * 2);
  assert.equal(nextAttemptIn({ failures: 3 }, { pending: false }), base * 8);
  assert.equal(nextAttemptIn({ failures: 40 }, { pending: false }), MAX_BACKOFF_MS);
});

test("a failing calendar is not retried early just because it has work waiting", () => {
  const failing = calendar({ failures: 2, lastSyncedAt: "2026-08-19T12:00" });
  const fiveMinutesLater = new Date("2026-08-19T12:05").getTime();
  assert.equal(isDue(failing, { pending: true, now: fiveMinutesLater }), false);
});

test("due-ness is measured from the last exchange", () => {
  const at = (time) => new Date(`2026-08-19T${time}`).getTime();
  const healthy = calendar({ lastSyncedAt: "2026-08-19T12:00" });

  assert.equal(isDue(healthy, { pending: false, now: at("12:10") }), false);
  assert.equal(isDue(healthy, { pending: false, now: at("12:16") }), true);
  assert.equal(isDue(healthy, { pending: true, now: at("12:00") }), false);
  assert.equal(isDue(healthy, { pending: true, now: at("12:02") }), true);
});

// ---------------------------------------------------------------------- pass

function scheduler(store, { secret = { username: "sarah", password: "pw" }, sync } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      store,
      readSecret: () => secret,
      sync: async (userId, calendarId, account) => {
        calls.push({ userId, calendarId, account });
        if (sync) return sync(userId, calendarId, account);
        store.markCaldavSynced(userId, calendarId, { syncedAt: nowStamp(), error: null });
        return {};
      },
    },
  };
}

function boundCalendar(store, userId = 1, name = "Work") {
  const created = store.createCalendar(userId, { name });
  store.bindCaldav(userId, created.id, { url: COLLECTION, username: "sarah", ctag: null });
  return created;
}

test("a pass syncs the calendars that are due and leaves the rest alone", async () => {
  const store = createStore();
  const due = boundCalendar(store, 1, "Due");
  const fresh = boundCalendar(store, 1, "Fresh");
  store.markCaldavSynced(1, fresh.id, { syncedAt: nowStamp(), error: null });

  const { deps, calls } = scheduler(store);
  const result = await runDueCaldavSyncs({ deps });

  assert.equal(result.synced, 1);
  assert.deepEqual(calls.map((call) => call.calendarId), [due.id]);
});

test("a calendar nobody bound is never considered", async () => {
  const store = createStore();
  store.createCalendar(1, { name: "Local only" });

  const { deps, calls } = scheduler(store);
  const result = await runDueCaldavSyncs({ deps });

  assert.deepEqual(result, { considered: 0, synced: 0, failed: 0, leased: 0 });
  assert.equal(calls.length, 0);
});

test("every account's calendars are swept, each with its own owner", async () => {
  const store = createStore();
  const mine = boundCalendar(store, 1, "Mine");
  const theirs = boundCalendar(store, 2, "Theirs");

  const { deps, calls } = scheduler(store);
  await runDueCaldavSyncs({ deps });

  assert.deepEqual(
    calls.map((call) => [call.userId, call.calendarId]).sort(),
    [
      [1, mine.id],
      [2, theirs.id],
    ].sort(),
  );
});

test("a missing password is recorded on the calendar, not retried in a loop", async () => {
  const store = createStore();
  const bound = boundCalendar(store);

  const { deps, calls } = scheduler(store, { secret: null });
  const result = await runDueCaldavSyncs({ deps });

  assert.equal(result.failed, 1);
  assert.equal(calls.length, 0, "no request is made without a password");

  const after = store.getCalendar(1, bound.id);
  assert.match(after.syncError, /password is missing/);

  // And it is now backing off: the next pass a minute later leaves it alone.
  const soon = new Date(Date.now() + 2 * 60_000);
  const second = await runDueCaldavSyncs({ deps, now: soon });
  assert.equal(second.considered, 0);
});

test("one unreachable server does not stop the others in the pass", async () => {
  const store = createStore();
  const broken = boundCalendar(store, 1, "Broken");
  const fine = boundCalendar(store, 1, "Fine");

  const { deps } = scheduler(store, {
    sync: async (userId, calendarId) => {
      if (calendarId === broken.id) {
        store.markCaldavSynced(userId, calendarId, {
          syncedAt: nowStamp(),
          error: "Could not reach the calendar server.",
        });
        throw new Error("Could not reach the calendar server.");
      }
      store.markCaldavSynced(userId, calendarId, { syncedAt: nowStamp(), error: null });
      return {};
    },
  });

  const result = await runDueCaldavSyncs({ deps });

  assert.equal(result.failed, 1);
  assert.equal(result.synced, 1);
  assert.match(store.getCalendar(1, broken.id).syncError, /Could not reach/);
  assert.equal(store.getCalendar(1, fine.id).syncError, null);
});

test("a calendar somebody else is syncing counts as busy, not as failed", async () => {
  const store = createStore();
  boundCalendar(store);

  const { deps } = scheduler(store, {
    sync: async () => {
      const refusal = new Error('"Work" is syncing right now.');
      refusal.status = 409;
      throw refusal;
    },
  });

  const result = await runDueCaldavSyncs({ deps });

  assert.equal(result.leased, 1);
  assert.equal(result.failed, 0, "a busy calendar must not accrue a backoff");
});

// ------------------------------------------------------------------- leasing

test("a held lease blocks a second claim until it expires", () => {
  const store = createStore();
  const bound = boundCalendar(store);

  const now = new Date("2026-08-19T12:00:00Z");
  const until = new Date(now.getTime() + SYNC_LEASE_MS).toISOString();

  assert.equal(store.claimCaldavSync(bound.id, until, now.toISOString()), true);
  assert.equal(
    store.claimCaldavSync(bound.id, until, now.toISOString()),
    false,
    "the second caller is refused",
  );

  // A process that died mid-sync must not hold the calendar forever.
  const afterExpiry = new Date(now.getTime() + SYNC_LEASE_MS + 1_000).toISOString();
  assert.equal(store.claimCaldavSync(bound.id, until, afterExpiry), true);

  store.releaseCaldavSync(bound.id);
  assert.equal(store.claimCaldavSync(bound.id, until, now.toISOString()), true);
});

// ------------------------------------------------------------ pending detection

test("pending work is local edits or local deletions, and nothing else", () => {
  const store = createStore();
  const bound = boundCalendar(store);
  assert.equal(store.hasPendingRemoteWork(1, bound.id), false);

  const event = store.createEvent(1, {
    calendarId: bound.id,
    title: "New",
    startsAt: "2026-09-03T11:00",
    endsAt: "2026-09-03T12:00",
  });
  assert.equal(store.hasPendingRemoteWork(1, bound.id), true, "a new event is waiting");

  store.markRemoteSynced(1, event.id, { href: `${COLLECTION}a.ics`, etag: '"v1"' });
  assert.equal(store.hasPendingRemoteWork(1, bound.id), false, "once sent, nothing waits");

  store.deleteEvent(1, event.id);
  assert.equal(store.hasPendingRemoteWork(1, bound.id), true, "a deletion is waiting too");
});

test("failures reset the moment a sync succeeds", () => {
  const store = createStore();
  const bound = boundCalendar(store);

  store.markCaldavSynced(1, bound.id, { syncedAt: nowStamp(), error: "nope" });
  store.markCaldavSynced(1, bound.id, { syncedAt: nowStamp(), error: "nope again" });
  assert.equal(
    store.listSyncableCalendars().find((entry) => entry.calendarId === bound.id).failures,
    2,
  );

  store.markCaldavSynced(1, bound.id, { syncedAt: nowStamp(), error: null });
  assert.equal(
    store.listSyncableCalendars().find((entry) => entry.calendarId === bound.id).failures,
    0,
  );
});

test("an unusable vault refuses each calendar rather than abandoning the pass", async () => {
  const store = createStore();
  const first = boundCalendar(store, 1, "First");
  const second = boundCalendar(store, 1, "Second");

  const { deps } = scheduler(store);
  deps.readSecret = () => {
    const refusal = new Error("Calendar syncing needs NEXTAUTH_SECRET to be set.");
    refusal.status = 503;
    throw refusal;
  };

  const result = await runDueCaldavSyncs({ deps });

  assert.equal(result.failed, 2, "both calendars were reached");
  for (const id of [first.id, second.id]) {
    assert.match(store.getCalendar(1, id).syncError, /NEXTAUTH_SECRET/);
  }
});
