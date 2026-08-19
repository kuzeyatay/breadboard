// The wiring behind the two profile panels: the address book that fills itself
// from the calendar, and the calendars that sync both ways with a server.
//
// Each of these is a promise that is easy to break from a distance — a route
// renamed, a schema left unregistered, a capture call dropped from an event
// write — and cheap to pin down here.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const appRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "src", "app");

/** `/api/contacts`, `/api/calendar/caldav/${calendar.id}` — as written in the source. */
const API_PATH = /\/api\/[A-Za-z0-9/${}._-]+/g;

/**
 * The route file behind an address, or null. An interpolated segment (`${id}`)
 * matches whichever `[bracketed]` directory sits there, which is exactly the
 * substitution Next makes at runtime.
 */
function routeFileFor(address) {
  let directory = appRoot;
  for (const segment of address.split("/").filter(Boolean)) {
    const literal = path.join(directory, segment);
    if (!segment.includes("${") && fs.existsSync(literal)) {
      directory = literal;
      continue;
    }
    const dynamic = fs
      .readdirSync(directory)
      .find((entry) => entry.startsWith("[") && entry.endsWith("]"));
    if (!dynamic) return null;
    directory = path.join(directory, dynamic);
  }
  const route = path.join(directory, "route.ts");
  return fs.existsSync(route) ? route : null;
}

const db = source("../src/lib/db.ts");
const profilePage = source("../src/app/profile/page.tsx");
const profileClient = source("../src/app/profile/profile-client.tsx");
const contactsPanel = source("../src/app/profile/contacts-panel.tsx");
const syncPanel = source("../src/app/profile/calendar-sync-panel.tsx");
const credentials = source("../src/lib/calendar/caldav-credentials.ts");
const calendarStore = source("../src/lib/calendar/store.ts");
const calendarSchema = source("../src/lib/calendar/schema.ts");
const instrumentation = source("../src/instrumentation-node.ts");

const ROUTES = [
  "../src/app/api/contacts/route.ts",
  "../src/app/api/contacts/[contactId]/route.ts",
  "../src/app/api/calendar/caldav/route.ts",
  "../src/app/api/calendar/caldav/discover/route.ts",
  "../src/app/api/calendar/caldav/connect/route.ts",
  "../src/app/api/calendar/caldav/[calendarId]/route.ts",
];

test("every route the panels call exists, authenticates, and does not cache", () => {
  for (const route of ROUTES) {
    const handler = source(route);
    assert.match(handler, /requireUserId/, `${route} must authenticate`);
    assert.match(handler, /apiErrorResponse/, `${route} must return structured errors`);
    assert.match(handler, /export const dynamic = "force-dynamic"/, `${route} must not cache`);
  }
});

test("dynamic route segments are awaited, as Next 16 requires", () => {
  for (const route of [
    "../src/app/api/contacts/[contactId]/route.ts",
    "../src/app/api/calendar/caldav/[calendarId]/route.ts",
  ]) {
    const handler = source(route);
    assert.match(handler, /params: Promise</, `${route} must type params as a promise`);
    assert.match(handler, /\(await params\)/, `${route} must await params`);
  }
});

test("both schemas are applied with the rest of the app's tables", () => {
  assert.match(db, /import \{ ensureContactSchema \} from "\.\/contacts\/schema\.ts"/);
  assert.match(db, /^ensureContactSchema\(db\);$/m);
  // The CalDAV columns ride along with the calendar's own schema, which db.ts
  // already applies, so there is no second registration to forget.
  assert.match(calendarSchema, /calendar_caldav_credentials/);
  assert.match(calendarSchema, /calendar_remote_tombstones/);
});

test("the profile page renders both panels from server-read data", () => {
  assert.match(profilePage, /getContactStore\(\)/, "contacts are read on the server");
  assert.match(profilePage, /caldavVaultConfigured\(\)/, "the vault state is read there too");
  assert.match(profilePage, /contactTotal=\{/);
  assert.match(profilePage, /syncedCalendars=\{/);

  assert.match(profileClient, /<ContactsPanel initial=\{contacts\}/);
  assert.match(profileClient, /<CalendarSyncPanel/);
  assert.match(profileClient, /initial=\{syncedCalendars\}/);
});

test("writing an event files the people on it", () => {
  for (const route of [
    "../src/app/api/calendar/events/route.ts",
    "../src/app/api/calendar/events/[eventId]/route.ts",
  ]) {
    assert.match(
      source(route),
      /rememberEventPeople\(userId, event\)/,
      `${route} must file the event's attendees`,
    );
  }
});

test("every address the panels call resolves to a route on disk", () => {
  // Taken from the source rather than listed here, so a panel that starts
  // calling somewhere new cannot quietly call somewhere that does not exist.
  const called = new Set(
    [...contactsPanel.matchAll(API_PATH), ...syncPanel.matchAll(API_PATH)].map((match) =>
      match[0].split("?")[0],
    ),
  );

  assert.ok(called.size >= 5, `expected the panels to call the API, saw ${called.size}`);
  for (const address of called) {
    assert.ok(routeFileFor(address), `${address} has no route file`);
  }
});

test("the password never leaves the server", () => {
  assert.match(credentials, /^import "server-only";/m, "the vault is server-only");
  assert.match(credentials, /aes-256-gcm/, "it is sealed, not stored in the clear");
  assert.doesNotMatch(
    calendarStore,
    /password/i,
    "the calendar store never touches credentials, so no read of it can leak one",
  );
  assert.doesNotMatch(
    syncPanel,
    /localStorage|sessionStorage/,
    "the panel does not keep the password anywhere either",
  );
});

test("syncing runs on its own, from the process that is always up", () => {
  assert.match(
    instrumentation,
    /import \{ startCaldavScheduler \} from "\.\/lib\/calendar\/caldav-scheduler\.ts"/,
  );
  assert.match(instrumentation, /^startCaldavScheduler\(\);$/m);
});

test("a subscribed calendar and a synced one stay different things", () => {
  // `sourceUrl` is a read-only ICS mirror; `caldavUrl` is a two-way binding.
  // Collapsing them would make a subscription writable, and every write to it
  // would be silently undone by the next refresh.
  assert.match(calendarStore, /caldav_url/);
  assert.match(
    calendarStore,
    /is a subscribed copy, so it cannot also sync both ways/,
    "binding refuses a subscription",
  );
});
