// Standing preferences and retrieval-query widening: the two ways a memory
// reaches a turn that never asked for it by name.
//
// Durable memory was retrieved by lexical overlap with the current message,
// which meant "prefers answers in Turkish" could only ever be applied to a
// question that contained the word Turkish. And a follow-up like "and for
// dinner?" carried no terms at all, so it retrieved nothing even when the
// previous turn named the subject. Both are fixed at the bundle level, so
// every gate above them — temporary chat, Personalize off, garden isolation —
// keeps meaning what it meant.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  STANDING_MEMORY_LIMIT,
  composeMemoryContext,
  expandRetrievalQuery,
  inferMemoryKind,
  loadConversationMemoryBundle,
  mergeStandingMemories,
  saveDurableMemory,
  standingDurableMemories,
} from "../src/lib/conversations/memory.ts";
import { ensureConversationSchema } from "../src/lib/conversations/schema.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      nickname TEXT,
      occupation TEXT,
      about_you TEXT
    );
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      name TEXT,
      slug TEXT,
      memory_scope TEXT
    );
    CREATE TABLE chat_sessions (
      id INTEGER PRIMARY KEY, cluster_id INTEGER, user_id INTEGER,
      title TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY, session_id INTEGER, role TEXT, content TEXT,
      order_index INTEGER, created_at TEXT
    );
    CREATE TABLE hermes_runtime_sessions (
      id INTEGER PRIMARY KEY, surface TEXT, user_id INTEGER, chat_session_id INTEGER,
      cluster_id INTEGER, garden_id TEXT, page_slug TEXT, runtime_metadata TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE hermes_messages (
      id INTEGER PRIMARY KEY, runtime_session_id INTEGER, role TEXT, content TEXT,
      order_index INTEGER, created_at TEXT
    );
  `);
  ensureConversationSchema(db);
  db.prepare(
    "INSERT INTO users (id, username, first_name) VALUES (1,'kuzey','Kuzey')",
  ).run();
  db.prepare(
    "INSERT INTO conversations (id, public_id, user_id, title, surface, temporary) VALUES (7,'c7',1,'Laptops','dashboard_terminal',0)",
  ).run();
  db.prepare(
    "INSERT INTO conversations (id, public_id, user_id, title, surface, temporary) VALUES (8,'c8',1,'Off the record','dashboard_terminal',1)",
  ).run();
  return db;
}

const conversation = (overrides = {}) => ({
  id: 7,
  public_id: "c7",
  user_id: 1,
  title: "Laptops",
  surface: "dashboard_terminal",
  temporary: 0,
  ...overrides,
});

function remember(db, content, overrides = {}) {
  return saveDurableMemory({
    userId: 1,
    content,
    kind: "preference",
    scope: "global",
    scopeId: null,
    sourceConversationId: null,
    state: "confirmed",
    confidence: 0.9,
    salience: 0.9,
    ...overrides,
  }, db);
}

function say(db, conversationId, role, content, order) {
  db.prepare(
    `INSERT INTO conversation_messages
       (conversation_id, client_message_id, role, surface, content, status, order_index)
     VALUES (?, ?, ?, 'dashboard_terminal', ?, 'complete', ?)`,
  ).run(conversationId, `m${conversationId}-${order}`, role, content, order);
}

// A question that shares no indexable term with any memory below.
const UNRELATED = "which laptop should I buy for CAD work this semester";

test("a confirmed preference reaches the turn without sharing a word with the question", () => {
  const db = createDatabase();
  remember(db, "The user prefers answers in Turkish.");
  const bundle = loadConversationMemoryBundle(
    { conversation: conversation(), query: UNRELATED },
    db,
  );
  assert.equal(bundle.durableMemories.length, 1);
  assert.equal(bundle.durableMemories[0].standing, true);
  assert.match(bundle.durableMemories[0].content, /Turkish/);

  const context = composeMemoryContext(bundle);
  assert.match(context, /standing preference\] The user prefers answers in Turkish/);
  assert.match(context, /Entries marked standing are preferences and habits the user has confirmed/);
  assert.match(
    context,
    /leave it unmentioned when it does not/,
    "the model is told not to work a standing preference into every answer",
  );
  db.close();
});

test("only confirmed, global, strong, non-secret preferences and habits are standing", () => {
  const db = createDatabase();
  remember(db, "The user usually reviews diffs before merging.", { kind: "working_pattern" });
  remember(db, "The user might prefer dark mode.", { state: "candidate" });
  remember(db, "Prefer React for this project's UI.", { scope: "project", scopeId: "breadboard" });
  remember(db, "The user prefers tea.", { confidence: 0.5, salience: 0.5 });
  remember(db, "The user prefers the api key sk-abcdefghijklmnop for tests.");
  remember(db, "The user's name is Kuzey.", { kind: "project_fact" });
  remember(db, "The team decided to use SQLite.", { kind: "decision" });

  const standing = standingDurableMemories(
    { userId: 1, currentConversationId: 7 },
    db,
  );
  assert.deepEqual(
    standing.map((memory) => memory.content),
    ["The user usually reviews diffs before merging."],
  );
  const context = composeMemoryContext(
    loadConversationMemoryBundle({ conversation: conversation(), query: UNRELATED }, db),
  );
  assert.match(context, /standing habit\] The user usually reviews diffs/);
  assert.doesNotMatch(context, /dark mode|React|tea|sk-abcdefghijklmnop|SQLite/);
  db.close();
});

test("the standing set is capped, strongest first, and yields the top of the budget to relevant memory", () => {
  const db = createDatabase();
  remember(db, "The user prefers metric units.", { confidence: 0.95, salience: 0.95 });
  remember(db, "The user prefers short answers.", { confidence: 0.9, salience: 0.9 });
  remember(db, "The user prefers British spelling.", { confidence: 0.85, salience: 0.85 });
  remember(db, "The user prefers tabs over spaces.", { confidence: 0.8, salience: 0.8 });
  remember(db, "The user prefers ISO dates.", { confidence: 0.75, salience: 0.75 });

  const standing = standingDurableMemories({ userId: 1, currentConversationId: 7 }, db);
  assert.equal(standing.length, STANDING_MEMORY_LIMIT);
  assert.deepEqual(
    standing.map((memory) => memory.content),
    [
      "The user prefers metric units.",
      "The user prefers short answers.",
      "The user prefers British spelling.",
    ],
  );

  // Six relevant memories fill the budget; the standing set displaces only
  // the weakest three, never the best match.
  const relevant = Array.from({ length: 6 }, (_, index) => ({
    id: 100 + index,
    content: `relevant ${index}`,
    kind: "project_fact",
    scope: "global",
    state: "confirmed",
    score: 0.5 - index * 0.05,
    sourceConversationId: null,
  }));
  const merged = mergeStandingMemories(relevant, standing, 6);
  assert.deepEqual(
    merged.map((memory) => memory.content),
    [
      "relevant 0",
      "relevant 1",
      "relevant 2",
      "The user prefers metric units.",
      "The user prefers short answers.",
      "The user prefers British spelling.",
    ],
  );

  // A standing preference the question also matched is one memory, not two.
  const overlapping = mergeStandingMemories(
    [{ ...standing[0], standing: undefined, score: 0.4 }],
    standing,
    6,
  );
  assert.equal(overlapping.length, 3);
  assert.equal(new Set(overlapping.map((memory) => memory.id)).size, 3);
  assert.equal(overlapping[0].standing, undefined, "the relevant copy keeps its place");
  db.close();
});

test("a temporary chat and a depersonalized turn carry no standing preference", () => {
  const db = createDatabase();
  remember(db, "The user prefers answers in Turkish.");

  const temporary = loadConversationMemoryBundle(
    {
      conversation: conversation({ id: 8, public_id: "c8", title: "Off the record", temporary: 1 }),
      query: UNRELATED,
    },
    db,
  );
  assert.deepEqual(temporary.durableMemories, []);

  const depersonalized = loadConversationMemoryBundle(
    { conversation: conversation(), query: UNRELATED, personalize: false },
    db,
  );
  assert.deepEqual(depersonalized.durableMemories, []);
  assert.doesNotMatch(composeMemoryContext(depersonalized), /Turkish/);
  db.close();
});

test("a short follow-up borrows the previous user turn for retrieval", () => {
  const db = createDatabase();
  remember(db, "The user is vegetarian and cooks lentils weekly.", { kind: "project_fact" });
  say(db, 7, "user", "What should I cook with lentils tonight?", 1);
  say(db, 7, "assistant", "A red lentil dal works well on a weeknight.", 2);
  say(db, 7, "user", "and for dinner tomorrow?", 3);

  const bundle = loadConversationMemoryBundle(
    { conversation: conversation(), query: "and for dinner tomorrow?" },
    db,
  );
  assert.equal(bundle.durableMemories.length, 1);
  assert.match(bundle.durableMemories[0].content, /lentils/);
  assert.notEqual(bundle.durableMemories[0].standing, true, "found by relevance, not by standing");

  const widened = expandRetrievalQuery("and for dinner tomorrow?", bundle.recentMessages);
  assert.match(widened, /^and for dinner tomorrow\?\n/);
  assert.match(widened, /What should I cook with lentils tonight\?/);
  assert.equal(
    widened.split("What should I cook").length,
    2,
    "the earlier turn is borrowed once",
  );
  assert.doesNotMatch(widened, /red lentil dal/, "assistant turns are not the user's question");
  db.close();
});

test("a message that already names its subject is retrieved as written", () => {
  const recent = [
    { role: "user", content: "Tell me about lentils and chickpeas and beans." },
    { role: "user", content: "which laptop should I buy for CAD work this semester" },
  ];
  const query = "which laptop should I buy for CAD work this semester";
  assert.equal(expandRetrievalQuery(query, recent), query);
  // The current message, already stored, is never borrowed back.
  assert.equal(
    expandRetrievalQuery("laptop?", [{ role: "user", content: "laptop?" }]),
    "laptop?",
  );
});

test("the kind inferrer hears a preference in the ways people state one", () => {
  assert.equal(inferMemoryKind("Answer in Turkish from now on."), "preference");
  assert.equal(inferMemoryKind("The user would rather use pnpm instead of npm."), "preference");
  assert.equal(inferMemoryKind("The user dislikes em dashes."), "preference");
  assert.equal(inferMemoryKind("The user's favourite editor is Neovim."), "preference");
  assert.equal(inferMemoryKind("The user never merges without a review."), "working_pattern");
  assert.equal(inferMemoryKind("The user's birthday is 23 June 2006."), "project_fact");
});
