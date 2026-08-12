// The SQLite-backed Plan store (the Kaneo board model), run against an
// in-memory database.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  DEFAULT_PROJECT_NAME,
  MAX_PROJECTS_PER_USER,
  PlanError,
  PlanStore,
} from "../src/lib/plan/store.ts";
import { DEFAULT_PROJECT_COLUMNS } from "../src/lib/plan/types.ts";

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  return new PlanStore(db);
}

function seed(store, userId = 1) {
  const [project] = store.listProjectsEnsuringDefault(userId);
  return project;
}

test("a new user gets Kaneo's default project and columns", () => {
  const store = createStore();
  const projects = store.listProjectsEnsuringDefault(1);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, DEFAULT_PROJECT_NAME);

  const columns = store.listColumns(1, projects[0].id);
  assert.deepEqual(
    columns.map((column) => column.slug),
    DEFAULT_PROJECT_COLUMNS.map((column) => column.slug),
  );
  assert.equal(columns.at(-1).isFinal, true);
});

test("the default project is created once, not on every call", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  store.listProjectsEnsuringDefault(1);
  assert.equal(store.listProjects(1, { includeArchived: true }).length, 1);
});

test("task numbers are per project and render as a Kaneo-style ref", () => {
  const store = createStore();
  const project = seed(store);
  const first = store.createTask(1, { projectId: project.id, title: "First" });
  const second = store.createTask(1, { projectId: project.id, title: "Second" });

  assert.equal(first.number, 1);
  assert.equal(second.number, 2);
  assert.equal(first.ref, `${project.slug.toUpperCase()}-1`);

  const other = store.createProject(1, { name: "Side quest" });
  const third = store.createTask(1, { projectId: other.id, title: "Third" });
  assert.equal(third.number, 1, "a second project starts its own numbering");
});

test("a deleted task never gives its number back", () => {
  const store = createStore();
  const project = seed(store);
  const first = store.createTask(1, { projectId: project.id, title: "First" });
  store.deleteTask(1, first.id);
  const next = store.createTask(1, { projectId: project.id, title: "Next" });
  assert.equal(next.number, 2);
});

test("new tasks land in the first column, at the bottom", () => {
  const store = createStore();
  const project = seed(store);
  const columns = store.listColumns(1, project.id);
  const a = store.createTask(1, { projectId: project.id, title: "A" });
  const b = store.createTask(1, { projectId: project.id, title: "B" });

  assert.equal(a.columnId, columns[0].id);
  assert.equal(a.position, 0);
  assert.equal(b.position, 1);
});

test("prepend puts a card at the top and pushes the rest down", () => {
  const store = createStore();
  const project = seed(store);
  store.createTask(1, { projectId: project.id, title: "A" });
  const top = store.createTask(1, {
    projectId: project.id,
    title: "Urgent",
    prepend: true,
  });

  assert.equal(top.position, 0);
  const board = store.getBoard(1, project.id);
  assert.deepEqual(
    board.columns[0].tasks.map((task) => task.title),
    ["Urgent", "A"],
  );
});

test("moving to a final column completes the task; moving back reopens it", () => {
  const store = createStore();
  const project = seed(store);
  const columns = store.listColumns(1, project.id);
  const done = columns.find((column) => column.isFinal);
  const task = store.createTask(1, { projectId: project.id, title: "Ship it" });

  const completed = store.moveTask(1, task.id, { columnId: done.id });
  assert.ok(completed.completedAt, "landing in a final column marks it done");

  const reopened = store.moveTask(1, task.id, { columnId: columns[0].id });
  assert.equal(reopened.completedAt, null);
});

test("a move re-sequences both columns so positions stay contiguous", () => {
  const store = createStore();
  const project = seed(store);
  const [todo, progress] = store.listColumns(1, project.id);
  const a = store.createTask(1, { projectId: project.id, title: "A" });
  const b = store.createTask(1, { projectId: project.id, title: "B" });
  const c = store.createTask(1, { projectId: project.id, title: "C" });

  store.moveTask(1, b.id, { columnId: progress.id, position: 0 });

  const board = store.getBoard(1, project.id);
  const left = board.columns.find((column) => column.id === todo.id);
  const right = board.columns.find((column) => column.id === progress.id);
  assert.deepEqual(
    left.tasks.map((task) => [task.title, task.position]),
    [["A", 0], ["C", 1]],
  );
  assert.deepEqual(
    right.tasks.map((task) => [task.title, task.position]),
    [["B", 0]],
  );
  assert.ok(a.id && c.id);
});

test("a position beyond the end of a column is clamped, not rejected", () => {
  const store = createStore();
  const project = seed(store);
  const [, progress] = store.listColumns(1, project.id);
  const task = store.createTask(1, { projectId: project.id, title: "A" });
  const moved = store.moveTask(1, task.id, { columnId: progress.id, position: 99 });
  assert.equal(moved.position, 0);
});

test("one user cannot reach another user's board", () => {
  const store = createStore();
  const project = seed(store, 1);
  const task = store.createTask(1, { projectId: project.id, title: "Private" });

  assert.throws(() => store.getProject(2, project.id), PlanError);
  assert.throws(() => store.getTask(2, task.id), PlanError);
  assert.throws(
    () => store.createTask(2, { projectId: project.id, title: "Sneaky" }),
    PlanError,
  );
});

test("a card cannot be moved into another project's column", () => {
  const store = createStore();
  const project = seed(store);
  const other = store.createProject(1, { name: "Other" });
  const foreign = store.listColumns(1, other.id)[0];
  const task = store.createTask(1, { projectId: project.id, title: "A" });

  assert.throws(() => store.moveTask(1, task.id, { columnId: foreign.id }), PlanError);
});

test("deleting a column keeps its cards and re-homes them", () => {
  const store = createStore();
  const project = seed(store);
  const columns = store.listColumns(1, project.id);
  const task = store.createTask(1, {
    projectId: project.id,
    title: "Survivor",
    columnId: columns[1].id,
  });

  store.deleteColumn(1, columns[1].id);

  const moved = store.getTask(1, task.id);
  assert.equal(moved.columnId, columns[0].id);
  assert.equal(store.listColumns(1, project.id).length, 3);
});

test("marking a column final completes the cards already in it", () => {
  const store = createStore();
  const project = seed(store);
  const columns = store.listColumns(1, project.id);
  const task = store.createTask(1, {
    projectId: project.id,
    title: "Was in review",
    columnId: columns[2].id,
  });
  assert.equal(task.completedAt, null);

  store.updateColumn(1, columns[2].id, { isFinal: true });
  assert.ok(store.getTask(1, task.id).completedAt);
});

test("labels attach, detach and survive a task update", () => {
  const store = createStore();
  const project = seed(store);
  const bug = store.createLabel(1, { name: "bug" });
  const chore = store.createLabel(1, { name: "chore" });

  const task = store.createTask(1, {
    projectId: project.id,
    title: "A",
    labelIds: [bug.id, chore.id],
  });
  assert.deepEqual(task.labels.map((label) => label.name), ["bug", "chore"]);

  const retitled = store.updateTask(1, task.id, { title: "B" });
  assert.equal(retitled.labels.length, 2, "an unrelated edit keeps the labels");

  const relabelled = store.updateTask(1, task.id, { labelIds: [bug.id] });
  assert.deepEqual(relabelled.labels.map((label) => label.name), ["bug"]);
});

test("a label from another user is ignored rather than attached", () => {
  const store = createStore();
  const project = seed(store, 1);
  store.listProjectsEnsuringDefault(2);
  const theirs = store.createLabel(2, { name: "theirs" });

  const task = store.createTask(1, {
    projectId: project.id,
    title: "A",
    labelIds: [theirs.id],
  });
  assert.equal(task.labels.length, 0);
});

test("creating a label twice returns the existing one", () => {
  const store = createStore();
  const first = store.createLabel(1, { name: "bug" });
  const second = store.createLabel(1, { name: "bug" });
  assert.equal(first.id, second.id);
});

test("queries filter by text, due date, priority and doneness", () => {
  const store = createStore();
  const project = seed(store);
  const done = store.listColumns(1, project.id).find((column) => column.isFinal);

  store.createTask(1, {
    projectId: project.id,
    title: "Write the report",
    dueDate: "2026-08-10",
    priority: "high",
  });
  store.createTask(1, {
    projectId: project.id,
    title: "Book a flight",
    dueDate: "2026-09-01",
  });
  const finished = store.createTask(1, { projectId: project.id, title: "Old thing" });
  store.moveTask(1, finished.id, { columnId: done.id });

  assert.equal(store.queryTasks(1, { text: "report" }).length, 1);
  assert.equal(store.queryTasks(1, { priority: "high" }).length, 1);
  assert.equal(store.queryTasks(1, { dueTo: "2026-08-31" }).length, 1);
  assert.equal(store.queryTasks(1, {}).length, 2, "done cards are hidden by default");
  assert.equal(store.queryTasks(1, { includeDone: true }).length, 3);
});

test("a LIKE wildcard in the search text is matched literally", () => {
  const store = createStore();
  const project = seed(store);
  store.createTask(1, { projectId: project.id, title: "100% done" });
  store.createTask(1, { projectId: project.id, title: "unrelated" });

  assert.equal(store.queryTasks(1, { text: "100%" }).length, 1);
  assert.equal(store.queryTasks(1, { text: "%" }).length, 1, "% is not a wildcard here");
});

test("the query limit is capped for ordinary callers but not for the board", () => {
  const store = createStore();
  const project = seed(store);
  for (let index = 0; index < 250; index += 1) {
    store.createTask(1, { projectId: project.id, title: `Task ${index}` });
  }
  assert.equal(store.queryTasks(1, { limit: 5_000 }).length, 200);
  assert.equal(store.getBoard(1, project.id).columns[0].tasks.length, 250);
});

test("a source card is upserted, not duplicated", () => {
  const store = createStore();
  const project = seed(store);
  const first = store.upsertSourceTask(1, {
    projectId: project.id,
    title: "Deep research: tariffs",
    source: "agent_run",
    sourceRef: "run-42",
    sourceUrl: "/dashboard?run=42",
  });
  const second = store.upsertSourceTask(1, {
    projectId: project.id,
    title: "Deep research: tariffs (done)",
    source: "agent_run",
    sourceRef: "run-42",
  });

  assert.equal(first.id, second.id);
  assert.equal(second.title, "Deep research: tariffs (done)");
  assert.equal(second.sourceUrl, "/dashboard?run=42", "an absent url keeps the old one");
  assert.equal(store.queryTasks(1, {}).length, 1);
});

test("relations are written in both directions and removed in both", () => {
  const store = createStore();
  const project = seed(store);
  const a = store.createTask(1, { projectId: project.id, title: "A" });
  const b = store.createTask(1, { projectId: project.id, title: "B" });

  store.addRelation(1, a.id, b.id, "blocks");
  const forward = store.listRelations(1, a.id);
  const backward = store.listRelations(1, b.id);
  assert.equal(forward[0].relationType, "blocks");
  assert.equal(backward[0].relationType, "blocked_by");
  assert.equal(backward[0].relatedRef, a.ref);

  store.deleteRelation(1, forward[0].id);
  assert.equal(store.listRelations(1, a.id).length, 0);
  assert.equal(store.listRelations(1, b.id).length, 0);
});

test("a task cannot relate to itself", () => {
  const store = createStore();
  const project = seed(store);
  const a = store.createTask(1, { projectId: project.id, title: "A" });
  assert.throws(() => store.addRelation(1, a.id, a.id, "blocks"), PlanError);
});

test("comments record who wrote them and count on the card", () => {
  const store = createStore();
  const project = seed(store);
  const task = store.createTask(1, { projectId: project.id, title: "A" });

  store.addComment(1, task.id, "Looks good", "user");
  store.addComment(1, task.id, "Filed the follow-up", "assistant");

  const comments = store.listComments(1, task.id);
  assert.deepEqual(comments.map((comment) => comment.author), ["user", "assistant"]);
  assert.equal(store.getTask(1, task.id).commentCount, 2);
});

test("an invalid date is refused with a message that says what to fix", () => {
  const store = createStore();
  const project = seed(store);
  assert.throws(
    () => store.createTask(1, { projectId: project.id, title: "A", dueDate: "next tuesday" }),
    /date like 2026-08-14/,
  );
});

test("a start date after the due date is refused", () => {
  const store = createStore();
  const project = seed(store);
  assert.throws(
    () =>
      store.createTask(1, {
        projectId: project.id,
        title: "A",
        startDate: "2026-08-20",
        dueDate: "2026-08-10",
      }),
    PlanError,
  );
});

test("project slugs stay unique per user", () => {
  const store = createStore();
  const first = store.createProject(1, { name: "Home lab" });
  const second = store.createProject(1, { name: "Home lab" });
  assert.notEqual(first.slug, second.slug);
  assert.equal(first.slug, "home-lab");
  assert.equal(second.slug, "home-lab-2");
});

test("the project cap is enforced", () => {
  const store = createStore();
  for (let index = 0; index < MAX_PROJECTS_PER_USER; index += 1) {
    store.createProject(1, { name: `Project ${index}` });
  }
  assert.throws(() => store.createProject(1, { name: "One too many" }), PlanError);
});

test("project summaries count open and overdue work", () => {
  const store = createStore();
  const project = seed(store);
  const done = store.listColumns(1, project.id).find((column) => column.isFinal);

  store.createTask(1, { projectId: project.id, title: "Overdue", dueDate: "2000-01-01" });
  store.createTask(1, { projectId: project.id, title: "Later", dueDate: "2999-01-01" });
  const finished = store.createTask(1, {
    projectId: project.id,
    title: "Finished",
    dueDate: "2000-01-01",
  });
  store.moveTask(1, finished.id, { columnId: done.id });

  const [summary] = store.listProjects(1);
  assert.equal(summary.taskCount, 3);
  assert.equal(summary.openCount, 2);
  assert.equal(summary.overdueCount, 1, "a completed card is never overdue");
});

test("archiving hides a project from the default listing", () => {
  const store = createStore();
  const project = seed(store);
  store.updateProject(1, project.id, { archived: true });
  assert.equal(store.listProjects(1).length, 0);
  assert.equal(store.listProjects(1, { includeArchived: true }).length, 1);
});

test("deleting a project takes its columns, tasks and comments with it", () => {
  const store = createStore();
  const project = seed(store);
  const task = store.createTask(1, { projectId: project.id, title: "A" });
  store.addComment(1, task.id, "note");

  store.deleteProject(1, project.id);

  assert.throws(() => store.getTask(1, task.id), PlanError);
  assert.equal(store.listProjects(1, { includeArchived: true }).length, 0);
});
