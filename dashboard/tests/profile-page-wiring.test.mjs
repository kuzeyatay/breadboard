// The profile page's wiring: the navbar chip that reaches it, the auth gate on
// the route, and the two account actions that used to live in the navbar.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const navbar = read("src/app/components/navbar.tsx");
const flowerWind = read("src/app/components/navbar-flower-wind.tsx");
const workTimer = read("src/app/components/work-timer-shortcut.tsx");
const page = read("src/app/profile/page.tsx");
const client = read("src/app/profile/profile-client.tsx");
const rootLayout = read("src/app/layout.tsx");
const locationAutoRefresh = read("src/app/components/current-location-autorefresh.tsx");
const navHistory = read("src/lib/nav-history.ts");
const invitesRoute = read("src/app/api/invites/route.ts");
const shortcutsRoute = read("src/app/api/profile/navbar-shortcuts/route.ts");
const locationSource = read("src/lib/current-location-source.ts");
const deviceLocationRoute = read("src/app/api/profile/device-location/route.ts");
const locationLabelRoute = read("src/app/api/profile/location-label/route.ts");
const dashboardPage = read("src/app/dashboard/page.tsx");
const dashboardShell = read("src/app/dashboard/dashboard-page-shell.tsx");
const dashboardClient = read("src/app/dashboard/dashboard-client.tsx");

test("the profile chip is the way in, and it is a link rather than a label", () => {
  assert.match(navbar, /href="\/profile"/);
  assert.match(navbar, /\{username \|\| email\}/, "it still shows who you are");
  assert.match(navbar, /<Link[\s\S]*?href="\/profile"/, "so it can be opened");
});

test("the navbar no longer carries the account actions", () => {
  assert.doesNotMatch(navbar, /signOut/, "signing out moved to the profile page");
  assert.doesNotMatch(navbar, /\/api\/invites/, "so did inviting");
  assert.doesNotMatch(navbar, /useState/, "which leaves the navbar stateless");
});

test("the page is behind auth and comes back to itself after signing in", () => {
  assert.match(page, /getServerSession\(authOptions\)/);
  assert.match(page, /redirect\("\/auth\/login\?callbackUrl=\/profile"\)/);
  assert.match(page, /readProfileStats\(db, userId\)/, "stats are read for the session's user");
  assert.doesNotMatch(client, /from "@\/lib\/db"/, "and never from the browser");
});

test("the page offers a back link, restarting, signing out, and inviting", () => {
  assert.match(client, /<BackLink[\s\S]*?fallbackHref="\/dashboard"/);
  assert.match(client, /function RestartBreadboardButton\(\)/);
  assert.match(client, /breadboardRestartControl\(\)/);
  assert.match(client, />\{busy \? "Restarting…" : "Restart Breadboard"\}<\/span>/);
  assert.match(client, /signOut\(\{ callbackUrl: "\/auth\/login" \}\)/);
  assert.ok(
    client.indexOf("<RestartBreadboardButton />") <
      client.indexOf('onClick={() => signOut({ callbackUrl: "/auth/login" })}'),
    "restart sits to the left of sign out",
  );
  assert.match(client, /fetch\("\/api\/invites", \{ method: "POST" \}\)/);
  assert.match(client, /fetch\("\/api\/invites"\)/, "and lists the codes already handed out");
  assert.match(navHistory, /\\\/profile\(\?:\\\/\|\$\)/, "and names itself as a back target");
});

test("both invite calls the page makes exist on the route", () => {
  assert.match(invitesRoute, /export async function GET/);
  assert.match(invitesRoute, /export async function POST/);
  assert.match(invitesRoute, /requireUserId/, "scoped to the caller");
});

test("the optional navbar entries obey their settings", () => {
  // The work timer seat is a component that opens in place rather than a link;
  // the /pomodoro link now lives inside the panel it opens.
  assert.ok(
    navbar.includes("{shortcuts.workTimer && <WorkTimerShortcut />}"),
    "the work timer sits behind its guard",
  );
  assert.equal(
    navbar.indexOf("<WorkTimerShortcut"),
    navbar.lastIndexOf("<WorkTimerShortcut"),
    "and only once",
  );
  assert.doesNotMatch(navbar, /href="\/pomodoro"/, "the navbar itself no longer links out");
  assert.match(workTimer, /href="\/pomodoro"/, "the panel still reaches the full page");

  // The world monitor seat was withdrawn: the page is still there, but the
  // navbar no longer carries it and the profile no longer offers the switch.
  assert.doesNotMatch(navbar, /worldMonitor/, "the withdrawn seat left the navbar");
  assert.doesNotMatch(navbar, /href="\/worldmonitor"/, "link and all");

  const planGuardIndex = navbar.indexOf("{shortcuts.plan && (");
  const planLinkIndex = navbar.indexOf('href="/plan"');
  assert.ok(planGuardIndex > 0, "Plan is configurable too");
  assert.ok(planLinkIndex > planGuardIndex, "and its link sits inside the guard");

  const clickyGuardIndex = navbar.indexOf("{shortcuts.clicky && <ClickyShortcut />}");
  assert.ok(clickyGuardIndex > 0, "Clicky is configurable from the same profile panel");
  assert.ok(clickyGuardIndex < planGuardIndex, "and sits beside Plan in the navbar");

  assert.match(
    navbar,
    /shortcuts = DEFAULT_NAVBAR_SHORTCUTS/,
    "missing settings fall back to the defaults",
  );

  // Read on the server, so the navbar is right on first paint.
  assert.match(dashboardPage, /<DashboardPageShell/);
  assert.match(dashboardShell, /getNavbarShortcuts\(userId\)/);
  assert.match(dashboardClient, /shortcuts=\{navbarShortcuts\}/);
});

test("a seat with no page of its own still gets a row", () => {
  // Fast-read is a control, not a destination: the row names it in plain text
  // rather than linking somewhere that does not exist.
  assert.match(client, /shortcut\.href \? \(/);
  assert.match(client, /<span className="text-sm font-medium text-white">\{shortcut\.label\}<\/span>/);
});

test("the profile page owns the switches and reaches its own route", () => {
  assert.match(client, /NAVBAR_SHORTCUTS\.map/, "one catalog drives both sides");
  assert.match(client, /role="switch"/);
  assert.match(client, /fetch\("\/api\/profile\/navbar-shortcuts", \{/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /router\.refresh\(\)/, "so the dashboard is re-rendered, not cached");
  assert.match(shortcutsRoute, /export async function GET/);
  assert.match(shortcutsRoute, /export async function PATCH/);
  assert.match(shortcutsRoute, /requireUserId/, "scoped to the caller");
});

test("the profile launches the native Clicky companion and explains prompt launch", () => {
  assert.match(client, /function ClickyPanel\(\)/);
  assert.match(client, /clickyDesktopControl\(\)/);
  assert.match(client, /"Launch Clicky"/);
  assert.match(client, /"Open in Xcode"/);
  assert.match(client, /launch Clicky/);
  assert.match(client, /<ClickyPanel \/>/);
});

test("the profile can hide navbar flowers without removing the grass animation", () => {
  assert.match(page, /initialNavbarFlowers=\{getNavbarFlowers\(userId\)\}/);
  assert.match(client, /label="Show flowers in the top navbar"/);
  assert.match(client, /body: JSON\.stringify\(\{ flowers: optimistic \}\)/);
  assert.match(client, /<NavbarFlowerWind showFlowers=\{showNavbarFlowers\} \/>/);
  assert.match(navbar, /<NavbarFlowerWind showFlowers=\{showFlowers\} \/>/);
  assert.match(flowerWind, /showFlower=\{showFlowers\}/);
  assert.match(flowerWind, /\{showFlower && \(/);
  assert.match(flowerWind, /<div className=\{styles\.grassBed\} \/>/);
  assert.match(flowerWind, /\{INITIAL_PLANTS\.map\(/);
  assert.match(shortcutsRoute, /updateNavbarFlowers/);
});

test("the profile exposes current-location availability without folding it into theme consent", () => {
  assert.match(client, /function LocationPanel\(\)/);
  assert.match(client, /title="Location"/);
  for (const state of [
    "Off",
    "Checking",
    "Available",
    "Stale",
    "Blocked",
    "Location unavailable",
  ]) {
    assert.ok(client.includes(state), `the Location card can show ${state}`);
  }
  assert.match(client, /role="status"/);
  assert.match(client, /aria-live="polite"/);
  assert.match(client, /aria-busy=\{checking\}/);
  assert.match(client, /checked=\{preference\.useForAnswers\}/);
  assert.match(client, /onChange=\{\(\) => void toggleLocation\(\)\}/);
  assert.doesNotMatch(client, />\s*Turn off\s*<\/button>/);
  assert.match(client, /aria-label="Refresh location"/);
  assert.match(client, /<RefreshCw/);
  assert.match(
    client,
    /aria-label="Refresh location"[\s\S]*?className="inline-flex h-5 w-5 items-center justify-center text-gray-500/,
    "refresh is an unframed icon control beside the status",
  );
  assert.match(client, /requestCurrentLocationFix\(/);
  assert.match(client, /preference\.snapshot\?\.label \?\? "Available"/);
  assert.match(client, /resolveCurrentLocationLabel\(baseSnapshot, preference\.snapshot\)/);
  assert.match(
    client,
    /if \(!preference\.useForAnswers \|\| !snapshot \|\| snapshot\.label\) return;/,
    "an existing enabled snapshot is named once without waiting for the next refresh",
  );
  assert.match(locationLabelRoute, /requireUserId/);
  assert.match(locationLabelRoute, /readJsonBody\(request, 2 \* 1024\)/);
  assert.match(locationLabelRoute, /mapReverse/);
  assert.match(locationLabelRoute, /currentLocationLabel/);
  assert.match(locationSource, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(locationSource, /allowThemeLocation/);
  assert.match(locationSource, /enableHighAccuracy: false/);
  assert.match(client, /clearStoredCurrentLocationPreference/);
  assert.match(client, /rememberAppThemeLocation/);
  assert.ok(
    client.indexOf("applyAppThemeMode(\"sun\")") < client.indexOf("function LocationPanel()"),
    "the existing theme control remains separate from answer-location consent",
  );
  assert.match(client, /writeStoredCurrentLocationPreference\([\s\S]*?useForAnswers/);
});

test("an enabled current location persists across restarts and refreshes throughout the session", () => {
  assert.match(rootLayout, /<CurrentLocationAutoRefresh \/>/);
  assert.match(client, /persistCurrentLocationPreference\(true\)/);
  assert.match(client, /persistCurrentLocationPreference\(false\)/);
  assert.match(locationAutoRefresh, /hydrateCurrentLocationPreference\(\)\.then/);
  assert.match(locationAutoRefresh, /getStoredCurrentLocationPreference\(window\.localStorage\)/);
  assert.match(
    locationAutoRefresh,
    /if \(!preference\.useForAnswers\) return false;/,
    "startup never opts somebody into location use",
  );
  assert.match(locationAutoRefresh, /requestCurrentLocationFix\(\{ maxAgeMs: 0 \}\)/);
  assert.match(locationAutoRefresh, /resolveCurrentLocationLabel\(baseSnapshot, preference\.snapshot\)/);
  assert.match(locationAutoRefresh, /writeStoredCurrentLocationPreference\([\s\S]*?useForAnswers: true/);
  assert.match(locationAutoRefresh, /announceCurrentLocationChange\(\)/);
  assert.match(locationAutoRefresh, /CURRENT_LOCATION_REFRESH_INTERVAL_MS = 15 \* 60_000/);
  assert.match(locationAutoRefresh, /window\.setInterval\([\s\S]*?CURRENT_LOCATION_REFRESH_INTERVAL_MS/);
  assert.match(locationAutoRefresh, /document\.addEventListener\("visibilitychange"/);
  assert.match(locationAutoRefresh, /refreshCurrentLocationIfDue\(now = Date\.now\(\)\)/);
  assert.match(
    locationAutoRefresh,
    /const latestPreference = getStoredCurrentLocationPreference\(window\.localStorage\);[\s\S]*?if \(!latestPreference\.useForAnswers\) return false;/,
    "turning location off while a refresh is in flight cannot turn it back on",
  );
  assert.match(
    locationAutoRefresh,
    /initializationRefresh \?\?= hydrateCurrentLocationPreference\(\)\.then\(\(\) =>\s*refreshCurrentLocationAtInitialization\(\)/,
    "React remount checks cannot duplicate the initialization request",
  );
  assert.match(client, /It refreshes automatically while enabled\./);
});

test("a shell whose browser cannot locate falls back to the operating system", () => {
  // Electron has no geolocation provider at all, so the browser source fails
  // there however the permission is answered. Asking the OS through the local
  // server is what keeps the desktop app from reporting a block nobody made.
  assert.match(locationSource, /export function inDesktopShell/);
  assert.match(locationSource, /inDesktopShell\(\)\s*\n?\s*\?\s*\[systemFix/);
  assert.match(locationSource, /fetch\("\/api\/profile\/device-location", \{ method: "POST" \}\)/);
  assert.match(deviceLocationRoute, /requireUserId/);
  assert.match(
    deviceLocationRoute,
    /isLoopbackHostname/,
    "a remotely served instance must not report the host's location",
  );
  assert.match(deviceLocationRoute, /readSystemLocation/);
  // The desktop shell's own permission verdict is meaningless before the click
  // that grants it, so the card must not read it as a refusal.
  assert.match(client, /if \(inDesktopShell\(\)\) return;/);
});

test("the identity card carries no monogram tile", () => {
  assert.doesNotMatch(client, /monogram/i);
  assert.match(client, /\{account\.username\}/, "the name itself is what identifies you");
});

test("the profile no longer carries the product-about essay", () => {
  assert.doesNotMatch(client, /About this breadboard/);
  assert.doesNotMatch(client, /AboutBreadboard|AboutPassage/);
});

test("the model card sits directly below cost without the old caveat essay", () => {
  const costCard = client.indexOf('title="What it cost to answer you"');
  const modelCard = client.indexOf("<ModelPanel cost={stats.cost} />");
  const containingStackEnd = client.indexOf("</Packed>", costCard);

  assert.ok(costCard >= 0 && modelCard > costCard, "cost is followed by the model card");
  assert.ok(modelCard < containingStackEnd, "both cards stay in the same vertical stack");
  assert.equal(modelCard, client.lastIndexOf("<ModelPanel cost={stats.cost} />"));
  assert.doesNotMatch(client, /An upper bound on list prices/);
  assert.doesNotMatch(client, /Compression is the mirror of that bound/);
  assert.doesNotMatch(client, /use the .* rate/);
});

test("the packed settings leave the standard gap before reliability", () => {
  assert.match(client, /className="mt-4 gap-4 lg:columns-2"/);
  assert.doesNotMatch(client, /className="mt-4 -mb-4 gap-4 lg:columns-2"/);
});

test("the stats shown are ones no other surface already answers", () => {
  // The dashboard lists chats, the garden library lists gardens, and settings
  // shows what the agent remembers. The profile earns its place on the shape of
  // the use, so those are the things asserted here.
  for (const marker of [
    "Last ${stats.activityWeeks} weeks",
    "When you work",
    "Where you work",
    "Most used phrases",
    "What came out of it",
    "What it cost to answer you",
  ]) {
    assert.ok(client.includes(marker), `the page shows "${marker}"`);
  }
  assert.match(client, /Busiest gardens/);
  assert.match(client, /garden\.conversations/, "garden rows show how many chats carry the work");
  assert.match(client, /garden\.thinkingMs/, "garden rows show measured AI time");
  assert.match(client, /Active \{relativeTime\(garden\.lastPromptAt\)\}/, "garden rows show recency");
  assert.match(client, /Settings → Memory/, "durable memory is pointed at, not duplicated");
});

test("activity charts are inspectable controls rather than decorative placeholders", () => {
  assert.match(client, /aria-label=\{`Prompt activity over the last/);
  assert.match(client, /aria-pressed=\{selected\}/, "selected chart values have real control state");
  assert.match(client, /selectedDay\.conversations/, "a selected date reveals its source chats");
  assert.match(client, /Select an hour for its exact count/);
  assert.match(client, /Select a day for its exact count/);
  assert.match(client, /No prompt activity in this period/);
  assert.match(client, /No work rhythm yet/);
});
