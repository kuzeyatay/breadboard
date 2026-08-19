import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  beginLiveBreadboardProcess,
  finishLiveBreadboardProcess,
  listLiveBreadboardProcesses,
} from "../src/lib/processes/live-processes.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const sidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");
const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
const panel = source("../src/app/components/hermes/processes-panel.tsx");
const page = source("../src/app/processes/page.tsx");
const route = source("../src/app/api/processes/route.ts");
const runs = source("../src/lib/hermes/run-store.ts");
const tracking = source("../src/lib/plan/agent-tracking.ts");

test("Processes is the final main item and opens in place like Scheduled", () => {
  const nav = sidebar.slice(
    sidebar.indexOf('<nav aria-label="Terminal actions"'),
    sidebar.indexOf("</nav>"),
  );
  const hooks = nav.indexOf('label="Hooks"');
  const processes = nav.indexOf('label="Processes"');
  assert.ok(hooks >= 0 && processes > hooks);
  assert.match(nav, /label="Processes"[\s\S]{0,180}active=\{openPanel === "processes"\}/);
  assert.match(nav, /label="Processes"[\s\S]{0,220}onClick=\{\(\) => onTogglePanel\("processes"\)\}/);
  assert.doesNotMatch(nav, /label="Processes"[\s\S]{0,180}href=/);
  assert.ok(sidebar.indexOf('label="Recents"') > sidebar.indexOf("</nav>"));
});

test("the Processes route opens the shared dashboard panel", () => {
  assert.match(page, /<DashboardPageShell initialTerminalPanel="processes" \/>/);
  assert.match(terminal, /import ProcessesPanel from "\.\/processes-panel"/);
  assert.match(terminal, /sidePanel === "hooks" \? \([\s\S]{0,300}<ProcessesPanel/);
  assert.match(terminal, /onOpenChat=\{\(conversationId\) => openHistorySession\(conversationId\)\}/);
  assert.match(terminal, /onOpenPanel=\{\(panel\) => setSidePanel\(panel\)\}/);
});

test("the authenticated snapshot combines authoritative live work and schedules", () => {
  assert.match(route, /const userId = await requireUserId\(\)/);
  assert.match(route, /listActiveRuntimeRunsForUser\(userId\)/);
  assert.match(route, /listLiveBreadboardProcesses\(userId\)/);
  assert.doesNotMatch(route, /columnSlug: "in-progress"|AGENT_PROJECT_NAME/);
  assert.match(route, /getScheduledChatJobStore\(\)[\s\S]{0,80}\.list\(userId\)/);
  assert.match(route, /hooks: \[\]/);
  assert.match(runs, /WHERE r\.status = 'active'[\s\S]{0,100}c\.user_id = \?/);
  assert.match(runs, /!isRuntimeRunAbandoned\(row, now\)/);
  assert.match(runs, /LIMIT \?/);
  assert.match(tracking, /beginLiveBreadboardProcess/);
  assert.match(tracking, /finishLiveBreadboardProcess/);
});

test("live process state is user-scoped and disappears at the terminal boundary", () => {
  const firstUser = 990_001;
  const secondUser = 990_002;
  const runId = `process-test-${Date.now()}`;
  beginLiveBreadboardProcess({
    userId: firstUser,
    runId,
    title: "First user's run",
    kind: "agent",
    now: new Date("2026-08-10T08:00:00.000Z"),
  });
  beginLiveBreadboardProcess({
    userId: secondUser,
    runId,
    title: "Second user's run",
    kind: "agent",
    now: new Date("2026-08-10T09:00:00.000Z"),
  });

  assert.deepEqual(listLiveBreadboardProcesses(firstUser).map((item) => item.title), ["First user's run"]);
  assert.deepEqual(listLiveBreadboardProcesses(secondUser).map((item) => item.title), ["Second user's run"]);

  finishLiveBreadboardProcess({ userId: firstUser, runId, kind: "agent" });
  assert.deepEqual(listLiveBreadboardProcesses(firstUser), []);
  assert.equal(listLiveBreadboardProcesses(secondUser).length, 1);
  finishLiveBreadboardProcess({ userId: secondUser, runId, kind: "agent" });
});

test("Processes auto-refreshes and exposes all four activity groups", () => {
  assert.match(panel, /fetch\("\/api\/processes", \{ cache: "no-store" \}\)/);
  assert.match(panel, /window\.setInterval[\s\S]{0,180}5_000/);
  assert.match(panel, /HERMES_SESSIONS_CHANGED_EVENT/);
  assert.match(panel, /SCHEDULES_CHANGED_EVENT/);
  for (const heading of ["Active now", "Scheduled", "Hooks"]) {
    assert.match(panel, new RegExp(`>\\s*${heading}\\s*<`));
  }
  assert.match(panel, /Nothing is running/);
  assert.match(panel, /onOpenPanel\("scheduled"\)/);
  assert.match(panel, /onOpenPanel\("hooks"\)/);
  // A live chat is only openable from the surface that can address it: the
  // Terminal opens its own chats by conversation id, and a garden-scoped panel
  // opens that garden's chats by their legacy chat-session id. Anything else is
  // listed without an Open control rather than offered and then dead.
  assert.match(panel, /run\.surface === "dashboard_terminal" \? run\.conversationId : null/);
  assert.match(
    panel,
    /if \(gardenSlug\) \{[\s\S]{0,160}run\.chatSessionId === null \? null : String\(run\.chatSessionId\)/,
  );
  assert.match(panel, /disabled=\{openableChatId\(run\) === null\}/);
});

test("a garden-scoped Processes panel shows only that garden's work", () => {
  // Agent processes belong to Breadboard as a whole rather than to a garden, so
  // a garden-scoped panel drops them instead of claiming them as its own.
  assert.match(
    panel,
    /run\.surface === "garden_chat" && run\.gardenId === gardenSlug/,
  );
  assert.match(panel, /const activeProcesses = gardenSlug \? \[\] : snapshot\.activeProcesses/);
  assert.match(panel, /snapshot\.schedules\.filter\(\(schedule\) => schedule\.gardenSlug === gardenSlug\)/);
});
