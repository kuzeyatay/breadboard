import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (value) => fs.readFileSync(path.join(root, value), "utf8");

test("the shared composer opens capabilities from the slash button and initial slash", () => {
  const composer = read("dashboard/src/app/components/assistant-composer.tsx");
  const palette = read("dashboard/src/app/components/openharness/command-hub.tsx");
  assert.match(palette, /aria-label="Open capabilities"/);
  assert.match(composer, /if \(next === '\/'\) setShowCommandHub\(true\)/);
  assert.match(composer, /const token = `\/\$\{item\.token\} `/);
  assert.doesNotMatch(composer, /`\/\$\{item\.kind\}:\$\{item\.slug\}/);
});

test("the palette has three tabs, keyboard behavior, responsive layout, and accessible states", () => {
  const palette = read("dashboard/src/app/components/openharness/command-hub.tsx");
  for (const text of ["Use a capability", "Skills", "Connections", "Prompts", "ArrowDown", "ArrowUp", "Escape", "role=\"dialog\"", "role=\"tablist\"", "Try again", "No matching capabilities", "motion-reduce:animate-none"]) {
    assert.match(palette, new RegExp(text));
  }
  assert.match(palette, /bottom-\[calc\(env\(safe-area-inset-bottom\)/);
  assert.match(palette, /sm:absolute/);
  assert.match(palette, /window\.setTimeout\(\(\) => searchRef\.current\?\.focus/);
  assert.match(palette, /requestedOutcome\.slice\(0, 4_000\)/);
  assert.match(palette, /requiredCapabilityMode === "scoped_implementation"/);
  assert.match(palette, /if \(taskScoped \|\| conditional\) return/);
});

test("normal palette UI contains no filesystem, repository, health, or memory diagnostics", () => {
  const palette = read("dashboard/src/app/components/openharness/command-hub.tsx");
  for (const forbidden of ["filesystemMode", "activeDirectory", "accessibleRoots", "runtime health", "ChatMock", "GBrain", "api/openharness/settings"]) {
    assert.doesNotMatch(palette, new RegExp(forbidden, "i"));
  }
  assert.doesNotMatch(palette, /does not send/i);
});

test("Quartz uses clean tokens, three capability tabs, and no public memory placeholder", () => {
  const component = read("quartz/quartz/components/BreadboardAI.tsx");
  const script = read("quartz/quartz/components/scripts/breadboardAI.inline.ts");
  const route = read("dashboard/src/app/api/quartz-ai/commands/route.ts");
  assert.match(component, /Use a capability/);
  assert.match(component, /data-command-tab="skill"/);
  assert.match(component, /data-command-tab="mcp"/);
  assert.match(component, /data-command-tab="prompt"/);
  assert.match(script, /const token = `\/\$\{item\.token\} `/);
  assert.doesNotMatch(script, /item\.kind}:\$\{item\.slug/);
  assert.match(route, /mcp: userId === null \? \[\]/);
  assert.doesNotMatch(route, /GBrain|Durable memory/);
});

test("legacy broad settings are inactive and task capability has wall-clock revocation", () => {
  const sessionService = read("dashboard/src/lib/openharness/session-service.ts");
  const lifecycle = read("dashboard/src/lib/openharness/capability-lifecycle.ts");
  assert.match(sessionService, /setOpenHarnessUserSettings\(options\.userId!, \{ filesystemMode: "restricted" \}\)/);
  assert.match(sessionService, /previousDirectory: null/);
  assert.match(lifecycle, /revokeCapabilityDecision\(session\.row\.id, "expired"/);
  assert.match(lifecycle, /applyCapabilityDecision/);
  assert.match(lifecycle, /restoredMode: "knowledge"/);
});
