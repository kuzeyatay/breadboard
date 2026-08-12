// The Plan board, wired as agent tools.
//
// Same two halves as the world-monitor/calendar suite. The wiring half guards
// the failure this repo has hit before: a tool wired on the Breadboard side but
// never registered with the runtime, so the model is never offered it. The
// behaviour half runs the agent query layer for real against an in-memory
// database.
//
// The boundary this one has to hold is different from the calendar's. Plan
// *does* write — that is the point of it — so the assertion is not "no writes"
// but "no destruction": nothing here may reach a delete.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { PLAN_TOOLS, PLAN_WRITE_TOOLS, allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import { PlanStore } from "../src/lib/plan/store.ts";
import {
  board,
  commentTask,
  createTask,
  getTask,
  listProjects,
  moveTask,
  searchTasks,
  upcoming,
  updateTask,
} from "../src/lib/plan/agent-query.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return new PlanStore(db);
}

// ── wiring ──────────────────────────────────────────────────────────────────

test("the family exposes exactly the intended tools", () => {
  assert.deepEqual([...PLAN_TOOLS].sort(), [
    "plan_board",
    "plan_comment_task",
    "plan_create_task",
    "plan_get_task",
    "plan_list_projects",
    "plan_move_task",
    "plan_search_tasks",
    "plan_upcoming",
    "plan_update_task",
  ]);
  assert.deepEqual([...PLAN_WRITE_TOOLS].sort(), [
    "plan_comment_task",
    "plan_create_task",
    "plan_move_task",
    "plan_update_task",
  ]);
});

test("nothing here can destroy: the route reaches no delete", () => {
  for (const tool of PLAN_TOOLS) {
    assert.ok(!tool.includes("delete"), `${tool} must not expose a delete`);
    assert.ok(!tool.includes("archive"), `${tool} must not expose an archive`);
  }
  // The route is the only thing that decides which store methods are reachable,
  // so it is what has to be free of them rather than the names.
  const route = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "plan", "route.ts"),
    "utf8",
  );
  for (const method of [
    "deleteTask",
    "deleteProject",
    "deleteColumn",
    "deleteLabel",
    "deleteComment",
    "deleteRelation",
    "updateProject",
    "updateColumn",
  ]) {
    assert.ok(!route.includes(method), `the plan tool route must not reach ${method}`);
  }
});

test("the agent query layer exports no destructive function at all", async () => {
  const agentQuery = await import("../src/lib/plan/agent-query.ts");
  for (const name of Object.keys(agentQuery)) {
    assert.ok(
      !/^(delete|remove|archive|purge|drop)/.test(name),
      `agent-query must not export ${name}`,
    );
  }
});

test("Quartz AI never receives them; the authenticated surfaces do", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of PLAN_TOOLS) {
    assert.ok(!quartz.includes(tool), `quartz_ai must not receive ${tool}`);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of PLAN_TOOLS) {
      assert.ok(allowed.includes(tool), `${surface} should receive ${tool}`);
    }
  }
});

test("every tool is brokered, so none can be inherited by default", () => {
  for (const tool of PLAN_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} must be in BROKERED_TOOLS`);
  }
});

test("every tool is registered with the runtime, in all three places", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const manifestEntries = manifest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  for (const tool of PLAN_TOOLS) {
    assert.ok(manifestEntries.includes(tool), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
  }

  assert.ok(plugin.includes('"/api/hermes/tools/plan"'), "plan has no route in the plugin");
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "plan", "route.ts"),
    ),
    "the route the plugin posts to must exist",
  );

  // An unrecognized route_kind falls through to a premortem-shaped payload the
  // route does not understand, which would fail only at call time.
  assert.match(
    plugin,
    // Membership, not the exact set: other families join this branch over time,
    // and pinning the whole list makes an unrelated addition fail here.
    /route_kind in \{[^}]*"plan"[^}]*\}/,
    "plan must produce the {tool, args} payload its route reads",
  );
});

test("the skill resolves ready on the authenticated surfaces, and not on Quartz", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find((entry) => entry.slug === "plan");
    assert.ok(skill, `plan missing on ${surface}`);
    assert.equal(skill.availability, "ready", `plan not ready on ${surface}`);
    assert.equal(skill.category, "Prebuilt");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [...PLAN_TOOLS]);
  }
  assert.equal(
    listFirstPartySkills("quartz_ai").some(
      (skill) => skill.slug === "plan" && skill.availability === "ready",
    ),
    false,
    "plan must not be ready on quartz_ai",
  );
});

test("the plan skill states the boundary it cannot cross", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-skills", "prebuilt", "plan", "SKILL.md"),
    "utf8",
  );
  assert.match(manifest, /cannot destroy anything|no tool that deletes/i);
});

// ── behaviour ───────────────────────────────────────────────────────────────

test("projects and columns are addressed by name, never by id", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const listed = listProjects(store, 1);

  assert.equal(listed.projects.length, 1);
  assert.deepEqual(listed.projects[0].columns, [
    "To Do",
    "In Progress",
    "In Review",
    "Done",
  ]);
  const serialized = JSON.stringify(listed);
  assert.ok(!serialized.includes('"id"'), "no raw row ids should reach the model");
});

test("a single project need not be named; several must be", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  assert.ok(board(store, 1, {}).project, "one project is unambiguous");

  store.createProject(1, { name: "Side quest" });
  assert.throws(() => board(store, 1, {}), /Name the project/);
  assert.equal(board(store, 1, { project: "Side quest" }).project, "Side quest");
});

test("an unknown project or column says what does exist", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  assert.throws(() => board(store, 1, { project: "Nonsense" }), /no project called "Nonsense"/);
  assert.throws(
    () => createTask(store, 1, { title: "A", column: "Backlog" }),
    /not a column of .*Its columns are: To Do, In Progress, In Review, Done/,
  );
});

test("a created card is marked as filed by the assistant", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const { created } = createTask(store, 1, { title: "Chase the visa", due: "2026-09-01" });

  assert.equal(created.filedBy, "assistant");
  assert.equal(created.column, "To Do");
  assert.equal(created.due, "2026-09-01");
  assert.match(created.ref, /^PERSONAL-\d+$/);
});

test("cards are found again by the ref the board shows", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const { created } = createTask(store, 1, { title: "Chase the visa" });

  const fetched = getTask(store, 1, { ref: created.ref.toLowerCase() });
  assert.equal(fetched.task.title, "Chase the visa");
  assert.throws(() => getTask(store, 1, { ref: "NOPE-1" }), /no card NOPE-1/);
  assert.throws(() => getTask(store, 1, { ref: "not a ref" }), /not a card ref/);
});

test("moving to the final column is what marks work done", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const { created } = createTask(store, 1, { title: "Ship it" });

  const { moved } = moveTask(store, 1, { ref: created.ref, column: "Done" });
  assert.equal(moved.done, true);
  assert.equal(moved.column, "Done");

  const reopened = moveTask(store, 1, { ref: created.ref, column: "in-progress" });
  assert.equal(reopened.moved.done, false, "a column slug works as well as its name");
});

test("update touches only the fields it is given, and cannot finish work", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const { created } = createTask(store, 1, {
    title: "Draft the letter",
    notes: "for the landlord",
    priority: "high",
  });

  const { updated } = updateTask(store, 1, { ref: created.ref, priority: "urgent" });
  assert.equal(updated.priority, "urgent");
  assert.equal(updated.title, "Draft the letter", "an unnamed field is left alone");
  assert.equal(updated.notes, "for the landlord");
  assert.equal(updated.done, false, "update has no way to complete a card");
});

test("upcoming separates overdue from what is merely due", () => {
  const store = createStore();
  const [project] = store.listProjectsEnsuringDefault(1);
  const today = new Date().toISOString().slice(0, 10);
  store.createTask(1, { projectId: project.id, title: "Late thing", dueDate: "2000-01-01" });
  store.createTask(1, { projectId: project.id, title: "Today thing", dueDate: today });
  store.createTask(1, { projectId: project.id, title: "Far thing", dueDate: "2999-01-01" });

  const result = upcoming(store, 1, { days: 7 });
  assert.deepEqual(result.overdue.map((task) => task.title), ["Late thing"]);
  assert.deepEqual(result.upcoming.map((task) => task.title), ["Today thing"]);
  assert.equal(result.today, today);
});

test("search matches title and notes, and hides finished work by default", () => {
  const store = createStore();
  const [project] = store.listProjectsEnsuringDefault(1);
  const done = store.listColumns(1, project.id).find((column) => column.isFinal);
  store.createTask(1, { projectId: project.id, title: "Renew insurance" });
  const finished = store.createTask(1, {
    projectId: project.id,
    title: "Old insurance thing",
  });
  store.moveTask(1, finished.id, { columnId: done.id });

  assert.equal(searchTasks(store, 1, { text: "insurance" }).count, 1);
  assert.equal(searchTasks(store, 1, { text: "insurance", includeDone: true }).count, 2);
});

test("an assistant comment is attributed to the assistant", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const { created } = createTask(store, 1, { title: "Look into it" });

  commentTask(store, 1, { ref: created.ref, content: "Found the form, link in notes." });
  const { comments } = getTask(store, 1, { ref: created.ref });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].author, "assistant");
});

test("one user's tools never reach another user's board", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  const { created } = createTask(store, 1, { title: "Private" });

  store.listProjectsEnsuringDefault(2);
  assert.throws(() => getTask(store, 2, { ref: created.ref }), /no card/);
  assert.throws(() => moveTask(store, 2, { ref: created.ref, column: "Done" }), /no card/);
});

test("long notes are truncated before they reach a turn's context", () => {
  const store = createStore();
  const [project] = store.listProjectsEnsuringDefault(1);
  store.createTask(1, {
    projectId: project.id,
    title: "Wall of text",
    description: "x".repeat(2_000),
  });

  const [task] = searchTasks(store, 1, {}).tasks;
  assert.ok(task.notes.length < 500, "the board view truncates");
  assert.ok(task.notes.endsWith("…"));
});
