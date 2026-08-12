import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  backLabelFor,
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

test("garden chat backs out to where it was opened from, not always the dashboard", () => {
  trail("/dashboard", "/garden/plants", "/gardens/plants");
  assert.equal(resolveBackHref("/gardens/plants", "/dashboard"), "/garden/plants");
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

test("the garden surfaces route their back control through the trail", () => {
  const quartzPage = fs.readFileSync(
    new URL("../src/app/garden/[clusterSlug]/page.tsx", import.meta.url),
    "utf8",
  );
  const gardenChat = fs.readFileSync(
    new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
    "utf8",
  );
  const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

  assert.match(quartzPage, /<BackLink/);
  assert.doesNotMatch(quartzPage, /href=\{cluster\.isOwner \? `\/gardens\//);
  assert.match(gardenChat, /<BackLink/);
  assert.match(layout, /<NavigationTrail \/>/);
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
