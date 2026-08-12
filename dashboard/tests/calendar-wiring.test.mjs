// The calendar's wiring into the app, now that it is a view of /plan rather
// than a page of its own: the navbar entry point, the authenticated route, the
// forwarding address left at the old URL, the schema registration, and the API
// surface the client calls.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const navbar = source("../src/app/components/navbar.tsx");
const proxy = source("../src/proxy.ts");
const page = source("../src/app/plan/page.tsx");
const planClient = source("../src/app/plan/plan-client.tsx");
const redirectStub = source("../src/app/calendar/page.tsx");
const client = source("../src/app/plan/calendar/calendar-client.tsx");
const views = source("../src/app/plan/calendar/calendar-views.tsx");
const db = source("../src/lib/db.ts");

test("the navbar opens Plan in a new tab, and no longer offers Calendar", () => {
  assert.match(navbar, /href="\/plan"/, "there is a Plan link");
  assert.match(navbar, />\s*Plan\s*</, "it is labelled Plan");
  assert.doesNotMatch(
    navbar,
    /href="\/calendar"/,
    "the calendar is inside Plan, so it has no separate entry",
  );

  const planIndex = navbar.indexOf('href="/plan"');
  // Inviting used to sit here; it now lives behind the profile chip, which is
  // still the last thing in the row.
  const profileIndex = navbar.indexOf('href="/profile"');
  assert.ok(planIndex > 0 && planIndex < profileIndex, "it precedes the profile chip");

  // Same new-tab treatment as Paint Pomodoro, including the opener hardening.
  const link = navbar.slice(planIndex, navbar.indexOf("</a>", planIndex));
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.match(link, /<svg/, "it carries an inline icon rather than an image");
  assert.match(link, /<rect /, "the icon is the minimal board frame");
});

test("Plan is behind auth, unlike the session-free pomodoro page", () => {
  assert.match(proxy, /'\/plan\/:path\*'/);
  assert.doesNotMatch(proxy, /'\/pomodoro/);
  assert.match(page, /getServerSession/);
  assert.match(page, /redirect\("\/auth\/login\?callbackUrl=\/plan"\)/);
});

test("the old /calendar URL forwards into Plan instead of 404ing", () => {
  assert.match(redirectStub, /redirect\(/, "the stub redirects");
  assert.match(redirectStub, /view: "calendar"/, "it lands on the calendar view");
  assert.match(
    redirectStub,
    /forwarded\.set\("calendarView"/,
    "an old ?view= is carried over as the calendar's own sub-view",
  );
  assert.match(redirectStub, /forwarded\.set\("date"/, "and the week it was showing");
  assert.match(proxy, /'\/calendar\/:path\*'/, "the old URL stays behind auth");
});

test("the page hands the client a server-rendered clock and a parsed view", () => {
  // Deriving "today" or the view in the client's first render would disagree
  // with the server's markup and blow up hydration.
  assert.match(page, /initialToday=\{today\}/);
  assert.match(page, /isCalendarView\(rawCalendarView\)/);
  assert.match(page, /parseDate\(rawDate\)/, "a hand-edited ?date= cannot poison the grid");
});

test("the calendar renders embedded, inside Plan's own shell", () => {
  assert.match(planClient, /<CalendarClient\s+embedded/, "Plan mounts it embedded");
  assert.match(
    client,
    /embedded \? "flex-1" : "bb-calendar-shell"/,
    "embedded drops the 100vh shell so Plan owns the height",
  );
});

test("the client talks to the calendar API and nothing else", () => {
  const endpoints = [...client.matchAll(/fetch\(\s*[`"']([^`"']+)/g)].map((match) => match[1]);
  assert.ok(endpoints.length > 0);
  for (const endpoint of endpoints) {
    assert.match(endpoint, /^\/api\/calendar\//, `unexpected endpoint: ${endpoint}`);
  }

  assert.match(client, /method: "DELETE"/);
  assert.match(client, /isNew \? "POST" : "PATCH"/);
  assert.match(client, /requestId/, "stale range responses are discarded");
});

test("every route the client calls exists on disk", () => {
  const routes = [
    "../src/app/api/calendar/calendars/route.ts",
    "../src/app/api/calendar/calendars/[calendarId]/route.ts",
    "../src/app/api/calendar/events/route.ts",
    "../src/app/api/calendar/events/[eventId]/route.ts",
  ];

  for (const route of routes) {
    const handler = source(route);
    assert.match(handler, /requireUserId/, `${route} must authenticate`);
    assert.match(handler, /apiErrorResponse/, `${route} must return structured errors`);
    assert.match(handler, /export const dynamic = "force-dynamic"/, `${route} must not cache`);
  }
});

test("dynamic route segments are awaited, as Next 16 requires", () => {
  for (const route of [
    "../src/app/api/calendar/calendars/[calendarId]/route.ts",
    "../src/app/api/calendar/events/[eventId]/route.ts",
  ]) {
    const handler = source(route);
    assert.match(handler, /params: Promise</, `${route} must type params as a promise`);
    assert.match(handler, /\(await params\)/, `${route} must await params`);
  }
});

test("the calendar schema is applied with the rest of the app's tables", () => {
  assert.match(db, /import \{ ensureCalendarSchema \} from "\.\/calendar\/schema\.ts"/);
  assert.match(db, /^ensureCalendarSchema\(db\);$/m);
});

test("the grid draws its now-line only once the browser supplies a clock", () => {
  assert.match(views, /props\.now &&/, "no server-rendered now-line");
  assert.doesNotMatch(views, /nowStamp\(/, "the views never read the clock themselves");
});
