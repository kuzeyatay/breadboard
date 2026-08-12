// The world monitor and calendar, wired as agent tools.
//
// Two halves. The wiring half guards the failure this repo has hit before: a
// tool wired on the Breadboard side but never registered with the runtime, so
// the model is never offered it. The behaviour half runs the query layers for
// real — the calendar against an in-memory database, the monitor against the
// paths that reject a bad filter before any feed is fetched.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  CALENDAR_TOOLS,
  WORLDMONITOR_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { CalendarStore } from "../src/lib/calendar/store.ts";
import {
  agenda,
  describeRecurrence,
  getEvent,
  listCalendars,
  resolveRange,
  searchEvents,
} from "../src/lib/calendar/agent-query.ts";
import {
  monitorCatalog,
  monitorClimate,
  monitorSearch,
  monitorSnapshot,
  WorldMonitorQueryError,
} from "../src/lib/worldmonitor/agent-query.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALL_TOOLS = [...WORLDMONITOR_TOOLS, ...CALENDAR_TOOLS];

// ── wiring ──────────────────────────────────────────────────────────────────

test("both families expose exactly the intended tools", () => {
  assert.deepEqual([...WORLDMONITOR_TOOLS].sort(), [
    "worldmonitor_catalog",
    "worldmonitor_climate",
    "worldmonitor_search",
    "worldmonitor_snapshot",
  ]);
  assert.deepEqual([...CALENDAR_TOOLS].sort(), [
    "calendar_agenda",
    "calendar_get_event",
    "calendar_list_calendars",
    "calendar_search_events",
  ]);
});

test("nothing here can write: the query layer exports no mutation at all", () => {
  const forbidden = ["create", "update", "delete", "add", "move", "set", "control", "import"];
  for (const tool of ALL_TOOLS) {
    for (const bad of forbidden) {
      assert.ok(!tool.includes(bad), `${tool} must not expose a ${bad} operation`);
    }
  }
  // The route is the only thing that decides which store methods are reachable,
  // so it is what has to be free of the write methods rather than the names.
  const route = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "calendar", "route.ts"),
    "utf8",
  );
  for (const method of [
    "createEvent",
    "updateEvent",
    "deleteEvent",
    "updateEventScoped",
    "deleteEventScoped",
    "createCalendar",
    "updateCalendar",
    "deleteCalendar",
    "ingestEvents",
    "setAttendeeStatus",
  ]) {
    assert.ok(!route.includes(method), `the calendar tool route must not reach ${method}`);
  }
});

test("Quartz AI never receives them; the authenticated surfaces do", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of ALL_TOOLS) {
    assert.ok(!quartz.includes(tool), `quartz_ai must not receive ${tool}`);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of ALL_TOOLS) {
      assert.ok(allowed.includes(tool), `${surface} should receive ${tool}`);
    }
  }
});

test("every tool is brokered, so none can be inherited by default", () => {
  for (const tool of ALL_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} must be in BROKERED_TOOLS`);
  }
});

test("every tool is registered with the runtime, in all three places", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const manifestEntries = manifest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  for (const tool of ALL_TOOLS) {
    assert.ok(manifestEntries.includes(tool), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
  }

  for (const kind of ["worldmonitor", "calendar"]) {
    assert.ok(plugin.includes(`"/api/hermes/tools/${kind}"`), `${kind} has no route in the plugin`);
    assert.ok(
      fs.existsSync(
        path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", kind, "route.ts"),
      ),
      `the route the plugin posts to must exist for ${kind}`,
    );
  }

  // An unrecognized route_kind falls through to a premortem-shaped payload the
  // routes do not understand, which would fail only at call time.
  assert.match(
    plugin,
    // Membership, not the exact set: other families join this branch over time,
    // and pinning the whole list makes an unrelated addition fail here.
    /route_kind in \{[^}]*"worldmonitor"[^}]*"calendar"[^}]*\}/,
    "both kinds must produce the {tool, args} payload their routes read",
  );
});

test("both skills resolve ready on the authenticated surfaces, and not on Quartz", () => {
  const expected = {
    "world-monitor": [...WORLDMONITOR_TOOLS],
    calendar: [...CALENDAR_TOOLS],
  };
  for (const [slug, requiredTools] of Object.entries(expected)) {
    for (const surface of ["dashboard_terminal", "garden_chat"]) {
      const skill = listFirstPartySkills(surface).find((entry) => entry.slug === slug);
      assert.ok(skill, `${slug} missing on ${surface}`);
      assert.equal(skill.availability, "ready", `${slug} not ready on ${surface}`);
      assert.equal(skill.category, "Prebuilt");
      assert.deepEqual(skill.capabilityContract?.requiredTools, requiredTools);
    }
    assert.equal(
      listFirstPartySkills("quartz_ai").some(
        (skill) => skill.slug === slug && skill.availability === "ready",
      ),
      false,
      `${slug} must not be ready on quartz_ai`,
    );
  }
});

test("the calendar skill states the boundary it cannot cross", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-skills", "prebuilt", "calendar", "SKILL.md"),
    "utf8",
  );
  assert.match(manifest, /read your calendar but not write to it|can read the calendar, not change it/i);
  assert.match(manifest, /allTime/);
});

// ── calendar behaviour ──────────────────────────────────────────────────────

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return new CalendarStore(db);
}

/** Wednesday 2026-08-05, so a weekly rule is easy to reason about. */
const REFERENCE = new Date(2026, 7, 5, 10, 30);

function seeded() {
  const store = createStore();
  const [personal] = store.listCalendarsEnsuringDefault(1);
  store.createEvent(1, {
    calendarId: personal.id,
    title: "Standup",
    startsAt: "2026-08-05T09:00",
    endsAt: "2026-08-05T09:15",
    recurrence: { frequency: "weekly", interval: 1 },
    attendees: [{ email: "ana@example.com", name: "Ana Ruiz" }],
  });
  store.createEvent(1, {
    calendarId: personal.id,
    title: "Dentist",
    location: "Clinic on Oak Street",
    startsAt: "2026-08-06T14:00",
    endsAt: "2026-08-06T15:00",
  });
  store.createEvent(1, {
    calendarId: personal.id,
    title: "Quarter close",
    description: "Reconcile the ledger with Ana before sign-off.",
    startsAt: "2026-09-30T10:00",
    endsAt: "2026-09-30T12:00",
  });
  // Another user's event, to prove scoping.
  const [other] = store.listCalendarsEnsuringDefault(2);
  store.createEvent(2, {
    calendarId: other.id,
    title: "Not yours",
    startsAt: "2026-08-05T09:00",
    endsAt: "2026-08-05T10:00",
  });
  return { store, personal };
}

test("a window with no dates means today, for the number of days asked", () => {
  const range = resolveRange({}, REFERENCE);
  assert.equal(range.from, "2026-08-05T00:00");
  assert.equal(range.to, "2026-08-11T23:59", "seven days, inclusive of today");
  assert.equal(range.defaultedToToday, true);

  assert.equal(resolveRange({ days: 1 }, REFERENCE).to, "2026-08-05T23:59");
  // A bare date is widened to the whole day at both ends.
  const explicit = resolveRange({ from: "2026-08-10", to: "2026-08-10" }, REFERENCE);
  assert.deepEqual([explicit.from, explicit.to], ["2026-08-10T00:00", "2026-08-10T23:59"]);
  // A stamp is respected exactly, so "after 14:00" stays after 14:00.
  assert.equal(resolveRange({ from: "2026-08-10T14:00", days: 1 }, REFERENCE).from, "2026-08-10T14:00");

  assert.throws(() => resolveRange({ from: "next tuesday" }, REFERENCE), /not a date/);
  assert.throws(() => resolveRange({ from: "2026-08-10", to: "2026-08-01" }, REFERENCE), /ends before/);

  // The two ways of ending a window differ on purpose: `days` is a knob and
  // clamps to the store's ceiling, an explicit `to` is a stated intent and is
  // refused rather than quietly answered with a shorter range than was asked for.
  assert.equal(
    resolveRange({ days: 900 }, REFERENCE).to,
    resolveRange({ days: 400 }, REFERENCE).to,
    "an over-long `days` clamps to the 400-day ceiling",
  );
  assert.throws(
    () => resolveRange({ from: "2026-01-01", to: "2028-01-01" }, REFERENCE),
    /at most 400 days/,
  );
});

test("the agenda expands a recurring series and stays inside its own user", () => {
  const { store } = seeded();
  const week = agenda(store, 1, {}, REFERENCE);

  assert.equal(week.today, "2026-08-05");
  const titles = week.occurrences.map((occurrence) => occurrence.title);
  assert.deepEqual(titles, ["Standup", "Dentist"], "one standup in a one-week window");
  assert.equal(week.occurrences[0].recurring, true);
  assert.equal(week.occurrences[0].attendees, 1);
  assert.equal(week.occurrences[1].location, "Clinic on Oak Street");
  assert.ok(!titles.includes("Not yours"), "another user's event must never appear");

  const month = agenda(store, 1, { days: 28 }, REFERENCE);
  const standups = month.occurrences.filter((occurrence) => occurrence.title === "Standup");
  assert.equal(standups.length, 4, "four weekly instances in four weeks");
  assert.deepEqual(
    standups.map((occurrence) => occurrence.start),
    ["2026-08-05T09:00", "2026-08-12T09:00", "2026-08-19T09:00", "2026-08-26T09:00"],
  );

  // Descriptions are opt-in: an agenda is a list, not a document dump.
  assert.equal(agenda(store, 1, { days: 60 }, REFERENCE).occurrences.some((o) => o.description), false);
  assert.ok(
    agenda(store, 1, { days: 60, includeDescriptions: true }, REFERENCE).occurrences.some(
      (occurrence) => occurrence.description?.includes("Reconcile the ledger"),
    ),
  );
});

test("a truncated window says so instead of passing itself off as the whole day", () => {
  const { store } = seeded();
  const capped = agenda(store, 1, { days: 28, limit: 2 }, REFERENCE);
  assert.equal(capped.returned, 2);
  assert.ok(capped.total > capped.returned);
  assert.equal(capped.occurrences.length, 2);
});

test("search finds people and prose, not just titles", () => {
  const { store } = seeded();

  // An attendee lives in its own table — the reason search is a store method.
  const byPerson = searchEvents(store, 1, { query: "ana@example.com", days: 28 }, REFERENCE);
  assert.equal(byPerson.mode, "occurrences");
  assert.equal(byPerson.total, 4, "every standup in the window is its own answer");

  const byName = searchEvents(store, 1, { query: "Ana Ruiz", allTime: true }, REFERENCE);
  assert.deepEqual(byName.events.map((event) => event.title), ["Standup"]);

  // Prose in a description is searchable too, and "Ana" appears in both.
  const both = searchEvents(store, 1, { query: "ana", allTime: true }, REFERENCE);
  assert.deepEqual(
    both.events.map((event) => event.title).sort(),
    ["Quarter close", "Standup"],
  );

  const byPlace = searchEvents(store, 1, { query: "Oak Street", allTime: true }, REFERENCE);
  assert.deepEqual(byPlace.events.map((event) => event.title), ["Dentist"]);
});

test("all-time search answers *when*: one row per event, dated by its next firing", () => {
  const { store } = seeded();
  const found = searchEvents(store, 1, { query: "standup", allTime: true }, REFERENCE);

  assert.equal(found.mode, "events");
  assert.equal(found.events.length, 1, "not one row per repeat");
  assert.equal(found.events[0].repeats, "every week");
  assert.equal(found.events[0].nextOn, "2026-08-05T09:00");

  // Nothing scheduled ahead reads as null rather than as a missing field.
  const past = createStore();
  const [calendar] = past.listCalendarsEnsuringDefault(1);
  past.createEvent(1, {
    calendarId: calendar.id,
    title: "Last year's review",
    startsAt: "2025-01-05T09:00",
    endsAt: "2025-01-05T10:00",
  });
  const stale = searchEvents(past, 1, { query: "review", allTime: true }, REFERENCE);
  assert.equal(stale.events[0].nextOn, null);
});

test("a search needs something to go on", () => {
  const { store } = seeded();
  assert.throws(() => searchEvents(store, 1, {}, REFERENCE), /search term, a date range, or allTime/);
});

test("a wildcard typed by the user stays a literal", () => {
  const store = createStore();
  const [calendar] = store.listCalendarsEnsuringDefault(1);
  store.createEvent(1, {
    calendarId: calendar.id,
    title: "Budget 100% done",
    startsAt: "2026-08-05T09:00",
    endsAt: "2026-08-05T10:00",
  });
  store.createEvent(1, {
    calendarId: calendar.id,
    title: "Unrelated",
    startsAt: "2026-08-05T11:00",
    endsAt: "2026-08-05T12:00",
  });
  // Unescaped, "%" is the LIKE wildcard and would return both rows. Escaped, it
  // means the character the user typed, so it finds the one title containing it.
  const wildcard = store.searchEvents(1, { query: "%" });
  assert.deepEqual(wildcard.map((event) => event.title), ["Budget 100% done"]);
  assert.equal(store.searchEvents(1, { query: "100%" }).length, 1);
  assert.equal(store.searchEvents(1, { query: "_" }).length, 0, "_ is a wildcard too");
});

test("one event carries the parts a list entry cannot", () => {
  const { store } = seeded();
  const standupId = searchEvents(store, 1, { query: "standup", allTime: true }, REFERENCE)
    .events[0].eventId;

  const detail = getEvent(store, 1, { eventId: standupId, upcoming: 3 }, REFERENCE);
  assert.equal(detail.event.title, "Standup");
  assert.equal(detail.event.repeats, "every week");
  assert.deepEqual(detail.event.recurrence, {
    frequency: "weekly",
    interval: 1,
    until: null,
    count: null,
  });
  assert.deepEqual(detail.event.attendees, [
    { email: "ana@example.com", name: "Ana Ruiz", role: "required", status: "needs-action" },
  ]);
  assert.deepEqual(detail.upcoming, [
    "2026-08-05T09:00",
    "2026-08-12T09:00",
    "2026-08-19T09:00",
  ]);
  assert.ok(detail.event.uid, "the iCalendar identity travels with the event");

  // Scoping again: the id exists, but not for this user.
  assert.throws(() => getEvent(store, 2, { eventId: standupId }, REFERENCE), /does not exist/);
  assert.throws(() => getEvent(store, 1, {}, REFERENCE), /eventId is required/);
});

test("a deleted occurrence is not reported as if it were still on the calendar", () => {
  const { store } = seeded();
  const standupId = searchEvents(store, 1, { query: "standup", allTime: true }, REFERENCE)
    .events[0].eventId;
  store.deleteEventScoped(1, {
    eventId: standupId,
    scope: "instance",
    recurrenceId: "2026-08-12T09:00",
  });

  const month = agenda(store, 1, { days: 28 }, REFERENCE);
  const starts = month.occurrences
    .filter((occurrence) => occurrence.title === "Standup")
    .map((occurrence) => occurrence.start);
  assert.deepEqual(starts, ["2026-08-05T09:00", "2026-08-19T09:00", "2026-08-26T09:00"]);

  const detail = getEvent(store, 1, { eventId: standupId }, REFERENCE);
  assert.deepEqual(detail.event.excludedDates, ["2026-08-12T09:00"]);
});

test("a subscribed calendar is reported as somebody else's", () => {
  const store = createStore();
  store.listCalendarsEnsuringDefault(1);
  store.createCalendar(1, {
    name: "Team holidays",
    sourceUrl: "https://example.com/holidays.ics",
    readOnly: true,
  });
  const { calendars } = listCalendars(store, 1);
  const subscribed = calendars.find((calendar) => calendar.name === "Team holidays");
  assert.equal(subscribed.subscribed, true);
  assert.equal(subscribed.sourceUrl, "https://example.com/holidays.ics");
  assert.equal(calendars.find((calendar) => calendar.name === "Personal").subscribed, false);
});

test("a repeat rule is described the way a person would say it", () => {
  const rule = (recurrence) => describeRecurrence({ recurrence });
  assert.equal(rule({ frequency: "none", interval: 1, until: null, count: null }), "does not repeat");
  assert.equal(rule({ frequency: "weekly", interval: 1, until: null, count: null }), "every week");
  assert.equal(rule({ frequency: "daily", interval: 3, until: null, count: null }), "every 3 days");
  assert.equal(
    rule({ frequency: "monthly", interval: 1, until: "2026-12-31", count: null }),
    "every month until 2026-12-31",
  );
  assert.equal(rule({ frequency: "yearly", interval: 1, until: null, count: 4 }), "every year, 4 times");
});

// ── world monitor behaviour ─────────────────────────────────────────────────

test("the catalog is the vocabulary the other tools filter by, and costs no network", () => {
  const catalog = monitorCatalog();
  const panelIds = catalog.panels.map((panel) => panel.id);
  assert.ok(panelIds.includes("middleeast") && panelIds.includes("finance"));
  assert.ok(catalog.panels.every((panel) => panel.feeds > 0 && panel.label));
  assert.deepEqual(
    catalog.levels.map((level) => level.id),
    ["critical", "high", "medium", "low", "info"],
  );
  assert.ok(catalog.categories.includes("conflict"));
  assert.ok(catalog.hubCount > 100, "the full hub table travels");

  const narrowed = monitorCatalog({ region: "Middle East" });
  assert.ok(narrowed.hubCount > 0 && narrowed.hubCount < catalog.hubCount);
  assert.ok(narrowed.hubs.every((group) => group.region === "Middle East"));
  assert.ok(
    narrowed.hubs[0].hubs.some((hub) => hub.id === "tehran"),
    "a region name resolves to the hubs behind it",
  );
  // A country works too, which is what a caller will usually have.
  assert.ok(
    monitorCatalog({ region: "Japan" }).hubs.some((group) =>
      group.hubs.some((hub) => hub.id === "tokyo"),
    ),
  );
});

test("a bad filter is refused by name, before a single feed is fetched", async () => {
  // Silence, not a wrong answer: a typo that quietly widened a query to the
  // whole world would come back as a confident fact about the wrong place.
  await assert.rejects(() => monitorSnapshot({ panels: ["midleeast"] }), (error) => {
    assert.ok(error instanceof WorldMonitorQueryError);
    assert.match(error.message, /Unknown panel\(s\): midleeast/);
    assert.match(error.message, /worldmonitor_catalog/);
    return true;
  });
  await assert.rejects(() => monitorSearch({ levels: ["urgent"] }), /Unknown level\(s\): urgent/);
  await assert.rejects(
    () => monitorSearch({ region: "Wakanda" }),
    /No hub matches "Wakanda"/,
  );
  await assert.rejects(
    () => monitorClimate({ include: ["weather"], hubs: ["atlantis"] }),
    /None of those hub ids exist: atlantis/,
  );
});

test("weather with nowhere to read is a note, not a silent empty list", async () => {
  // Reaches no network: with no hubs the weather fetch short-circuits, and
  // neither indicators nor hazards were asked for.
  const result = await monitorClimate({ include: ["weather"] });
  assert.deepEqual(result.weather, []);
  assert.ok(
    result.notes.some((note) => note.includes("No hubs named")),
    "an empty list must say whether it means 'nowhere asked' or 'source down'",
  );
});
