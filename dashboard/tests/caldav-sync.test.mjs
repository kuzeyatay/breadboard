// Two-way CalDAV sync, run against a scripted server.
//
// The fake server below is deliberately strict about the things that make the
// protocol safe: it enforces If-Match and If-None-Match, it moves an object's
// etag on every write, and it moves the collection's ctag whenever anything
// inside it changes. A sync that passes here is a sync that cannot silently
// overwrite someone else's edit.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { CalendarStore } from "../src/lib/calendar/store.ts";
import { syncCaldavCalendar } from "../src/lib/calendar/caldav-sync.ts";
import { discoverCalendars } from "../src/lib/calendar/caldav-client.ts";
import { parseMultistatus, parseXml, textOf } from "../src/lib/calendar/caldav-xml.ts";

const BASE = "https://dav.example/";
const COLLECTION = "https://dav.example/calendars/user/work/";
const ACCOUNT = { url: BASE, username: "sarah", password: "app-password" };

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com');
  `);
  return new CalendarStore(db);
}

function ics(uid, summary, start = "20260901T090000", end = "20260901T093000") {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTAMP:20260801T000000Z",
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** A CalDAV server with one calendar collection, in about a hundred lines. */
function createServer(seed = {}) {
  const objects = new Map(
    Object.entries(seed).map(([href, body], index) => [
      href,
      { ics: body, etag: `"seed-${index}"` },
    ]),
  );
  const server = {
    objects,
    ctag: '"ctag-0"',
    requests: [],
    version: 0,
    /** Set to a status code to make the next PUT fail with it. */
    refuseNextPut: null,
  };

  const bump = () => {
    server.version += 1;
    server.ctag = `"ctag-${server.version}"`;
  };

  const xml = (body, status = 207) =>
    new Response(`<?xml version="1.0"?>${body}`, {
      status,
      headers: { "Content-Type": "application/xml" },
    });

  const multistatus = (responses) =>
    xml(
      `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${responses.join("")}</d:multistatus>`,
    );

  const propstat = (href, props) =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

  server.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ?? "";
    const depth = init.headers?.Depth ?? null;
    const path = new URL(url).pathname;
    server.requests.push({ method, url, depth, body });

    if (!init.headers?.Authorization?.startsWith("Basic ")) {
      return new Response("no", { status: 401 });
    }

    if (method === "PROPFIND") {
      if (/current-user-principal/.test(body)) {
        return multistatus([
          propstat(path, "<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>"),
        ]);
      }
      if (/calendar-home-set/.test(body)) {
        return multistatus([
          propstat(path, "<c:calendar-home-set><d:href>/calendars/user/</d:href></c:calendar-home-set>"),
        ]);
      }
      if (/getctag/.test(body) && depth === "0") {
        return multistatus([propstat(path, `<cs:getctag>${server.ctag}</cs:getctag>`)]);
      }
      if (/resourcetype/.test(body) && /displayname/.test(body)) {
        return multistatus([
          propstat(
            "/calendars/user/",
            "<d:resourcetype><d:collection/></d:resourcetype><d:displayname>home</d:displayname>",
          ),
          propstat(
            "/calendars/user/work/",
            "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>" +
              "<d:displayname>Work</d:displayname>" +
              `<cs:getctag>${server.ctag}</cs:getctag>` +
              "<c:supported-calendar-component-set><c:comp name=\"VEVENT\"/></c:supported-calendar-component-set>",
          ),
          propstat(
            "/calendars/user/contacts/",
            "<d:resourcetype><d:collection/></d:resourcetype><d:displayname>Contacts</d:displayname>",
          ),
        ]);
      }
      if (/getetag/.test(body) && depth === "1") {
        return multistatus([
          propstat(path, "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>"),
          ...[...objects.entries()].map(([href, object]) =>
            propstat(href, `<d:getetag>${object.etag}</d:getetag><d:resourcetype/>`),
          ),
        ]);
      }
      return new Response("", { status: 404 });
    }

    if (method === "REPORT") {
      const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((match) => match[1]);
      return multistatus(
        hrefs
          .map((href) => {
            const object = objects.get(new URL(href, BASE).pathname);
            if (!object) return null;
            return propstat(
              new URL(href, BASE).pathname,
              `<d:getetag>${object.etag}</d:getetag><c:calendar-data>${object.ics
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")}</c:calendar-data>`,
            );
          })
          .filter(Boolean),
      );
    }

    if (method === "PUT") {
      if (server.refuseNextPut) {
        const status = server.refuseNextPut;
        server.refuseNextPut = null;
        return new Response("", { status });
      }
      const existing = objects.get(path);
      const ifMatch = init.headers?.["If-Match"];
      const ifNoneMatch = init.headers?.["If-None-Match"];
      if (ifNoneMatch === "*" && existing) return new Response("", { status: 412 });
      if (ifMatch && (!existing || existing.etag !== ifMatch)) {
        return new Response("", { status: 412 });
      }
      bump();
      const etag = `"v${server.version}"`;
      objects.set(path, { ics: body, etag });
      return new Response(existing ? null : "", {
        status: existing ? 204 : 201,
        headers: { ETag: etag },
      });
    }

    if (method === "DELETE") {
      const existing = objects.get(path);
      if (!existing) return new Response("", { status: 404 });
      const ifMatch = init.headers?.["If-Match"];
      if (ifMatch && existing.etag !== ifMatch) return new Response("", { status: 412 });
      objects.delete(path);
      bump();
      return new Response(null, { status: 204 });
    }

    if (method === "GET") {
      const object = objects.get(path);
      if (!object) return new Response("", { status: 404 });
      return new Response(object.ics, { status: 200, headers: { ETag: object.etag } });
    }

    return new Response("", { status: 405 });
  };

  return server;
}

function bind(store, server, { calendarName = "Work" } = {}) {
  const calendar = store.createCalendar(1, { name: calendarName });
  store.bindCaldav(1, calendar.id, { url: COLLECTION, username: "sarah", ctag: null });
  return calendar;
}

const sync = (store, server, calendarId) =>
  syncCaldavCalendar(store, 1, calendarId, ACCOUNT, { fetchImpl: server.fetch });

// ---------------------------------------------------------------- discovery

test("discovery walks principal → home → calendars and keeps only calendars", async () => {
  const server = createServer();
  const calendars = await discoverCalendars(ACCOUNT, { fetchImpl: server.fetch });

  assert.deepEqual(
    calendars.map((calendar) => calendar.name),
    ["Work"],
  );
  assert.equal(calendars[0].href, COLLECTION);
  assert.equal(calendars[0].readOnly, false);
});

// --------------------------------------------------------------------- pull

test("the first sync brings the server's events down", async () => {
  const server = createServer({
    "/calendars/user/work/a.ics": ics("uid-a", "Standup"),
    "/calendars/user/work/b.ics": ics("uid-b", "Retro", "20260902T140000", "20260902T150000"),
  });
  const store = createStore();
  const calendar = bind(store, server);

  const result = await sync(store, server, calendar.id);

  assert.equal(result.pulled.created, 2);
  assert.deepEqual(
    store.listEvents(1).map((event) => event.title).sort(),
    ["Retro", "Standup"],
  );
});

test("a pulled event is settled, not queued straight back for upload", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Standup") });
  const store = createStore();
  const calendar = bind(store, server);

  await sync(store, server, calendar.id);
  assert.deepEqual(store.pendingPushes(1, calendar.id), []);

  const second = await sync(store, server, calendar.id);
  assert.equal(second.pushed.uploaded, 0);
  assert.equal(second.pulled.created, 0);
});

test("an event deleted on the server disappears here", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Standup") });
  const store = createStore();
  const calendar = bind(store, server);
  await sync(store, server, calendar.id);

  server.objects.delete("/calendars/user/work/a.ics");
  server.ctag = '"ctag-later"';

  const result = await sync(store, server, calendar.id);
  assert.equal(result.pulled.removed, 1);
  assert.equal(store.listEvents(1).length, 0);
});

test("an event changed on the server is updated here, not duplicated", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Standup") });
  const store = createStore();
  const calendar = bind(store, server);
  await sync(store, server, calendar.id);

  server.objects.set("/calendars/user/work/a.ics", {
    ics: ics("uid-a", "Standup (moved)", "20260901T100000", "20260901T103000"),
    etag: '"changed"',
  });
  server.ctag = '"ctag-later"';

  const result = await sync(store, server, calendar.id);
  assert.equal(result.pulled.updated, 1);

  const events = store.listEvents(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Standup (moved)");
  assert.equal(events[0].startsAt, "2026-09-01T10:00");
});

test("an unchanged collection tag skips the listing entirely", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Standup") });
  const store = createStore();
  const calendar = bind(store, server);
  await sync(store, server, calendar.id);

  server.requests.length = 0;
  const result = await sync(store, server, calendar.id);

  assert.equal(result.unchanged, true);
  assert.equal(
    server.requests.filter((request) => request.depth === "1").length,
    0,
    "nothing was listed",
  );
});

// --------------------------------------------------------------------- push

test("an event created here is written to the server", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);

  store.createEvent(1, {
    calendarId: calendar.id,
    title: "New meeting",
    startsAt: "2026-09-03T11:00",
    endsAt: "2026-09-03T12:00",
  });

  const result = await sync(store, server, calendar.id);

  assert.equal(result.pushed.uploaded, 1);
  assert.equal(server.objects.size, 1);
  assert.match([...server.objects.values()][0].ics, /SUMMARY:New meeting/);

  // And it is settled afterwards: a second sync has nothing left to send.
  const second = await sync(store, server, calendar.id);
  assert.equal(second.pushed.uploaded, 0);
});

test("an edit here is written with If-Match and moves the stored version", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);

  const event = store.createEvent(1, {
    calendarId: calendar.id,
    title: "Before",
    startsAt: "2026-09-03T11:00",
    endsAt: "2026-09-03T12:00",
  });
  await sync(store, server, calendar.id);

  store.updateEvent(1, event.id, { title: "After" });
  server.requests.length = 0;
  const result = await sync(store, server, calendar.id);

  assert.equal(result.pushed.uploaded, 1);
  const put = server.requests.find((request) => request.method === "PUT");
  assert.ok(put, "an update was sent");
  assert.match([...server.objects.values()][0].ics, /SUMMARY:After/);
});

test("an event deleted here is deleted there, once", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);

  const event = store.createEvent(1, {
    calendarId: calendar.id,
    title: "Doomed",
    startsAt: "2026-09-03T11:00",
    endsAt: "2026-09-03T12:00",
  });
  await sync(store, server, calendar.id);
  assert.equal(server.objects.size, 1);

  store.deleteEvent(1, event.id);
  const result = await sync(store, server, calendar.id);

  assert.equal(result.pushed.deleted, 1);
  assert.equal(server.objects.size, 0);
  assert.deepEqual(store.pendingTombstones(1, calendar.id), []);

  // Nothing is left owing: a further sync sends no second DELETE.
  server.requests.length = 0;
  await sync(store, server, calendar.id);
  assert.equal(server.requests.filter((request) => request.method === "DELETE").length, 0);
});

test("a recurring series and its per-instance edit travel as one object", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);

  const series = store.createEvent(1, {
    calendarId: calendar.id,
    title: "Weekly",
    startsAt: "2026-09-07T09:00",
    endsAt: "2026-09-07T09:30",
    recurrence: { frequency: "weekly", interval: 1 },
  });
  store.updateEventScoped(1, {
    eventId: series.id,
    scope: "instance",
    recurrenceId: "2026-09-14T09:00",
    patch: { title: "Weekly (special)" },
  });

  await sync(store, server, calendar.id);

  assert.equal(server.objects.size, 1, "one resource, not two");
  const body = [...server.objects.values()][0].ics;
  assert.match(body, /RRULE:FREQ=WEEKLY/);
  assert.match(body, /RECURRENCE-ID:20260914T090000/);
});

// ---------------------------------------------------------------- conflicts

test("a refused write loses to the server, and says so", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Theirs") });
  const store = createStore();
  const calendar = bind(store, server);
  await sync(store, server, calendar.id);

  const [event] = store.listEvents(1);
  store.updateEvent(1, event.id, { title: "Mine" });

  // The server has moved on since we read it.
  server.objects.set("/calendars/user/work/a.ics", {
    ics: ics("uid-a", "Theirs, updated"),
    etag: '"newer"',
  });
  server.refuseNextPut = 412;

  const result = await sync(store, server, calendar.id);

  assert.equal(result.conflicts, 1);
  assert.match(result.warnings.join(" "), /server's version was kept/);
  assert.deepEqual(
    store.listEvents(1).map((candidate) => candidate.title),
    ["Theirs, updated"],
  );
  assert.deepEqual(store.pendingPushes(1, calendar.id), [], "the losing edit is not retried");
});

// ------------------------------------------------------------------ binding

test("binding an existing calendar uploads what is already in it", async () => {
  const server = createServer();
  const store = createStore();

  const calendar = store.createCalendar(1, { name: "Local" });
  store.createEvent(1, {
    calendarId: calendar.id,
    title: "Kept locally until now",
    startsAt: "2026-09-03T11:00",
    endsAt: "2026-09-03T12:00",
  });
  store.bindCaldav(1, calendar.id, { url: COLLECTION, username: "sarah", ctag: null });

  const result = await sync(store, server, calendar.id);
  assert.equal(result.pushed.uploaded, 1);
  assert.equal(server.objects.size, 1);
});

test("unbinding keeps the events and stops reaching the server", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Standup") });
  const store = createStore();
  const calendar = bind(store, server);
  await sync(store, server, calendar.id);

  store.unbindCaldav(1, calendar.id);
  assert.equal(store.getCaldavBinding(1, calendar.id), null);
  assert.equal(store.listEvents(1).length, 1);

  const [event] = store.listEvents(1);
  store.deleteEvent(1, event.id);
  assert.deepEqual(
    store.pendingTombstones(1, calendar.id),
    [],
    "a local delete after unbinding stays local",
  );
});

test("deleting a synced calendar does not queue deletions against the server", async () => {
  const server = createServer({ "/calendars/user/work/a.ics": ics("uid-a", "Standup") });
  const store = createStore();
  store.createCalendar(1, { name: "Keeper" });
  const calendar = bind(store, server);
  await sync(store, server, calendar.id);

  store.deleteCalendar(1, calendar.id);
  assert.deepEqual(store.pendingTombstones(1, calendar.id), []);
});

test("sync records the reason when the server fails, and re-throws", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);
  const failing = async () => new Response("", { status: 500 });

  await assert.rejects(
    syncCaldavCalendar(store, 1, calendar.id, ACCOUNT, { fetchImpl: failing }),
  );
  assert.ok(store.getCalendar(1, calendar.id).syncError, "the failure is on the calendar");
});

// ------------------------------------------------------------------- XML

test("the multistatus reader ignores namespaces and 404 properties", () => {
  const responses = parseMultistatus(`
    <?xml version="1.0"?>
    <multistatus xmlns="DAV:">
      <response>
        <href>/calendars/user/work/a.ics</href>
        <propstat>
          <prop><getetag>"abc"</getetag></prop>
          <status>HTTP/1.1 200 OK</status>
        </propstat>
        <propstat>
          <prop><calendar-color/></prop>
          <status>HTTP/1.1 404 Not Found</status>
        </propstat>
      </response>
    </multistatus>
  `);

  assert.equal(responses.length, 1);
  assert.equal(responses[0].href, "/calendars/user/work/a.ics");
  assert.equal(textOf(responses[0].props.get("getetag")), '"abc"');
  assert.equal(responses[0].props.has("calendar-color"), false);
});

test("the XML reader survives CDATA, entities and self-closing tags", () => {
  const root = parseXml(
    '<a:root xmlns:a="urn:x"><a:one/><a:two>five &lt; six</a:two>' +
      "<a:three><![CDATA[BEGIN:VCALENDAR]]></a:three></a:root>",
  );

  assert.equal(root.name, "root");
  assert.deepEqual(root.children.map((node) => node.name), ["one", "two", "three"]);
  assert.equal(textOf(root.children[1]), "five < six");
  assert.equal(textOf(root.children[2]), "BEGIN:VCALENDAR");
});

// ------------------------------------------------------------------- leasing

test("a calendar already being synced refuses a second sync, blamelessly", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);

  const now = new Date();
  store.claimCaldavSync(
    calendar.id,
    new Date(now.getTime() + 60_000).toISOString(),
    now.toISOString(),
  );

  await assert.rejects(sync(store, server, calendar.id), (error) => error.status === 409);
  assert.equal(
    store.getCalendar(1, calendar.id).syncError,
    null,
    "being busy is not a failure, and must not start a backoff",
  );
});

test("the lease is handed back whether the sync worked or not", async () => {
  const server = createServer();
  const store = createStore();
  const calendar = bind(store, server);

  await sync(store, server, calendar.id);
  const afterSuccess = new Date().toISOString();
  assert.equal(store.claimCaldavSync(calendar.id, afterSuccess, afterSuccess), true);
  store.releaseCaldavSync(calendar.id);

  const failing = async () => new Response("", { status: 500 });
  await assert.rejects(
    syncCaldavCalendar(store, 1, calendar.id, ACCOUNT, { fetchImpl: failing }),
  );
  const afterFailure = new Date().toISOString();
  assert.equal(
    store.claimCaldavSync(calendar.id, afterFailure, afterFailure),
    true,
    "a failed sync does not strand the lease",
  );
});
