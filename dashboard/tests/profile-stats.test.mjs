// The profile page's aggregation, run against an in-memory database.
//
// The interesting cases are the ones a naive COUNT(*) gets wrong: an agent run
// is stamped on two messages, a streak has to survive "today isn't over yet",
// and the activity grid has to stay rectangular.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  DEFAULT_ACTIVITY_WEEKS,
  agentLabel,
  readProfileStats,
} from "../src/lib/profile/stats.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, email TEXT, created_at TEXT
    );
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, slug TEXT
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT,
      default_garden_id INTEGER, created_at TEXT,
      temporary INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, surface TEXT,
      status TEXT, metadata TEXT, token_usage TEXT, created_at TEXT
    );
    CREATE TABLE hermes_artifacts (
      id TEXT PRIMARY KEY, user_id INTEGER, kind TEXT, status TEXT,
      title TEXT DEFAULT 'An artifact', created_at TEXT DEFAULT '2026-06-01 08:00:00'
    );
    CREATE TABLE durable_memories (
      id INTEGER PRIMARY KEY, user_id INTEGER, state TEXT,
      kind TEXT DEFAULT 'preference', content TEXT DEFAULT 'Something',
      created_at TEXT DEFAULT '2026-06-01 08:00:00'
    );
    CREATE TABLE invite_codes (
      id INTEGER PRIMARY KEY, created_by_user_id INTEGER, used_at TEXT
    );
    CREATE TABLE scheduled_chat_jobs (
      id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT,
      last_run_at TEXT, last_status TEXT
    );
  `);
  db.prepare("INSERT INTO users (id, username, email, created_at) VALUES (?, ?, ?, ?)").run(
    1,
    "kuzey",
    "kuzey@example.com",
    "2026-01-01T09:00:00.000Z",
  );
  db.prepare("INSERT INTO users (id, username, email, created_at) VALUES (?, ?, ?, ?)").run(
    2,
    "someone-else",
    "other@example.com",
    "2026-01-01 09:00:00",
  );
  return db;
}

let nextMessageId = 1;

/** A message at a fixed local wall-clock time, stored the way the app stores it. */
function addMessage(
  db,
  conversationId,
  { role, at, surface = "garden_chat", metadata, usage, status = "complete" },
) {
  db.prepare(
    `INSERT INTO conversation_messages
       (id, conversation_id, role, surface, status, metadata, token_usage, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nextMessageId++,
    conversationId,
    role,
    surface,
    status,
    metadata ? JSON.stringify(metadata) : null,
    usage ? JSON.stringify(usage) : null,
    // Written as UTC with no offset so 'localtime' is the only conversion in play.
    at,
  );
}

function addConversation(db, id, { userId = 1, title = "A chat", gardenId = null, at = "2026-06-01 08:00:00" } = {}) {
  db.prepare(
    "INSERT INTO conversations (id, user_id, title, default_garden_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, title, gardenId, at);
}

// ------------------------------------------------------------------ account

test("the account block reports the age of the account, not of the data", () => {
  const db = createDatabase();
  const stats = readProfileStats(db, 1, { today: "2026-01-31" });

  assert.equal(stats.account.username, "kuzey");
  assert.equal(stats.account.email, "kuzey@example.com");
  assert.equal(stats.account.daysSinceJoined, 30);
});

test("a space-separated created_at is read the same as an ISO one", () => {
  const db = createDatabase();
  assert.equal(readProfileStats(db, 2, { today: "2026-01-31" }).account.daysSinceJoined, 30);
});

test("an unknown user is an error rather than an empty profile", () => {
  const db = createDatabase();
  assert.throws(() => readProfileStats(db, 99), /No such user/);
});

// ------------------------------------------------------------------- totals

test("totals count only the signed-in user's own rows", () => {
  const db = createDatabase();
  addConversation(db, 1, { userId: 1 });
  addConversation(db, 2, { userId: 2 });
  addMessage(db, 1, { role: "user", at: "2026-06-01 08:00:00" });
  addMessage(db, 1, { role: "assistant", at: "2026-06-01 08:01:00", usage: { totalTokens: 500, responseDurationMs: 90_000 } });
  addMessage(db, 2, { role: "user", at: "2026-06-01 08:00:00" });

  db.prepare("INSERT INTO clusters (id, user_id, name, slug) VALUES (1, 1, 'Physics', 'physics')").run();
  db.prepare("INSERT INTO clusters (id, user_id, name, slug) VALUES (2, 2, 'Theirs', 'theirs')").run();
  db.prepare("INSERT INTO hermes_artifacts (id, user_id, kind, status) VALUES ('a', 1, 'pdf', 'ready')").run();
  db.prepare("INSERT INTO hermes_artifacts (id, user_id, kind, status) VALUES ('b', 1, 'pdf', 'archived')").run();
  db.prepare("INSERT INTO hermes_artifacts (id, user_id, kind, status) VALUES ('c', 2, 'pdf', 'ready')").run();
  db.prepare("INSERT INTO durable_memories (id, user_id, state) VALUES (1, 1, 'confirmed'), (2, 1, 'superseded')").run();
  db.prepare("INSERT INTO invite_codes (id, created_by_user_id, used_at) VALUES (1, 1, NULL), (2, 1, '2026-06-02'), (3, 2, NULL)").run();

  const stats = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.equal(stats.totals.conversations, 1);
  assert.equal(stats.totals.prompts, 1);
  assert.equal(stats.totals.replies, 1);
  assert.equal(stats.totals.gardens, 1);
  assert.equal(stats.totals.artifacts, 1, "archived artifacts are not achievements");
  assert.equal(stats.totals.memories, 1, "superseded memories are forgotten, not counted");
  assert.equal(stats.totals.tokens, 500);
  assert.equal(stats.totals.thinkingMs, 90_000);
  assert.equal(stats.totals.measuredReplies, 1);
  assert.deepEqual(stats.invites, { created: 2, redeemed: 1, open: 1 });
});

test("a temporary chat is not counted or named here either", () => {
  const db = createDatabase();
  addConversation(db, 1, { userId: 1, title: "Kept", at: "2026-06-01 08:00:00" });
  db.prepare(
    "INSERT INTO conversations (id, user_id, title, default_garden_id, created_at, temporary) VALUES (2, 1, 'Off record', NULL, '2026-01-02 08:00:00', 1)",
  ).run();

  const stats = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.equal(stats.totals.conversations, 1);
  // The oldest row is the temporary one, and it must not become "your first
  // conversation" on a page the chat itself never appears on.
  assert.equal(stats.firstConversation?.title, "Kept");
});

// -------------------------------------------------------------- agent runs

test("an agent run is counted once even though it marks two messages", () => {
  const db = createDatabase();
  addConversation(db, 1);
  // The prompt carries the run while it is in flight...
  addMessage(db, 1, {
    role: "user",
    at: "2026-06-01 10:00:00",
    metadata: { externalAgentRun: { kind: "deep_research", runId: "r1" }, externalAgentOutcome: "running" },
  });
  // ...and the reply carries the same run's result.
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 10:05:00",
    metadata: { externalAgentRun: { kind: "deep_research", runId: "r1" }, externalAgentOutcome: "completed" },
  });
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 11:05:00",
    metadata: { externalAgentRun: { kind: "deep_research", runId: "r2" }, externalAgentOutcome: "failed" },
  });

  const stats = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.equal(stats.totals.agentRuns, 2);
  assert.deepEqual(stats.agents, [
    { kind: "deep_research", label: "Deep Research", runs: 2, completed: 1, failed: 1 },
  ]);
});

test("a run whose reply has not landed yet still counts, once", () => {
  const db = createDatabase();
  addConversation(db, 1);
  addMessage(db, 1, {
    role: "user",
    at: "2026-06-01 10:00:00",
    metadata: { externalAgentRun: { kind: "vimax", runId: "r1" }, externalAgentOutcome: "running" },
  });

  const stats = readProfileStats(db, 1, { today: "2026-06-01" });
  assert.deepEqual(stats.agents, [
    { kind: "vimax", label: "ViMax", runs: 1, completed: 0, failed: 0 },
  ]);
});

test("a retired agent slug keeps its successor's name", () => {
  assert.equal(agentLabel("postiz"), "Socials Manager");
  assert.equal(agentLabel("socials_manager"), "Socials Manager");
  assert.equal(agentLabel("some_new_agent"), "Some New Agent", "and an unknown one stays readable");
});

// ----------------------------------------------------------------- streaks

test("streaks measure consecutive days and survive a day that is not over", () => {
  const db = createDatabase();
  addConversation(db, 1);
  for (const day of ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-10", "2026-05-11"]) {
    addMessage(db, 1, { role: "user", at: `${day} 12:00:00` });
  }

  // "Today" is the day after the last entry: the run is still alive.
  const alive = readProfileStats(db, 1, { today: "2026-05-12" }).streaks;
  assert.equal(alive.daysActive, 5);
  assert.equal(alive.longestStreak, 3);
  assert.equal(alive.currentStreak, 2);
  assert.equal(alive.firstActiveDay, "2026-05-01");

  // Two days later it has been missed.
  const broken = readProfileStats(db, 1, { today: "2026-05-13" }).streaks;
  assert.equal(broken.currentStreak, 0);
  assert.equal(broken.longestStreak, 3, "the record stands");
});

test("an account with no prompts reports zeroes rather than nulls in the counters", () => {
  const db = createDatabase();
  const stats = readProfileStats(db, 1, { today: "2026-05-13" });

  assert.deepEqual(stats.streaks, {
    daysActive: 0,
    currentStreak: 0,
    longestStreak: 0,
    busiestDay: null,
    firstActiveDay: null,
  });
  assert.equal(stats.habit.peakHour, null);
  assert.equal(stats.totals.tokens, 0);
  assert.equal(stats.firstConversation, null);
});

test("the busiest day is the one with the most prompts", () => {
  const db = createDatabase();
  addConversation(db, 1);
  addMessage(db, 1, { role: "user", at: "2026-05-01 12:00:00" });
  addMessage(db, 1, { role: "user", at: "2026-05-02 12:00:00" });
  addMessage(db, 1, { role: "user", at: "2026-05-02 13:00:00" });
  // Replies are the assistant's work, not the user's activity.
  addMessage(db, 1, { role: "assistant", at: "2026-05-01 12:01:00" });

  const stats = readProfileStats(db, 1, { today: "2026-05-03" });
  assert.deepEqual(stats.streaks.busiestDay, { date: "2026-05-02", count: 2 });
});

// ------------------------------------------------------------ activity grid

test("the activity grid is rectangular and ends on the week containing today", () => {
  const db = createDatabase();
  const stats = readProfileStats(db, 1, { today: "2026-08-05", weeks: 4 });

  assert.equal(stats.activity.length, 28);
  assert.equal(stats.activityWeeks, 4);
  // 2026-08-05 is a Wednesday; Monday-first weeks put its week last.
  assert.equal(stats.activity[0].date, "2026-07-13");
  assert.equal(stats.activity[27].date, "2026-08-09");
  assert.equal(stats.activity[24].date, "2026-08-06");
  assert.equal(stats.activity[24].future, true, "the rest of this week has not happened");
  assert.equal(stats.activity[23].future, false);
  assert.equal(stats.activity.filter((day) => day.future).length, 4);
});

test("the grid counts prompts on the day they were written, in local time", () => {
  const db = createDatabase();
  addConversation(db, 1);
  addMessage(db, 1, { role: "user", at: "2026-08-03 09:00:00" });
  addMessage(db, 1, { role: "user", at: "2026-08-03T10:00:00.000Z" });

  const stats = readProfileStats(db, 1, { today: "2026-08-05", weeks: 2 });
  const total = stats.activity.reduce((sum, day) => sum + day.count, 0);
  assert.equal(total, 2, "both storage formats land in the grid");
  // Both stamps are mid-morning UTC, which is the same date in any plausible zone.
  assert.equal(stats.activity.find((day) => day.date === "2026-08-03")?.count, 2);
});

test("an activity day names the real conversations behind its count", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO clusters (id, user_id, name, slug) VALUES (1, 1, 'Physics', 'physics')").run();
  addConversation(db, 1, { title: "Oscillations", gardenId: 1 });
  addConversation(db, 2, { title: "Quick question" });
  addConversation(db, 3, { userId: 2, title: "Someone else's chat" });
  addMessage(db, 1, { role: "user", at: "2026-08-03 09:00:00" });
  addMessage(db, 1, { role: "user", at: "2026-08-03 10:00:00" });
  addMessage(db, 2, { role: "user", at: "2026-08-03 11:00:00" });
  addMessage(db, 3, { role: "user", at: "2026-08-03 12:00:00" });

  const day = readProfileStats(db, 1, { today: "2026-08-05", weeks: 2 }).activity.find(
    (entry) => entry.date === "2026-08-03",
  );

  assert.equal(day?.count, 3);
  assert.deepEqual(day?.conversations, [
    {
      id: 1,
      title: "Oscillations",
      prompts: 2,
      garden: { name: "Physics", slug: "physics" },
    },
    { id: 2, title: "Quick question", prompts: 1, garden: null },
  ]);
});

test("the default window is half a year", () => {
  const db = createDatabase();
  const stats = readProfileStats(db, 1, { today: "2026-08-05" });
  assert.equal(stats.activity.length, DEFAULT_ACTIVITY_WEEKS * 7);
});

// -------------------------------------------------------- surfaces, gardens

test("surfaces and gardens are ranked, and gardens link by slug", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO clusters (id, user_id, name, slug) VALUES (1, 1, 'Physics', 'physics')").run();
  db.prepare("INSERT INTO clusters (id, user_id, name, slug) VALUES (2, 1, 'Quiet', 'quiet')").run();
  addConversation(db, 1, { gardenId: 1 });
  addConversation(db, 2, { gardenId: 2 });
  addMessage(db, 1, { role: "user", at: "2026-06-01 08:00:00", surface: "garden_chat" });
  addMessage(db, 1, { role: "user", at: "2026-06-01 09:00:00", surface: "garden_chat" });
  addMessage(db, 2, { role: "user", at: "2026-06-01 10:00:00", surface: "dashboard_terminal" });
  addMessage(db, 2, { role: "assistant", at: "2026-06-01 10:01:00", surface: "dashboard_terminal" });

  const stats = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.deepEqual(
    stats.surfaces.map((entry) => [entry.label, entry.count]),
    [["Garden chat", 2], ["Terminal", 1]],
  );
  assert.deepEqual(
    stats.gardens.map((garden) => [garden.slug, garden.prompts]),
    [["physics", 2], ["quiet", 1]],
    "replies do not inflate a garden's rank",
  );
});

test("artifact kinds are labelled and ranked", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO hermes_artifacts (id, user_id, kind, status) VALUES
       ('a', 1, 'text', 'ready'), ('b', 1, 'text', 'ready'), ('c', 1, 'image', 'ready')`,
  ).run();

  const stats = readProfileStats(db, 1, { today: "2026-06-02" });
  assert.deepEqual(
    stats.artifactKinds.map((entry) => [entry.label, entry.count]),
    [["Notes", 2], ["Images", 1]],
  );
});

// ------------------------------------------------------------ habit, origin

test("the hour and weekday histograms are Monday-first and fully sized", () => {
  const db = createDatabase();
  addConversation(db, 1);
  // 2026-06-03 is a Wednesday.
  addMessage(db, 1, { role: "user", at: "2026-06-03 12:00:00" });
  addMessage(db, 1, { role: "user", at: "2026-06-03 12:30:00" });

  const { habit } = readProfileStats(db, 1, { today: "2026-06-04" });

  assert.equal(habit.hours.length, 24);
  assert.equal(habit.weekdays.length, 7);
  assert.equal(habit.hours.reduce((sum, value) => sum + value, 0), 2);
  assert.equal(habit.weekdays.reduce((sum, value) => sum + value, 0), 2);
  assert.equal(habit.peakHour !== null && habit.hours[habit.peakHour], 2);
  assert.equal(habit.peakWeekday !== null && habit.weekdays[habit.peakWeekday], 2);
});

// --------------------------------------------------------------- cost, models

test("cost is summed only over models with a published rate", () => {
  const db = createDatabase();
  addConversation(db, 1);
  // Priced: 1M in + 1M out on Opus 5 is $5 + $25.
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 10:00:00",
    metadata: { model: "cliproxy/claude-opus-5" },
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
  });
  // Unpriced: a model nobody has entered a rate for.
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 11:00:00",
    metadata: { model: "gpt-5.6-sol" },
    usage: { inputTokens: 500, outputTokens: 500, totalTokens: 1000 },
  });
  // Unattributed: predates the model being recorded at all.
  addMessage(db, 1, { role: "assistant", at: "2026-06-01 12:00:00" });

  const { cost } = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.equal(cost.totalUsd, 30);
  assert.equal(cost.pricedReplies, 1);
  assert.equal(cost.unpricedReplies, 1, "an unrated model is unpriced, not free");
  assert.equal(cost.unattributedReplies, 1);
  assert.deepEqual(
    cost.models.map((entry) => [entry.label, entry.costUsd]),
    [["Claude Opus 5", 30], ["GPT-5.6 Sol", null]],
  );
});

test("a model's routing prefix and date stamp do not split it into two rows", () => {
  const db = createDatabase();
  addConversation(db, 1);
  for (const model of ["claude-sonnet-5", "openrouter/anthropic/claude-sonnet-5"]) {
    addMessage(db, 1, {
      role: "assistant",
      at: "2026-06-01 10:00:00",
      metadata: { model },
      usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
    });
  }

  const { cost } = readProfileStats(db, 1, { today: "2026-06-02" });
  // Two rows, because the recorded ids genuinely differ — but both are priced.
  assert.equal(cost.models.length, 2);
  assert.equal(cost.pricedReplies, 2);
  assert.equal(cost.totalUsd, 6);
});

// --------------------------------------------------------------- reliability

test("failed and aborted replies are counted, with their errors ranked", () => {
  const db = createDatabase();
  addConversation(db, 1);
  addMessage(db, 1, { role: "assistant", at: "2026-06-01 10:00:00" });
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 10:05:00",
    status: "failed",
    metadata: { error: "upstream_timeout" },
  });
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 10:06:00",
    status: "failed",
    metadata: { error: "upstream_timeout" },
  });
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 10:07:00",
    status: "aborted",
    metadata: { error: "user_stopped" },
  });
  // Still in flight — not a terminal outcome, so it is not judged either way.
  addMessage(db, 1, { role: "assistant", at: "2026-06-01 10:08:00", status: "pending" });

  const { reliability } = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.equal(reliability.terminalReplies, 4);
  assert.equal(reliability.completed, 1);
  assert.equal(reliability.failed, 2);
  assert.equal(reliability.aborted, 1);
  assert.deepEqual(reliability.topErrors, [
    { error: "upstream_timeout", count: 2 },
    { error: "user_stopped", count: 1 },
  ]);
  assert.equal(reliability.lastFailureAt, "2026-06-01 10:07:00");
});

test("the least reliable agent is named", () => {
  const db = createDatabase();
  addConversation(db, 1);
  for (const [kind, runId, outcome] of [
    ["vimax", "r1", "failed"],
    ["vimax", "r2", "failed"],
    ["deep_research", "r3", "failed"],
    ["deep_research", "r4", "completed"],
  ]) {
    addMessage(db, 1, {
      role: "assistant",
      at: "2026-06-01 10:00:00",
      metadata: { externalAgentRun: { kind, runId }, externalAgentOutcome: outcome },
    });
  }

  const { reliability } = readProfileStats(db, 1, { today: "2026-06-02" });
  assert.equal(reliability.worstAgent?.label, "ViMax");
  assert.equal(reliability.worstAgent?.failed, 2);
});

// ------------------------------------------------------------------ latency

test("latency reports the distribution, reading either place a duration is stored", () => {
  const db = createDatabase();
  addConversation(db, 1);
  // The runtime path folds the duration into token_usage...
  for (const ms of [1000, 2000, 3000]) {
    addMessage(db, 1, {
      role: "assistant",
      at: "2026-06-01 10:00:00",
      usage: { totalTokens: 1, responseDurationMs: ms },
    });
  }
  // ...and the provider-only path writes it to metadata.
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 10:00:00",
    metadata: { responseDurationMs: 9000 },
  });

  const { latency, totals } = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.equal(latency.measured, 4, "both storage places are read");
  assert.equal(latency.fastestMs, 1000);
  assert.equal(latency.slowestMs, 9000);
  assert.equal(latency.medianMs, 3000);
  assert.equal(totals.thinkingMs, 15_000, "the total agrees with the distribution");
});

test("an account with no timed replies reports zeroes rather than NaN", () => {
  const db = createDatabase();
  assert.deepEqual(readProfileStats(db, 1, { today: "2026-06-02" }).latency, {
    measured: 0,
    medianMs: 0,
    p90Ms: 0,
    slowestMs: 0,
    fastestMs: 0,
  });
});

// ------------------------------------------------------------------- memory

test("memories are broken out by kind, and retired ones counted apart", () => {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO durable_memories (id, user_id, state, kind, content) VALUES
       (1, 1, 'confirmed', 'preference', 'Prefers prose'),
       (2, 1, 'confirmed', 'preference', 'Dislikes bullets'),
       (3, 1, 'candidate', 'decision', 'Chose SQLite'),
       (4, 1, 'superseded', 'preference', 'An old belief'),
       (5, 2, 'confirmed', 'preference', 'Someone else')`,
  ).run();

  const { memory } = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.deepEqual(
    memory.kinds.map((entry) => [entry.label, entry.count]),
    [["Preferences", 2], ["Decisions", 1]],
  );
  assert.equal(memory.confirmed, 2);
  assert.equal(memory.candidate, 1);
  assert.equal(memory.superseded, 1, "retired memories are counted, not hidden");
});

// --------------------------------------------------------------- audit feed

test("the audit feed merges every source into one newest-first strip", () => {
  const db = createDatabase();
  addConversation(db, 1, { title: "A long night" });
  addMessage(db, 1, {
    role: "assistant",
    at: "2026-06-01 09:00:00",
    metadata: {
      externalAgentRun: { kind: "deep_research", runId: "r1" },
      externalAgentOutcome: "completed",
    },
  });
  db.prepare(
    `INSERT INTO hermes_artifacts (id, user_id, kind, status, title, created_at)
     VALUES ('a', 1, 'pdf', 'ready', 'The report', '2026-06-01 10:00:00')`,
  ).run();
  db.prepare(
    `INSERT INTO durable_memories (id, user_id, state, kind, content, created_at)
     VALUES (1, 1, 'confirmed', 'decision', 'Chose SQLite', '2026-06-01 11:00:00')`,
  ).run();
  db.prepare(
    `INSERT INTO scheduled_chat_jobs (id, user_id, title, last_run_at, last_status)
     VALUES (1, 1, 'Morning briefing', '2026-06-01 12:00:00', 'ok')`,
  ).run();
  // Another account's rows must not leak into this feed.
  addConversation(db, 2, { userId: 2 });
  db.prepare(
    `INSERT INTO hermes_artifacts (id, user_id, kind, status, title, created_at)
     VALUES ('b', 2, 'pdf', 'ready', 'Not yours', '2026-06-01 13:00:00')`,
  ).run();

  const { audit } = readProfileStats(db, 1, { today: "2026-06-02" });

  assert.deepEqual(
    audit.map((entry) => [entry.kind, entry.title]),
    [
      ["scheduled_chat", "Morning briefing"],
      ["memory", "Chose SQLite"],
      ["artifact", "The report"],
      ["agent_run", "Deep Research ran"],
    ],
  );
  assert.equal(audit[3].status, "ok");
  assert.equal(audit[2].href, "/artifacts");
});

test("a running agent has not done anything yet, so it is not in the feed", () => {
  const db = createDatabase();
  addConversation(db, 1);
  addMessage(db, 1, {
    role: "user",
    at: "2026-06-01 09:00:00",
    metadata: {
      externalAgentRun: { kind: "vimax", runId: "r1" },
      externalAgentOutcome: "running",
    },
  });

  assert.deepEqual(readProfileStats(db, 1, { today: "2026-06-02" }).audit, []);
});

test("the first conversation is the oldest one, whichever format its date uses", () => {
  const db = createDatabase();
  addConversation(db, 1, { title: "Later", at: "2026-06-01T08:00:00.000Z" });
  addConversation(db, 2, { title: "Where it started", at: "2026-04-26 07:17:44" });

  const stats = readProfileStats(db, 1, { today: "2026-06-02" });
  assert.equal(stats.firstConversation?.title, "Where it started");
});
