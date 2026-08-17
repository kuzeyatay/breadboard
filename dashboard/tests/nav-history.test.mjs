import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  backLabelFor,
  consumeBackTo,
  recordVisit,
  resolveBackHref,
  subscribeToTrail,
} from "../src/lib/nav-history.ts";

const ORIGIN = "http://localhost:3000";

function installWindow() {
  const store = new Map();
  globalThis.window = {
    location: { origin: ORIGIN },
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  return store;
}

function trail(...hrefs) {
  installWindow();
  for (const href of hrefs) recordVisit(href);
}

test("back returns to the page the user actually came from", () => {
  trail("/dashboard", "/garden/plants");
  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/dashboard");

  trail("/gardens/plants", "/garden/plants");
  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/gardens/plants");
});

test("moving around inside one surface never becomes its own back target", () => {
  trail("/dashboard", "/garden/plants", "/garden/plants?note=roses", "/garden/plants?note=tulips");
  assert.equal(resolveBackHref("/garden/plants?note=tulips", "/gardens/plants"), "/dashboard");
});

test("the resolver prefers the visited page over the fixed fallback", () => {
  trail("/dashboard", "/garden/plants", "/gardens/plants");
  assert.equal(resolveBackHref("/gardens/plants", "/dashboard"), "/garden/plants");
});

test("following back unwinds the trail instead of bouncing between two pages", () => {
  // Garden chat and the Quartz garden each link to the other, so without
  // unwinding they are each other's back target forever.
  trail("/dashboard", "/garden/plants", "/gardens/plants");

  const first = resolveBackHref("/gardens/plants", "/dashboard");
  assert.equal(first, "/garden/plants");
  consumeBackTo(first);
  recordVisit(first);

  const second = resolveBackHref("/garden/plants", "/gardens/plants");
  assert.equal(second, "/dashboard");
  consumeBackTo(second);
  recordVisit(second);

  assert.equal(resolveBackHref("/dashboard", "/dashboard"), "/dashboard");
});

test("a trail that already bounced escapes in one click, not one click per bounce", () => {
  trail(
    "/dashboard",
    "/gardens/plants",
    "/garden/plants",
    "/gardens/plants",
    "/garden/plants",
    "/gardens/plants",
  );

  const first = resolveBackHref("/gardens/plants", "/dashboard");
  assert.equal(first, "/garden/plants");
  consumeBackTo(first);
  recordVisit(first);

  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/dashboard");
});

test("following back to an unvisited fallback drops the page being left", () => {
  trail("/gardens/plants");
  consumeBackTo("/dashboard");
  recordVisit("/dashboard");
  assert.equal(resolveBackHref("/dashboard", "/dashboard"), "/dashboard");
});

test("the back control unwinds the trail when it is followed", () => {
  const backLink = fs.readFileSync(
    new URL("../src/app/components/back-link.tsx", import.meta.url),
    "utf8",
  );
  assert.match(backLink, /onClick=\{\(\) => consumeBackTo\(href\)\}/);
});

test("a deep link with no trail falls back to the fixed parent", () => {
  trail();
  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/gardens/plants");

  trail("/garden/plants");
  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/gardens/plants");
});

test("auth and api routes are never offered as a back target", () => {
  trail("/dashboard", "/auth/login", "/garden/plants");
  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/dashboard");
});

test("cross-origin and unparseable locations are ignored", () => {
  trail("/dashboard");
  recordVisit("https://example.com/elsewhere");
  recordVisit("::not a url::");
  assert.equal(resolveBackHref("/garden/plants", "/gardens/plants"), "/dashboard");
});

test("the trail stays bounded", () => {
  installWindow();
  for (let index = 0; index < 60; index += 1) recordVisit(`/notes/${index}`);
  const raw = JSON.parse(globalThis.window.sessionStorage.getItem("breadboard:nav-trail"));
  assert.ok(raw.length <= 20, `expected a bounded trail, got ${raw.length}`);
  assert.equal(raw[raw.length - 1], "/notes/59");
});

test("subscribers are notified so back targets refresh on navigation", () => {
  installWindow();
  let notifications = 0;
  const unsubscribe = subscribeToTrail(() => {
    notifications += 1;
  });
  recordVisit("/dashboard");
  recordVisit("/dashboard");
  recordVisit("/garden/plants");
  unsubscribe();
  recordVisit("/gardens/plants");
  assert.equal(notifications, 2);
});

test("labels describe where the resolved target lands", () => {
  installWindow();
  assert.equal(backLabelFor("/dashboard", "Back"), "Back to dashboard");
  assert.equal(backLabelFor("/gardens/plants", "Back"), "Back to garden chat");
  assert.equal(backLabelFor("/garden/plants?note=roses", "Back"), "Back to garden");
  assert.equal(backLabelFor("/garden?view=public", "Back"), "Back to library");
  assert.equal(backLabelFor("/gardens/plants/pdf/paper", "Back"), "Back to PDF");
  assert.equal(backLabelFor("/somewhere-else", "Back to dashboard"), "Back");
});

test("the Quartz garden routes its back control through the trail", () => {
  const quartzPage = fs.readFileSync(
    new URL("../src/app/garden/[clusterSlug]/page.tsx", import.meta.url),
    "utf8",
  );
  const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

  assert.match(quartzPage, /<BackLink/);
  assert.doesNotMatch(quartzPage, /href=\{cluster\.isOwner \? `\/gardens\//);
  assert.match(layout, /<NavigationTrail \/>/);
});

test("garden chat leaves to the dashboard rather than following the trail", () => {
  // Two surfaces that link to each other cannot both defer to the trail without
  // becoming each other's back target, so garden chat is the fixed end.
  const gardenChat = fs.readFileSync(
    new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(gardenChat, /BackLink/);
  assert.match(gardenChat, /href="\/dashboard"[\s\S]{0,900}Back to dashboard/);
});

test("the profile page leaves to the dashboard rather than following the trail", () => {
  // A person page is reached from the profile's own member list, so deferring
  // to the trail makes the two each other's back target as soon as the
  // browser's back button returns the user without unwinding it.
  const profile = fs.readFileSync(
    new URL("../src/app/profile/profile-client.tsx", import.meta.url),
    "utf8",
  );

  assert.match(profile, /<BackLink[^>]*fallbackHref="\/dashboard"[^>]*\sfixed\b/);
});

test("reloading the embedded garden does not stack a history entry", () => {
  const gardenClient = fs.readFileSync(
    new URL("../src/app/garden/[clusterSlug]/garden-client.tsx", import.meta.url),
    "utf8",
  );
  const spa = fs.readFileSync(
    new URL("../../quartz/quartz/components/scripts/spa.inline.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(gardenClient, /iframeRef\.current\.src = /);
  assert.match(gardenClient, /frameWindow\.location\.replace\(url\)/);
  assert.match(spa, /function hardNavigate/);
  assert.doesNotMatch(spa, /\.catch\(\(\) => \{\s*window\.location\.assign/);
});
