import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const titleBar = fs.readFileSync(
  new URL("../src/app/components/desktop-title-bar.tsx", import.meta.url),
  "utf8",
);
const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const navbar = fs.readFileSync(
  new URL("../src/app/components/navbar.tsx", import.meta.url),
  "utf8",
);
const dashboardPage = fs.readFileSync(
  new URL("../src/app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const dashboardClient = fs.readFileSync(
  new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url),
  "utf8",
);

test("the root layout includes minimal desktop-only window chrome", () => {
  assert.match(layout, /<DesktopTitleBar\s*\/>/);
  assert.match(titleBar, /"breadboardDesktop" in window/);
  assert.match(titleBar, /aria-label="Window controls"/);
  assert.doesNotMatch(titleBar, /<img/);
  assert.doesNotMatch(titleBar, />breadboard</i);
});

test("desktop chrome reserves space and exposes a draggable title area", () => {
  assert.match(globals, /--breadboard-titlebar-height:\s*32px/);
  assert.match(globals, /background:\s*#faf7ef/);
  assert.doesNotMatch(
    globals.match(/html\[data-breadboard-desktop="true"\] \.desktop-title-bar \{[\s\S]*?\n\}/)?.[0] ?? "",
    /border-bottom/,
  );
  assert.match(globals, /-webkit-app-region:\s*drag/);
  assert.match(globals, /calc\(100vh - var\(--breadboard-titlebar-height\)\)/);
});

test("the application navbar remains on the compact pre-redesign layout", () => {
  assert.match(navbar, /<NavbarFlowerWind\s*\/>/);
  assert.doesNotMatch(navbar, /\{actions\}|actions\?: ReactNode/);
  assert.match(navbar, /\{username \|\| email\}/);
  assert.match(navbar, />\s*Sign out\s*</);
  assert.doesNotMatch(navbar, /knowledge garden/i);
  assert.doesNotMatch(navbar, /workspaceRail|accountTrigger|Local workspace/);
  assert.doesNotMatch(dashboardPage, /initialChatmockTarget|CHATMOCK_TARGET_COOKIE/);
  assert.doesNotMatch(dashboardClient, /ChatmockTargetSwitch|initialChatmockTarget/);
});
