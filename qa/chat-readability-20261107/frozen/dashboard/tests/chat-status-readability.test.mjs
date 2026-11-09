import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { collectProcessStatus, summarizeProcessStatus } from "../src/lib/hermes/process-status.ts";

function fixture(t) {
  const database = new Database(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE clusters (id INTEGER, user_id INTEGER, slug TEXT, name TEXT);
    CREATE TABLE conversations (id INTEGER, user_id INTEGER, title TEXT);
    CREATE TABLE hermes_runtime_sessions (id INTEGER, user_id INTEGER, conversation_id INTEGER, surface TEXT, garden_id TEXT);
    CREATE TABLE hermes_runs (id TEXT, runtime_session_id INTEGER, instruction TEXT, status TEXT, started_at TEXT, finished_at TEXT);
    INSERT INTO conversations VALUES (1, 7, 'Telegram: Status'), (2, 7, 'Holiday planning'), (3, 8, 'Private chat');
    INSERT INTO hermes_runtime_sessions VALUES
      (11, 7, 1, 'dashboard_terminal', NULL), (12, 7, 2, 'dashboard_terminal', NULL),
      (13, 8, 3, 'dashboard_terminal', NULL), (14, 7, NULL, 'dashboard_terminal', NULL);
    INSERT INTO hermes_runs VALUES
      ('current', 11, 'i meant active chats inside breadboard', 'active', '2026-11-07T12:00:00.000Z', NULL),
      ('other', 12, 'yes go ahead', 'active', '2026-11-07T11:00:00.000Z', NULL),
      ('private', 13, 'secret request', 'active', '2026-11-07T12:15:00.000Z', NULL),
      ('finished', 12, 'thanks', 'completed', '2026-11-07T12:20:00.000Z', '2026-11-07T12:21:00.000Z');
  `);
  return database;
}

function status(database, extra = {}) {
  return collectProcessStatus({ database, userId: 7, currentConversationId: 1, kinds: ["chat_turn"], now: () => new Date("2026-11-07T13:00:00Z"), ...extra });
}

test("chat status identifies this chat and uses saved titles instead of quoting instructions", (t) => {
  const report = status(fixture(t));
  assert.deepEqual(report.unavailable, []);
  assert.equal(report.counts.running, 2);
  assert.equal(report.counts.succeeded, 1);
  const current = report.processes.find((record) => record.id === "current");
  assert.equal(current.title, "This chat");
  assert.equal(current.detail.isCurrentConversation, true);
  const other = report.processes.find((record) => record.id === "other");
  assert.equal(other.title, "Holiday planning");
  assert.equal(other.detail.isCurrentConversation, false);
  assert.ok(!report.processes.some((record) => record.id === "private"));
});

test("recent finished replies cannot push active chats out of a bounded status result", (t) => {
  const report = status(fixture(t), { limit: 2 });
  assert.deepEqual(report.processes.map((record) => record.id), ["current", "other"]);
  assert.equal(report.counts.running, 2);
});

test("legacy chats still work and missing conversation IDs never identify this chat", (t) => {
  const database = fixture(t);
  database.exec("DROP TABLE conversations; INSERT INTO hermes_runs VALUES ('legacy', 14, 'Explain capacitors', 'active', '2026-11-07T12:30:00.000Z', NULL)");
  const report = status(database, { currentConversationId: null });
  assert.deepEqual(report.unavailable, []);
  assert.equal(report.processes.find((record) => record.id === "legacy").title, "Explain capacitors");
  assert.ok(report.processes.every((record) => record.detail.isCurrentConversation === false));
});

test("unreadable chat status cannot be summarized as nothing running", (t) => {
  const database = fixture(t);
  database.exec("DROP TABLE hermes_runs; CREATE TABLE hermes_runs (id TEXT)");
  const report = status(database);
  assert.deepEqual(report.unavailable, ["chat_turn"]);
  assert.match(summarizeProcessStatus(report), /could not be fully checked/);
  assert.doesNotMatch(summarizeProcessStatus(report), /Nothing is running/);
});

test("active-only status excludes finished replies while the default retains them", (t) => {
  const database = fixture(t);
  const active = status(database, { activeOnly: true });
  assert.deepEqual(active.processes.map((record) => record.id), ["current", "other"]);
  assert.equal(active.counts.succeeded, 0);
  assert.equal(active.truncated, false);
  assert.equal(status(database).counts.succeeded, 1);
  database.exec("UPDATE hermes_runs SET status = 'completed'");
  const empty = status(database, { activeOnly: true });
  assert.equal(empty.total, 0);
  assert.match(summarizeProcessStatus(empty), /No work is currently running or waiting/);
  assert.doesNotMatch(summarizeProcessStatus(empty), /recently finished/);
});

test("a capped status listing cannot imply it contains every active chat", (t) => {
  const report = status(fixture(t), { activeOnly: true, limit: 1 });
  assert.equal(report.processes.length, 1);
  assert.equal(report.truncated, true);
  assert.match(summarizeProcessStatus(report), /partial listing/);
});
