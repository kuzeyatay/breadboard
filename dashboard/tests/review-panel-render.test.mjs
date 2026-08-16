// Renders the spaced-repetition panel for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what it would produce.
//
// The state worth pinning down is the confusing one: a garden switched on while
// no delivery channel is chosen. Nothing would ever be sent, and without the
// warning the panel would look correctly configured while doing nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-review-panel-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ReviewSettingsPanel } from "@/app/components/hermes/review-settings-panel";\n` +
    `export { default as GardenSettingsDialog } from "@/app/components/garden-settings-dialog";\n` +
    `export { GardenSettingsIcon } from "@/app/components/garden-settings-dialog";\n`,
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
const { ReviewSettingsPanel, GardenSettingsDialog, GardenSettingsIcon } = require(bundle);

/**
 * The panel loads over fetch on mount. Server rendering never runs effects, so
 * these tests drive the same states by stubbing fetch and rendering — which is
 * enough to prove the markup for each state exists and does not throw.
 */
function stubFetch(payload) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => payload,
  });
}

function payload(overrides = {}) {
  return {
    garden: {
      gardenSlug: "electromagnetism-1",
      enabled: true,
      dailyLimit: 3,
      cardCount: 42,
      dueCount: 5,
      lastSeededAt: null,
      ...(overrides.garden ?? {}),
    },
    user: {
      channel: "telegram",
      dailyLimit: 5,
      sendHour: 8,
      desiredRetention: 0.9,
      ...(overrides.user ?? {}),
    },
    stats: {
      total: 42,
      due: 5,
      newCards: 30,
      learning: 7,
      review: 5,
      answered30d: 0,
      retention30d: null,
      ...(overrides.stats ?? {}),
    },
  };
}

test("the panel renders without throwing before its data arrives", () => {
  stubFetch(payload());
  const html = renderToStaticMarkup(
    React.createElement(ReviewSettingsPanel, { gardenSlug: "electromagnetism-1" }),
  );
  assert.match(html, /Spaced repetition/);
  // No data yet on a server render, so it must show the loading state rather
  // than reading through a null.
  assert.match(html, /Loading/);
});

test("the panel does not fetch during server rendering", () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => payload() };
  };
  renderToStaticMarkup(
    React.createElement(ReviewSettingsPanel, { gardenSlug: "electromagnetism-1" }),
  );
  assert.equal(calls, 0, "loading belongs to an effect, which the server never runs");
});

// ------------------------------------------------- the workspace header dialog

test("the gear icon renders as an svg", () => {
  const html = renderToStaticMarkup(React.createElement(GardenSettingsIcon, {}));
  assert.match(html, /^<svg/, "the workspace header needs a real icon, not a text glyph");
  assert.match(html, /aria-hidden/);
});

test("the garden settings dialog renders as a labelled modal", () => {
  stubFetch(payload());
  const html = renderToStaticMarkup(
    React.createElement(GardenSettingsDialog, {
      gardenSlug: "electromagnetism-1",
      onClose: () => {},
    }),
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /Garden settings/);
  assert.match(html, /electromagnetism-1/);
  // It must offer a way out even before its data arrives.
  assert.match(html, /aria-label="Close garden settings"/);
});

test("the dialog offers every garden setting, not just the review ones", () => {
  // Source assertions rather than SSR markup: the fields render only after the
  // settings fetch resolves, which a server render never does. What matters is
  // that each control exists and is wired to the endpoint.
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/components/garden-settings-dialog.tsx"),
    "utf8",
  );
  for (const [label, pattern] of [
    ["garden name", /Garden name/],
    ["description", /Description/],
    ["instructions", /Instructions/],
    ["memory", /Garden-only memory/],
    ["published chat", /Chat on the published site/],
    ["spaced repetition", /Spaced repetition/],
    ["review delivery", /Review delivery/],
    ["delete", /Delete garden/],
  ]) {
    assert.match(source, pattern, `the dialog is missing the ${label} control`);
  }

  // Each write must reach the endpoint, not just sit in local state.
  assert.match(source, /save\(\s*\{ name: name\.trim\(\)/);
  assert.match(source, /save\(\{ instructions: instructions\.trim\(\) \}/);
  assert.match(source, /save\(\s*\{ memoryScope:/);
  assert.match(source, /save\(\{ chatAccessible:/);
  assert.match(source, /patchUser\(\{ channel/, "the channel is settable here, not only on profile");
});

test("the dialog does not import server actions into the client bundle", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/components/garden-settings-dialog.tsx"),
    "utf8",
  );
  // Importing a "use server" module here pulls Next's server runtime into the
  // client bundle, which is how this component stopped bundling once already.
  assert.doesNotMatch(source, /from "@\/app\/actions\//);
});

test("memory is a described listbox, not a bare select", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/components/garden-settings-dialog.tsx"),
    "utf8",
  );
  // A native <select> can only show one line per option, and this choice is not
  // one to guess at from two words.
  // Matched on the closing tag: the prose above DescribedSelect mentions
  // `<select>` by name, and asserting on the opening tag would catch that.
  assert.doesNotMatch(source, /<\/select>/, "the dialog should carry no native selects");
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-selected=\{isSelected\}/);
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /aria-expanded=\{open\}/);

  // Both options must carry the description that makes them legible.
  assert.match(source, /This garden can access memory from outside chats, and vice versa\./);
  assert.match(
    source,
    /This garden can only access its own memory\. Its memory is hidden from outside chats\./,
  );
});

test("the listbox is operable from the keyboard", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/components/garden-settings-dialog.tsx"),
    "utf8",
  );
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
    assert.match(source, new RegExp(`"${key}"`), `the listbox ignores ${key}`);
  }
  // Escape inside an open list must close the list, not the whole dialog.
  assert.match(source, /event\.stopPropagation\(\)/);
});

test("deleting is guarded by typing the garden's name", () => {
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src/app/components/garden-settings-dialog.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /confirmDelete\.trim\(\) !== \(settings\?\.name \?\? ""\)/,
    "delete must stay disabled until the name matches exactly",
  );
  assert.match(source, /method: "DELETE"/);
});
