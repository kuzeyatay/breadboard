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
  assert.match(globals, /background:\s*var\(--paper-surface\)/);
  assert.doesNotMatch(
    globals.match(/html\[data-breadboard-desktop="true"\] \.desktop-title-bar \{[\s\S]*?\n\}/)?.[0] ?? "",
    /border-bottom/,
  );
  assert.match(globals, /-webkit-app-region:\s*drag/);
  assert.match(globals, /calc\(100vh - var\(--breadboard-titlebar-height\)\)/);
});

test("Garden flower toolbars match the Electron caption surface", () => {
  assert.match(
    globals,
    /\.bb-neu-toolbar\.breadboard-flower-navbar\s*\{\s*background:\s*var\(--paper-surface\)/,
  );
  assert.match(globals, /--paper-surface:\s*#faf7ef/);
  assert.match(globals, /--paper-surface:\s*#20211f/);
  assert.match(
    globals,
    /html\[data-theme="dark"\] \.bb-neu-toolbar\s*\{\s*background:\s*var\(--paper-surface\)/,
  );
});

test("the application navbar remains on the compact pre-redesign layout", () => {
  assert.match(navbar, /<NavbarFlowerWind\s*\/>/);
  assert.match(navbar, /<Link[\s\S]*?href="\/dashboard"[\s\S]*?aria-label="Go to Breadboard main page"/);
  assert.doesNotMatch(navbar, /\{actions\}|actions\?: ReactNode/);
  assert.match(navbar, /\{username \|\| email\}/);
  // Signing out moved to the profile page the chip now opens; the navbar keeps
  // the identity, not the account actions.
  assert.match(navbar, /href="\/profile"/);
  assert.doesNotMatch(navbar, />\s*Sign out\s*</);
  assert.doesNotMatch(navbar, /knowledge garden/i);
  assert.doesNotMatch(navbar, /workspaceRail|accountTrigger|Local workspace/);
  assert.doesNotMatch(dashboardPage, /initialChatmockTarget|CHATMOCK_TARGET_COOKIE/);
  assert.doesNotMatch(dashboardClient, /ChatmockTargetSwitch|initialChatmockTarget/);
});
