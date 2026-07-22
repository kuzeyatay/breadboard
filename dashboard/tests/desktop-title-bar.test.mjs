import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const layout = fs.readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const titleBar = fs.readFileSync(
  new URL("../src/app/components/desktop-title-bar.tsx", import.meta.url),
  "utf8",
);
const globals = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("the root layout includes desktop-only Breadboard window chrome", () => {
  assert.match(layout, /<DesktopTitleBar\s*\/>/);
  assert.match(titleBar, /"breadboardDesktop" in window/);
  assert.match(titleBar, /breadboard-icon-20260426\.png/);
  assert.match(titleBar, />breadboard</);
});

test("desktop chrome reserves space and exposes a draggable title area", () => {
  assert.match(globals, /--breadboard-titlebar-height:\s*40px/);
  assert.match(globals, /-webkit-app-region:\s*drag/);
  assert.match(globals, /calc\(100vh - var\(--breadboard-titlebar-height\)\)/);
});
