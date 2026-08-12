import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const sidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");
const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const panel = source("../src/app/components/hermes/hooks-panel.tsx");
const hooksPage = source("../src/app/hooks/page.tsx");
const dashboardShell = source("../src/app/dashboard/dashboard-page-shell.tsx");
const dashboardClient = source("../src/app/dashboard/dashboard-client.tsx");

test("Hooks stays below Scheduled and opens through the same in-place panel control", () => {
  const navStart = sidebar.indexOf('<nav aria-label="Terminal actions"');
  const navEnd = sidebar.indexOf("</nav>", navStart);
  const nav = sidebar.slice(navStart, navEnd);
  const scheduled = nav.indexOf('label="Scheduled"');
  const hooks = nav.indexOf('label="Hooks"');
  const processes = nav.indexOf('label="Processes"');

  assert.ok(scheduled >= 0 && hooks > scheduled, "Hooks follows Scheduled");
  assert.ok(processes > hooks, "Processes follows Hooks");
  assert.ok(sidebar.indexOf('label="Recents"') > navEnd, "Recents follows the main navigation");
  assert.match(nav, /label="Hooks"[\s\S]{0,180}active=\{openPanel === "hooks"\}/);
  assert.match(nav, /label="Hooks"[\s\S]{0,220}onClick=\{\(\) => onTogglePanel\("hooks"\)\}/);
  assert.doesNotMatch(nav, /label="Hooks"[\s\S]{0,180}href=/);
});

test("the /hooks route reuses the dashboard terminal shell and opens the Hooks panel", () => {
  assert.match(hooksPage, /<DashboardPageShell initialTerminalPanel="hooks" \/>/);
  assert.match(dashboardShell, /initialTerminalPanel\?: TerminalPanel \| null/);
  assert.match(dashboardClient, /initialPanel=\{initialTerminalPanel\}/);
  assert.match(terminal, /useState<TerminalPanel \| null>\(initialPanel\)/);
  assert.match(terminal, /if \(initialPanel\)[\s\S]{0,360}setHeight\(/);
  assert.match(terminal, /sidePanel === "hooks" \? \([\s\S]{0,180}<HooksPanel \/>/);
});

test("the Hooks empty state matches the requested copy and offers a primary action", () => {
  assert.match(panel, />Hooks<\/h2>/);
  assert.match(panel, /Create automations that react when something happens\./);
  assert.match(panel, />No hooks yet<\/h3>/);
  assert.match(panel, /Create a hook to automatically run an action when an event occurs\./);
  assert.match(panel, /neu-button-primary[\s\S]{0,120}>\s*\+ New hook\s*<\/button>/);
});
