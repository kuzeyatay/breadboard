// The edges of a garden: the chat rail on the left, the learning map on the
// right, the panel between them. They used to be two different ideas — one
// clicked between two fixed widths, the other dragged to any width and could
// not be clicked at all — and this pins the single control that replaced both.
//
// Rendered for real (esbuild -> CJS -> react-dom/server) rather than reasoned
// about. Server markup runs no effects, which is exactly the point for the
// panel: what this render produces is what the browser paints before the first
// animation frame, and a width of zero there is the whole reason the panel
// travels instead of popping.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import { settleRailWidth } from "../src/app/components/hermes/use-rail-resize.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-side-panel-dock-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  [
    `export { default as SidePanelDock } from "@/app/components/hermes/side-panel-dock";`,
    `export { default as RailDivider } from "@/app/components/hermes/rail-divider";`,
    // Node can strip types from a .ts file but not from a .tsx one, so the
    // rail's widths come through the same bundle as the components.
    `export { CHAT_RAIL_RESIZE } from "@/app/components/hermes/terminal-sidebar";`,
    "",
  ].join("\n"),
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { SidePanelDock, RailDivider, CHAT_RAIL_RESIZE } = require(bundle);

function renderDock() {
  return renderToStaticMarkup(
    React.createElement(
      SidePanelDock,
      { label: "Artifacts", defaultWidth: 520, storageKey: "test:panel-width" },
      React.createElement("p", null, "the archive"),
    ),
  );
}

function renderDivider(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(RailDivider, {
      collapsed: false,
      onToggle: () => {},
      name: "Toggle the learning map",
      moves: "the learning map",
      ...overrides,
    }),
  );
}

test("the panel's first frame is closed, so the width has somewhere to travel", () => {
  const markup = renderDock();
  assert.match(markup, /<aside[^>]*style="width:0(px)?"/);
  assert.match(markup, /class="[^"]*bb-rail-travel[^"]*"/);
});

test("a collapsed panel is out of reach of the keyboard and the reader", () => {
  assert.match(renderDock(), /<aside[^>]*\sinert(=""|\s|>)/);
});

test("the contents hold the width the panel is heading for while the box moves", () => {
  // Without this the box at zero would squeeze its contents, and a collapse
  // would reflow every line of the panel on the way out.
  assert.match(renderDock(), /<div style="width:520px"[^>]*>.*the archive/s);
});

test("an edge that drags says so, and one that only clicks does not", () => {
  const dragging = renderDivider({ onPointerDown: () => {} });
  const clickOnly = renderDivider();
  assert.match(dragging, /title="Collapse the learning map, or drag to resize"/);
  assert.match(dragging, /class="[^"]*cursor-col-resize/);
  assert.match(clickOnly, /title="Collapse the learning map"/);
  assert.match(clickOnly, /class="[^"]*cursor-pointer/);
});

test("the edge says which way it will move, in both directions", () => {
  assert.match(renderDivider({ collapsed: true }), /title="Show the learning map"/);
  assert.match(renderDivider({ collapsed: true }), /aria-expanded="false"/);
  assert.match(renderDivider(), /aria-expanded="true"/);
});

test("every edge draws the same hairline and the same handle", () => {
  const railMarkup = renderDivider({ name: "Toggle the sidebar", moves: "the chat list" });
  const dockMarkup = renderDock();
  const hairline = railMarkup.match(/<span aria-hidden="true" class="([^"]*absolute[^"]*)"/);
  const handle = railMarkup.match(/<span aria-hidden="true" class="([^"]*rounded-full[^"]*)"/);
  assert.ok(hairline && handle, "the divider still draws a hairline and a handle");
  assert.ok(dockMarkup.includes(hairline[1]), "the panel's edge draws the same hairline");
  assert.ok(dockMarkup.includes(handle[1]), "the panel's edge draws the same handle");
});

test("a released drag never lands between the rail and a readable list", () => {
  // The reason drag was taken off the chat sidebar once: it could be left at a
  // width where the list was rendered and unreadable at the same time. The band
  // between the icon rail and `min` is now one a drag passes through only.
  const { min, max, railWidth, threshold } = CHAT_RAIL_RESIZE;
  const bounds = { min, max, railWidth, threshold };
  for (let width = 0; width <= max + 120; width += 1) {
    const settled = settleRailWidth(width, bounds);
    assert.ok(
      settled === railWidth || (settled >= min && settled <= max),
      `a drag released at ${width}px settled at ${settled}px, which is neither the rail nor readable`,
    );
  }
  assert.equal(settleRailWidth(threshold - 1, bounds), railWidth);
  assert.equal(settleRailWidth(threshold, bounds), min);
  assert.equal(settleRailWidth(max + 500, bounds), max);
});
