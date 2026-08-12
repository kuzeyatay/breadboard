// Long-running work filing itself onto the Plan board.
//
// Run against an in-memory database by handing the tracker its own store, which
// is also how the production hooks stay off a test's board: they only fire when
// the caller is using the real application database.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  AGENT_PROJECT_NAME,
  agentKindLabel,
  isAgentTrackingEnabled,
  trackAgentRunFinished,
  trackAgentRunStarted,
  trackScheduledChatFinished,
  trackScheduledChatStarted,
} from "../src/lib/plan/agent-tracking.ts";
import { PlanStore } from "../src/lib/plan/store.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function createStore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com');
  `);
  return new PlanStore(db);
}

function trackingCards(store, userId = 1) {
  const project = store
    .listProjects(userId, { includeArchived: true })
    .find((candidate) => candidate.name === AGENT_PROJECT_NAME);
  if (!project) return [];
  return store.getBoard(userId, project.id).columns.flatMap((column) =>
    column.tasks.map((task) => ({ ...task, column: column.name })),
  );
}

test("tracking is on unless it is switched off", () => {
  assert.equal(isAgentTrackingEnabled({}), true);
  assert.equal(isAgentTrackingEnabled({ PLAN_TRACK_AGENT_RUNS: "1" }), true);
  assert.equal(isAgentTrackingEnabled({ PLAN_TRACK_AGENT_RUNS: "off" }), false);
  assert.equal(isAgentTrackingEnabled({ PLAN_TRACK_AGENT_RUNS: "false" }), false);
});

test("the tracking project does not exist until something is filed", () => {
  const store = createStore();
  store.listProjectsEnsuringDefault(1);
  assert.equal(
    store.listProjects(1).some((project) => project.name === AGENT_PROJECT_NAME),
    false,
  );

  trackAgentRunStarted({ userId: 1, kind: "deep_research", runId: "r1", task: "tariffs" }, store);
  assert.ok(store.listProjects(1).some((project) => project.name === AGENT_PROJECT_NAME));
});

test("a started run becomes an in-progress card with a readable title", () => {
  const store = createStore();
  trackAgentRunStarted(
    {
      userId: 1,
      kind: "deep_research",
      runId: "r1",
      task: "the 2026 tariff schedule",
      conversationTitle: "Trade questions",
    },
    store,
  );

  const [card] = trackingCards(store);
  assert.equal(card.title, "Deep research: the 2026 tariff schedule");
  assert.equal(card.column, "In Progress");
  assert.equal(card.source, "agent_run");
  assert.equal(card.sourceRef, "r1");
  assert.match(card.description, /Trade questions/);
});

test("a run without a task still gets a card named after the agent", () => {
  const store = createStore();
  trackAgentRunStarted({ userId: 1, kind: "money_printer", runId: "r1" }, store);
  assert.equal(trackingCards(store)[0].title, "Money printer");
});

test("an unknown agent kind is de-underscored rather than shown raw", () => {
  assert.equal(agentKindLabel("brand_new_agent"), "brand new agent");
  assert.equal(agentKindLabel("deep_research"), "Deep research");
});

test("the same run reported twice updates one card", () => {
  const store = createStore();
  trackAgentRunStarted({ userId: 1, kind: "codex", runId: "r1", task: "first" }, store);
  trackAgentRunStarted({ userId: 1, kind: "codex", runId: "r1", task: "second" }, store);

  const cards = trackingCards(store);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "Codex: second");
});

test("a completed run lands in Done without repeating its answer", () => {
  const store = createStore();
  trackAgentRunStarted({ userId: 1, kind: "codex", runId: "r1", task: "refactor" }, store);
  trackAgentRunFinished({ userId: 1, runId: "r1", outcome: "completed" }, store);

  const [card] = trackingCards(store);
  assert.equal(card.column, "Done");
  assert.ok(card.completedAt);
  assert.equal(card.commentCount, 0, "the transcript already holds the answer");
});

test("a failed run goes where work that needs a person goes, with the reason", () => {
  const store = createStore();
  trackAgentRunStarted({ userId: 1, kind: "vimax", runId: "r1", task: "the film" }, store);
  trackAgentRunFinished(
    { userId: 1, runId: "r1", outcome: "failed", summary: "ffmpeg exited with 1" },
    store,
  );

  const [card] = trackingCards(store);
  assert.equal(card.column, "In Review");
  assert.equal(card.completedAt, null, "a failure is not done");

  const project = store
    .listProjects(1)
    .find((candidate) => candidate.name === AGENT_PROJECT_NAME);
  const [comment] = store.listComments(1, store.getBoard(1, project.id).columns
    .flatMap((column) => column.tasks)[0].id);
  assert.equal(comment.author, "assistant");
  assert.match(comment.content, /ffmpeg exited with 1/);
});

test("an aborted run is recorded even with nothing to say about it", () => {
  const store = createStore();
  trackAgentRunStarted({ userId: 1, kind: "ruflo", runId: "r1", task: "swarm" }, store);
  trackAgentRunFinished({ userId: 1, runId: "r1", outcome: "aborted" }, store);

  const [card] = trackingCards(store);
  assert.equal(card.column, "In Review");
  assert.equal(card.commentCount, 1);
});

test("finishing a run nobody watched start invents nothing", () => {
  const store = createStore();
  trackAgentRunFinished({ userId: 1, runId: "never-started", outcome: "completed" }, store);
  assert.deepEqual(trackingCards(store), []);
});

test("each firing of a schedule is its own card", () => {
  const store = createStore();
  trackScheduledChatStarted(
    { userId: 1, jobId: 7, runId: "schedule-7-monday", title: "Morning briefing" },
    store,
  );
  trackScheduledChatFinished({ userId: 1, runId: "schedule-7-monday", outcome: "completed" }, store);
  trackScheduledChatStarted(
    { userId: 1, jobId: 7, runId: "schedule-7-tuesday", title: "Morning briefing" },
    store,
  );

  const cards = trackingCards(store);
  assert.equal(cards.length, 2, "a daily job reads as a day's work each time");
  assert.equal(cards.filter((card) => card.column === "Done").length, 1);
  assert.equal(cards[0].title, "Scheduled: Morning briefing");
  assert.equal(cards[0].source, "schedule");
});

test("a failed schedule keeps the reason it did not fire", () => {
  const store = createStore();
  trackScheduledChatStarted(
    { userId: 1, jobId: 7, runId: "schedule-7-x", title: "Briefing" },
    store,
  );
  trackScheduledChatFinished(
    {
      userId: 1,
      runId: "schedule-7-x",
      outcome: "failed",
      summary: "The prompt needs a permission decision.",
    },
    store,
  );

  const [card] = trackingCards(store);
  assert.equal(card.column, "In Review");
  assert.equal(card.commentCount, 1);
});

test("a tracking failure never reaches the run that caused it", () => {
  const broken = {
    listProjects() {
      throw new Error("the database is gone");
    },
  };
  // Swallowed, logged, and the caller carries on: bookkeeping must not be able
  // to take down the work it is bookkeeping about.
  assert.doesNotThrow(() =>
    trackAgentRunStarted({ userId: 1, kind: "codex", runId: "r1" }, broken),
  );
  assert.doesNotThrow(() =>
    trackAgentRunFinished({ userId: 1, runId: "r1", outcome: "completed" }, broken),
  );
});

test("the hooks fire only on the real application database", () => {
  // Both call sites guard on the injected handle being the app's own, so a test
  // that passes its own database never writes to the developer's board.
  const turns = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "conversations", "external-agent-turns.ts"),
    "utf8",
  );
  assert.match(turns, /outcome === "running" && database === db/);
  assert.match(turns, /if \(!replayed && database === db\)/);
  assert.match(turns, /trackAgentRunStarted\(/);
  assert.match(turns, /trackAgentRunFinished\(/);

  const runner = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "schedules", "runner.ts"),
    "utf8",
  );
  assert.match(runner, /trackScheduledChatStarted\(/);
  assert.match(runner, /trackScheduledChatFinished\(/);
});
