// What the greeting is allowed to know about the reader, read against a real
// database rather than a fixture of what the query "would" return.
//
// The interesting cases are the ones that would quietly leak or mislead: a
// temporary chat offered back as something to resume, another account's
// gardens, and an elapsed time that has to survive the stored stamps being UTC
// while "today" is local.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { readChatGreetingSignals } from "../src/lib/hermes/chat-greeting-signals.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, email TEXT, created_at TEXT,
      first_name TEXT, last_name TEXT, nickname TEXT, occupation TEXT, about_you TEXT
    );
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, slug TEXT,
      last_viewed_at TEXT, created_at TEXT DEFAULT '2026-01-01 09:00:00'
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT,
      temporary INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT '2026-01-01 09:00:00'
    );
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, created_at TEXT
    );
  `);
  db.prepare(
    "INSERT INTO users (id, username, email, created_at) VALUES (?, ?, ?, datetime('now', '-90 days'))",
  ).run(1, "Grey", "grey@example.com");
  db.prepare(
    "INSERT INTO users (id, username, email, created_at) VALUES (?, ?, ?, datetime('now', '-1 days'))",
  ).run(2, "  ", "blank@example.com");
  return db;
}

let nextMessageId = 1;

function addChat(db, { id, userId = 1, title, temporary = 0, updatedAt = "2026-01-01 09:00:00" }) {
  db.prepare(
    "INSERT INTO conversations (id, user_id, title, temporary, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, title, temporary, updatedAt);
}

/** A user message `minutesAgo` in the past, stored the way the app stores it. */
function addPrompt(db, conversationId, minutesAgo) {
  db.prepare(
    `INSERT INTO conversation_messages (id, conversation_id, role, created_at)
     VALUES (?, ?, 'user', datetime('now', ?))`,
  ).run(nextMessageId++, conversationId, `-${minutesAgo} minutes`);
}

test("an account with nothing in it reports nothing, and still reports its name", () => {
  const db = createDatabase();
  const signals = readChatGreetingSignals(db, 1);
  assert.equal(signals.name, "Grey");
  assert.equal(signals.gardenCount, 0);
  assert.deepEqual(signals.recentGardens, []);
  assert.deepEqual(signals.recentChats, []);
  assert.equal(signals.promptsToday, 0);
  assert.equal(signals.minutesSinceLastPrompt, null);
  assert.ok(signals.daysSinceJoined >= 89 && signals.daysSinceJoined <= 91);
  db.close();
});

test("a user who does not exist greets as a stranger rather than throwing", () => {
  const db = createDatabase();
  const signals = readChatGreetingSignals(db, 999);
  assert.equal(signals.name, null);
  assert.equal(signals.gardenCount, 0);
  db.close();
});

test("a blank username is no name at all", () => {
  const db = createDatabase();
  assert.equal(readChatGreetingSignals(db, 2).name, null);
  db.close();
});

test("gardens come back freshest first, and only the reader's own", () => {
  const db = createDatabase();
  const insert = db.prepare(
    "INSERT INTO clusters (id, user_id, name, slug, last_viewed_at) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(1, 1, "Thermodynamics", "thermodynamics", "2026-05-01 09:00:00");
  insert.run(2, 1, "Control Theory", "control-theory", "2026-06-01 09:00:00");
  // Never opened: it falls back to when it was made, which is older than both.
  insert.run(3, 1, "Optics", "optics", null);
  insert.run(4, 2, "Someone else's", "theirs", "2026-07-01 09:00:00");

  const signals = readChatGreetingSignals(db, 1);
  assert.equal(signals.gardenCount, 3);
  assert.deepEqual(
    signals.recentGardens.map((garden) => garden.name),
    ["Control Theory", "Thermodynamics", "Optics"],
  );
  db.close();
});

test("a temporary chat is never offered back as somewhere to pick up", () => {
  const db = createDatabase();
  addChat(db, { id: 1, title: "Entropy and the second law", updatedAt: "2026-06-01 09:00:00" });
  addChat(db, { id: 2, title: "Off the record", temporary: 1, updatedAt: "2026-07-01 09:00:00" });
  addChat(db, { id: 3, title: "New chat", updatedAt: "2026-07-02 09:00:00" });
  addChat(db, { id: 4, userId: 2, title: "Not yours", updatedAt: "2026-07-03 09:00:00" });
  // Long enough that it would not fit on a card.
  addChat(db, { id: 5, title: "A".repeat(120), updatedAt: "2026-07-04 09:00:00" });

  assert.deepEqual(readChatGreetingSignals(db, 1).recentChats, ["Entropy and the second law"]);
  db.close();
});

test("today's prompts and the gap since the last one are counted, not guessed", () => {
  const db = createDatabase();
  addChat(db, { id: 1, title: "Entropy and the second law" });
  addChat(db, { id: 2, userId: 2, title: "Not yours" });

  addPrompt(db, 1, 5);
  addPrompt(db, 1, 30);
  // Comfortably last week, so it counts towards neither today nor the gap.
  addPrompt(db, 1, 60 * 24 * 9);
  // Another account's message must not land in either number.
  addPrompt(db, 2, 1);

  const signals = readChatGreetingSignals(db, 1);
  assert.ok(signals.minutesSinceLastPrompt >= 4 && signals.minutesSinceLastPrompt <= 6);
  // Both recent prompts are today unless the test is running within half an
  // hour of midnight, in which case one of them belongs to yesterday.
  assert.ok(signals.promptsToday >= 1 && signals.promptsToday <= 2);
  db.close();
});

test("the gap is measured in minutes, however long ago it was", () => {
  const db = createDatabase();
  addChat(db, { id: 1, title: "Entropy and the second law" });
  addPrompt(db, 1, 60 * 24 * 30);

  const signals = readChatGreetingSignals(db, 1);
  const expected = 60 * 24 * 30;
  assert.ok(Math.abs(signals.minutesSinceLastPrompt - expected) <= 2);
  assert.equal(signals.promptsToday, 0);
  db.close();
});
