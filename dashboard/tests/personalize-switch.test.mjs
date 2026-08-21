// Personalize: whether a turn is answered for this particular person, or for
// anyone.
//
// The switch is easy to get subtly wrong in two directions. Withhold too
// little and turning it off does nothing, because the semantic half of memory
// retrieval never heard about it. Withhold too much and it quietly becomes
// Temporary chat, which is a different promise — that one stops memory being
// *written*, and conflating them would mean one of the two switches is lying
// about what it does.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  composeMemoryContext,
  loadConversationMemoryBundle,
} from "../src/lib/conversations/memory.ts";
import { ensureConversationSchema } from "../src/lib/conversations/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");

function createDatabase() {
  const db = new Database(":memory:");
  // The real schema rather than a hand-written one: this test is about which
  // sources reach the prompt, and a fixture that drifts from the tables the
  // retrieval queries actually read would pass while the product broke.
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
      memory_isolation TEXT
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
    "INSERT INTO users (id, username, first_name, nickname, occupation, about_you) VALUES (1,'kuzey','Kuzey','','electrical engineering student','I am building Breadboard.')",
  ).run();
  db.prepare(
    "INSERT INTO conversations (id, public_id, user_id, title, surface, temporary) VALUES (7,'c7',1,'Robotics','dashboard_terminal',0)",
  ).run();
  db.prepare(
    "INSERT INTO conversations (id, public_id, user_id, title, surface, temporary) VALUES (3,'c3',1,'Earlier chat','dashboard_terminal',0)",
  ).run();
  db.prepare(
    "INSERT INTO conversation_messages (conversation_id, client_message_id, role, surface, content, status, order_index) VALUES (7,'m1','user','dashboard_terminal','Which robotics niche has the highest return?','complete',1)",
  ).run();
  db.prepare(
    `INSERT INTO durable_memories
       (user_id, content, kind, scope, source_conversation_id, state, confidence, salience, last_confirmed_at)
     VALUES (1,'The user lives in Eindhoven and is studying robotics.','project_fact','global',3,'confirmed',0.9,0.9,datetime('now'))`,
  ).run();
  db.prepare(
    "UPDATE memory_profiles SET summary = ? WHERE user_id = ?",
  ).run("A student building an AI product.", 1);
  if (
    db.prepare("SELECT COUNT(*) AS n FROM memory_profiles WHERE user_id = 1").get().n === 0
  ) {
    db.prepare(
      "INSERT INTO memory_profiles (user_id, summary) VALUES (1, 'A student building an AI product.')",
    ).run();
  }
  return db;
}

// One query for every case below, so "on" and "off" are compared against the
// same retrieval rather than against two differently lucky ones.
const QUERY = "what is the user studying in Eindhoven, and is it robotics";

const conversation = () => ({
  id: 7,
  public_id: "c7",
  user_id: 1,
  title: "Robotics",
  surface: "dashboard_terminal",
  temporary: 0,
});

test("switched on, nothing changes — the name, the memories and the profile all arrive", () => {
  const db = createDatabase();
  const bundle = loadConversationMemoryBundle(
    { conversation: conversation(), query: QUERY, personalize: true },
    db,
  );
  assert.equal(bundle.depersonalized, false);
  assert.ok(bundle.identity);
  assert.equal(bundle.identity.displayName, "Kuzey");
  assert.ok(bundle.durableMemories.length > 0);
  assert.match(bundle.profileSummary, /building an AI product/);
  db.close();
});

test("omitting the field is the same as switching it on, so an older client is unaffected", () => {
  const db = createDatabase();
  const bundle = loadConversationMemoryBundle(
    { conversation: conversation(), query: QUERY },
    db,
  );
  assert.equal(bundle.depersonalized, false);
  assert.ok(bundle.identity);
  db.close();
});

test("switched off, every source that describes the user is withheld", () => {
  const db = createDatabase();
  const bundle = loadConversationMemoryBundle(
    { conversation: conversation(), query: QUERY, personalize: false },
    db,
  );
  assert.equal(bundle.depersonalized, true);
  assert.equal(bundle.identity, null);
  assert.deepEqual(bundle.durableMemories, []);
  assert.equal(bundle.profileSummary, "");

  const context = composeMemoryContext(bundle);
  assert.doesNotMatch(context, /Kuzey/);
  assert.doesNotMatch(context, /Eindhoven/);
  assert.doesNotMatch(context, /# user_identity/);
  assert.doesNotMatch(context, /# synthesized_user_profile/);
  db.close();
});

test("this conversation's own thread survives — it is what the turn is replying to", () => {
  const db = createDatabase();
  const bundle = loadConversationMemoryBundle(
    { conversation: conversation(), query: QUERY, personalize: false },
    db,
  );
  assert.equal(bundle.recentMessages.length, 1);
  const context = composeMemoryContext(bundle);
  assert.match(context, /# recent_exact_conversation_messages/);
  assert.match(context, /highest return/);
  db.close();
});

test("the model is told personalization was declined, not left to read the silence", () => {
  // Without this the empty block reads as "I have never met this person", and
  // the answer opens by apologizing for not knowing them.
  const db = createDatabase();
  const context = composeMemoryContext(
    loadConversationMemoryBundle(
      { conversation: conversation(), query: QUERY, personalize: false },
      db,
    ),
  );
  assert.match(context, /switched Personalize off/);
  assert.match(context, /do not use, guess at, or apologize/);
  db.close();
});

test("it is a read-side switch, and says so where someone might assume otherwise", () => {
  // The distinction against Temporary chat. If this ever starts gating writes,
  // the two switches become the same switch with two names.
  const memory = source("src/lib/conversations/memory.ts");
  assert.match(memory, /Read-side only/);
  assert.match(
    memory,
    /not a change to what may be saved/,
  );
  const hook = source("src/app/components/use-personalize.ts");
  assert.match(hook, /Read-side only/);
});

test("the semantic half of retrieval is gated too, not just the lexical one", () => {
  // The lexical half returning nothing is not enough: mem0 would still reach
  // for the same memories through the other channel and put them in the prompt.
  const retrieval = source("src/lib/mem0/retrieval.ts");
  assert.match(retrieval, /if \(bundle\.depersonalized\) return bundle;/);
});

test("the switch sits directly above Concise, and defaults to on", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  const personalize = composer.indexOf("aria-checked={personalize}");
  const direct = composer.indexOf("aria-checked={directMode}");
  const yolo = composer.indexOf("aria-checked={yoloMode}");
  assert.ok(personalize > 0 && direct > 0);
  assert.ok(personalize < direct, "Personalize renders before Concise");
  assert.ok(direct < yolo, "Concise still renders before YOLO");

  const hook = source("src/app/components/use-personalize.ts");
  assert.match(hook, /const DEFAULT_ENABLED = true;/);
});

test("every chat surface sends it, so the switch is not silently inert on three of them", () => {
  for (const file of [
    "src/app/components/hermes/use-agent-session.ts",
    "src/app/components/knowledge-terminal.tsx",
    "src/app/garden/garden-assistant.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const text = source(file);
    assert.match(text, /personalize: isPersonalizeEnabled\(\)/, file);
    assert.match(text, /use-personalize/, file);
  }
});

test("the server reads it defensively: only an explicit false depersonalizes", () => {
  const route = source("src/app/api/hermes/sessions/[sessionId]/messages/route.ts");
  assert.match(route, /personalize: body\.personalize !== false/);
  const turnService = source("src/lib/conversations/turn-service.ts");
  assert.match(turnService, /personalize: input\.personalize !== false/);
  const garden = source("src/lib/hermes/garden-chat-adapter.ts");
  assert.match(garden, /personalize: payload\.personalize !== false/);
});
