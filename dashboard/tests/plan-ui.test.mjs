// Focused UI contracts for Plan's two compact workspace controls.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const client = source("../src/app/plan/plan-client.tsx");
const board = source("../src/app/plan/plan-board.tsx");
const calendar = source("../src/app/plan/calendar/calendar-client.tsx");
const calendarViews = source("../src/app/plan/calendar/calendar-views.tsx");
const taskPanel = source("../src/app/plan/plan-task-panel.tsx");

test("the projects navigation can be closed and reopened from the persistent toolbar", () => {
  assert.match(client, /const \[projectsNavOpen, setProjectsNavOpen\] = useState\(true\)/);
  assert.match(client, /onClick=\{\(\) => setProjectsNavOpen\(\(open\) => !open\)\}/);
  assert.match(client, /aria-controls="plan-projects-navigation"/);
  assert.match(client, /aria-expanded=\{projectsNavOpen\}/);
  assert.match(
    client,
    /aria-label=\{projectsNavOpen \? "Close projects navigation" : "Open projects navigation"\}/,
  );
  assert.match(client, /\{projectsNavOpen && \(\s*<aside\s+id="plan-projects-navigation"/);
});

test("the new-card editor leaves room above its external focus outline", () => {
  assert.match(
    board,
    /className="min-h-0 flex-1 space-y-1\.5 overflow-y-auto px-2 pb-2 pt-1"/,
  );
  assert.match(board, /placeholder="What needs doing\?"/);
});

test("the board offers persistent daily, monthly and yearly scopes", () => {
  assert.match(client, /PLAN_BOARD_SCOPES\.map/);
  assert.match(client, /all: "All"/);
  assert.match(client, /day: "Daily"/);
  assert.match(client, /month: "Monthly"/);
  assert.match(client, /year: "Yearly"/);
  assert.match(client, /url\.searchParams\.set\("boardScope", boardScope\)/);
  assert.match(client, /undated cards included/);
});

test("task references stay out of every visible Plan surface", () => {
  assert.doesNotMatch(board, /task\.ref|task\.number/);
  assert.doesNotMatch(calendarViews, /task\.ref/);
  assert.doesNotMatch(taskPanel, /task\.ref|relation\.relatedRef/);
  assert.match(calendarViews, /\{task\.title\}/);
});

test("the embedded calendar preserves Plan's top-level view in the URL", () => {
  assert.match(calendar, /url\.searchParams\.set\("calendarView", view\)/);
  assert.doesNotMatch(calendar, /url\.searchParams\.set\("view", view\)/);
  assert.match(calendar, /onAnchorChange\?\.\(anchor\)/);
});
