import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Skills uses the live compact catalog with every required view", () => {
  const ui = read("src/app/components/openharness/skills-catalog-panel.tsx");
  assert.match(ui, /Search every public skill/);
  assert.match(ui, /"all"[\s\S]*"trending"[\s\S]*"hot"[\s\S]*"official"[\s\S]*"installed"[\s\S]*"updates"/);
  assert.match(ui, /\/api\/openharness\/skills\?/);
  assert.match(ui, /\/api\/openharness\/skills\/search/);
  assert.match(ui, /Previous[\s\S]*Next/);
  assert.match(ui, /divide-y divide-\[var\(--line\)\]/);
});

test("Skills rows have no decorative icon circles or permanent stars", () => {
  const ui = read("src/app/components/openharness/skills-catalog-panel.tsx");
  assert.doesNotMatch(ui, /<svg|★|☆|sparkle|rounded-full/iu);
  assert.doesNotMatch(ui, /favorite/iu);
  assert.match(ui, /font-mono text-sm/);
});

test("Skills exposes synchronization, stale, offline, details, and explicit lifecycle actions", () => {
  const ui = read("src/app/components/openharness/skills-catalog-panel.tsx");
  assert.match(ui, /Showing a stale last-known-good catalog/);
  assert.match(ui, /Catalog refresh failed/);
  assert.match(ui, /Refresh/);
  assert.match(ui, /Upstream ID[\s\S]*Upstream hash[\s\S]*Approved hash[\s\S]*Install URL/);
  assert.match(ui, /Review for install/);
  assert.match(ui, /Approve and install/);
  assert.match(ui, /Review update/);
  assert.match(ui, /Remove/);
  assert.match(ui, /Open source/);
});

test("Skills supports keyboard navigation, focus return, narrow widths, and theme variables", () => {
  const ui = read("src/app/components/openharness/skills-catalog-panel.tsx");
  assert.match(ui, /ArrowDown/);
  assert.match(ui, /ArrowUp/);
  assert.match(ui, /event\.key === "Enter"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /selectedButtonRef\.current\?\.focus/);
  assert.match(ui, /sm:grid-cols-2/);
  assert.match(ui, /var\(--paper-raised\)/);
  assert.match(ui, /var\(--ink\)/);
});

test("using an installed skill inserts its qualified slash command without submitting", () => {
  const catalog = read("src/app/components/openharness/skills-catalog-panel.tsx");
  const hub = read("src/app/components/openharness/command-hub.tsx");
  assert.match(catalog, /onUse\(selected\)/);
  assert.match(hub, /token: skill\.slashCommand/);
  assert.match(hub, /onSelect\(/);
  assert.doesNotMatch(catalog, /requestSubmit|\.submit\(/);
});
