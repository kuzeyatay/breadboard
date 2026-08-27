import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const read = (value) => fs.readFileSync(path.join(root, value), "utf8");

test("the slash button opens capabilities while typed slash opens only ready commands", () => {
  const composer = read("dashboard/src/app/components/assistant-composer.tsx");
  const palette = read("dashboard/src/app/components/hermes/command-hub.tsx");
  const slashMenu = read("dashboard/src/app/components/hermes/slash-command-menu.tsx");
  assert.match(palette, /aria-label="Open capabilities"/);
  assert.match(composer, /slashQuery[\s\S]{0,220}setShowSlashCommands\(true\)[\s\S]{0,100}setShowCommandHub\(false\)/);
  assert.doesNotMatch(composer, /next === ['"]\/['"][\s\S]{0,100}setShowCommandHub\(true\)/);
  assert.match(slashMenu, /directSlashCommandItems/);
  assert.match(slashMenu, /aria-label="Available capabilities"/);
  assert.match(composer, /insertCommandToken\(`\/\$\{item\.token\}`\)/);
  assert.match(composer, /const token = `\$\{command\} `/);
  assert.doesNotMatch(composer, /`\/\$\{item\.kind\}:\$\{item\.slug\}/);
});

test("capability markers choose a persistent row highlight instead of becoming checkboxes", () => {
  const palette = read("dashboard/src/app/components/hermes/command-hub.tsx");
  const colorControl = read("dashboard/src/app/components/hermes/favorite-box.tsx");
  const skills = read("dashboard/src/app/components/hermes/skills-catalog-panel.tsx");

  assert.match(colorControl, /CAPABILITY_HIGHLIGHT_COLORS/);
  assert.match(colorControl, /Highlight color/);
  assert.match(colorControl, /createPortal/);
  assert.match(colorControl, /onColorChange/);
  assert.doesNotMatch(colorControl, /<svg/);
  assert.match(palette, /HIGHLIGHT_COLORS_KEY/);
  assert.match(palette, /capabilityHighlightStyle\(highlightColor\)/);
  assert.match(skills, /capabilityHighlightStyle\(highlightColor\)/);
});

test("command rows omit internal category and source metadata", () => {
  const palette = read("dashboard/src/app/components/hermes/command-hub.tsx");
  assert.doesNotMatch(palette, /item\.trustLabel \?\? item\.source \?\? "Available"/);
  assert.doesNotMatch(palette, /item\.unavailableReason \? ` · \$\{item\.unavailableReason\}`/);
});

test("the palette keeps accessible keyboard behavior and leaves MCP setup to Settings", () => {
  const palette = read("dashboard/src/app/components/hermes/command-hub.tsx");
  const cache = read("dashboard/src/lib/hermes/command-client-cache.ts");
  const settings = read("dashboard/src/app/components/settings-dialog.tsx");
  for (const text of ["Use a capability", "Skills", "Prompts", "ArrowDown", "ArrowUp", "Escape", "role=\"dialog\"", "role=\"tablist\"", "Try again", "No matching capabilities", "motion-reduce:animate-none"]) {
    assert.match(palette, new RegExp(text));
  }
  assert.doesNotMatch(palette, /\{ id: "mcp", label: "MCP" \}/);
  assert.doesNotMatch(palette, /placeholder="Search MCP servers"/);
  assert.match(settings, /value: "mcp"[\s\S]{0,80}label: "MCP"/);
  assert.match(settings, /<SettingsMcp \/>/);
  // App connections are Settings → Connections now, not a palette tab.
  assert.doesNotMatch(palette, /\{ id: "connection", label: "Connections" \}/);
  assert.doesNotMatch(palette, /\/api\/hermes\/composio/);
  assert.doesNotMatch(palette, /placeholder="Search connections"/);
  const tabContent = palette.indexOf(
    '<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">',
  );
  assert.ok(tabContent > palette.indexOf("</header>"));
  assert.ok(palette.indexOf('"Search agents"') > tabContent);
  assert.ok(palette.indexOf('"Search prompts"') > tabContent);
  assert.match(palette, /bottom-\[calc\(env\(safe-area-inset-bottom\)/);
  assert.match(palette, /sm:absolute/);
  assert.match(palette, /window\.setTimeout\(\(\) => searchRef\.current\?\.focus/);
  assert.match(cache, /outcome\.slice\(0, 4_000\)/);
  assert.match(palette, /requiredCapabilityMode === "scoped_implementation"/);
  assert.match(palette, /if \(taskScoped \|\| conditional\) return/);
});

test("agent search filters built-in and Agency agents with consistent catalog rows", () => {
  const palette = read("dashboard/src/app/components/hermes/command-hub.tsx");
  for (const visibility of [
    "showAgentTars",
    "showAgentBrowser",
    "showDeepResearch",
    "showOpenPlanter",
    "showOpenCode",
    "showAgencyDirectory",
  ]) {
    assert.match(palette, new RegExp(`const ${visibility}`));
  }
  // Agency rows are the ARIS-filtered list now, and each agent's visibility
  // feeds the shared empty-state flag.
  assert.match(palette, /agencyDirectoryItems\.length > 0 \|\|\s*matchesAgentSearch/);
  assert.match(palette, /const hasVisibleAgents =[\s\S]*showAgencyDirectory;/);
  assert.match(palette, /No matching agents/);
  assert.match(
    palette,
    /className="truncate text-sm font-medium text-\[var\(--ink-heading\)\]">\{item\.name\}/,
  );
  assert.doesNotMatch(
    palette,
    /className="block break-all font-mono text-sm font-medium text-\[var\(--ink-heading\)\]">\{item\.name\}/,
  );
});

test("normal palette UI contains no filesystem, repository, health, or memory diagnostics", () => {
  const palette = read("dashboard/src/app/components/hermes/command-hub.tsx");
  for (const forbidden of ["filesystemMode", "activeDirectory", "accessibleRoots", "runtime health", "ChatMock", "GBrain", "api/hermes/settings"]) {
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
  const sessionService = read("dashboard/src/lib/hermes/session-service.ts");
  const lifecycle = read("dashboard/src/lib/hermes/capability-lifecycle.ts");
  assert.match(sessionService, /setHermesUserSettings\(options\.userId!, \{ filesystemMode: "restricted" \}\)/);
  assert.match(sessionService, /previousDirectory: null/);
  assert.match(lifecycle, /revokeCapabilityDecision\(session\.row\.id, "expired"/);
  assert.match(lifecycle, /applyCapabilityDecision/);
  assert.match(lifecycle, /restoredMode: "knowledge"/);
});
