import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

process.env.BREADBOARD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "earlier-chats-"));
await import("../scripts/learn-worker-import-hook.mjs");
const { recallEarlierConversations, refersToEarlierConversation } = await import("../src/lib/conversations/earlier-chats.ts");
const Database = createRequire(import.meta.url)("better-sqlite3");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE clusters (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, memory_scope TEXT);
  CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, surface TEXT, updated_at TEXT, temporary INTEGER, default_garden_id INTEGER, buzz_room_id INTEGER);
  CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE organization_members (organization_id INTEGER, user_id INTEGER);
  CREATE TABLE buzz_rooms (id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, kind TEXT, visibility TEXT, last_activity_at TEXT);
  CREATE TABLE buzz_room_members (room_id INTEGER, user_id INTEGER);
  CREATE TABLE buzz_room_messages (id INTEGER PRIMARY KEY, room_id INTEGER, author_kind TEXT, author_name TEXT, body TEXT, status TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT);
  INSERT INTO organizations VALUES (1, 'Lab'), (2, 'Elsewhere');
  INSERT INTO organization_members VALUES (1, 7), (2, 8);
  INSERT INTO buzz_rooms VALUES (1, 1, 'general', 'channel', 'public', '2026-11-15'), (2, 1, 'secret', 'channel', 'private', '2026-11-15'),
    (3, 1, 'mine', 'channel', 'private', '2026-11-15'), (4, 2, 'theirs', 'channel', 'public', '2026-11-15');
  INSERT INTO buzz_room_members VALUES (3, 7);
  INSERT INTO buzz_room_messages (room_id, author_kind, author_name, body, status, created_at) VALUES
    (1, 'human', 'Ada', 'We picked the cascode amplifier for the sensor front end.', 'complete', '2026-11-15'),
    (2, 'human', 'Bob', 'Cascode amplifier budget is secret.', 'complete', '2026-11-15'),
    (3, 'human', 'Kuzey', 'My private cascode amplifier note.', 'complete', '2026-11-15'),
    (4, 'human', 'Eve', 'Their cascode amplifier plan.', 'complete', '2026-11-15'),
    (1, 'human', 'Kuzey', '@bread what did we decide about the cascode amplifier?', 'complete', '2026-11-18');
  CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, content TEXT, status TEXT, order_index INTEGER, created_at TEXT, updated_at TEXT);
  INSERT INTO clusters VALUES (1, 7, 'Neuro Comp', NULL), (2, 7, 'Diary', 'garden_only');
  INSERT INTO conversations VALUES
    (10, 7, 'Neurocomputation and AI bottlenecks', 'garden_chat', '2026-11-12', 0, 1, NULL),
    (11, 7, 'Diary', 'garden_chat', '2026-11-13', 0, 2, NULL),
    (12, 8, 'Someone else', 'dashboard_terminal', '2026-11-13', 0, NULL, NULL),
    (13, 7, 'Scratch', 'dashboard_terminal', '2026-11-14', 1, NULL, NULL),
    (20, 7, 'New chat', 'dashboard_terminal', '2026-11-18', 0, NULL, NULL),
    (30, 7, 'Bread in #general', 'dashboard_terminal', '2026-11-18', 0, NULL, 1);
`);
const message = db.prepare("INSERT INTO conversation_messages (conversation_id, role, content, status, order_index, created_at) VALUES (?, ?, ?, 'complete', ?, '2026-11-12')");
message.run(10, "user", "how did Shannon's approach look like?", 0);
message.run(10, "assistant", "Shannon proposed minimax search. A Type A program examines every move to a fixed depth; Type B looks deeper along plausible moves.", 1);
message.run(10, "user", "what is the von Neumann bottleneck?", 2);
message.run(10, "assistant", "Moving weights between memory and processor limits speed.", 3);
for (const conversation of [11, 12, 13]) message.run(conversation, "assistant", "My private minimax note: Type C.", 0);
message.run(20, "user", "we talked about the minmax thing before, what type did we talk about", 0);
// A room agent's private working thread: never part of the account's history.
message.run(30, "assistant", "Working notes: cascode amplifier gain is 40 dB.", 0);

const ask = (query, extra = {}) => recallEarlierConversations({ userId: 7, conversationId: 20, query, surface: "dashboard_terminal", ...extra }, db);

test("a question pointing back finds the earlier chat on another surface, typo and all", () => {
  const context = ask("we talked about the minmax thing before, what type did we talk about");
  assert.match(context, /# earlier_conversations/);
  assert.match(context, /"Neurocomputation and AI bottlenecks" \(a Garden chat in Neuro Comp/);
  assert.match(context, /User asked: how did Shannon's approach look like\?/);
  assert.match(context, /Type A program examines every move/);
  assert.doesNotMatch(context, /Type C/, "another user's, a temporary and a garden-only Garden's chats stay out");
});

test("only questions that point back, and only passages about them", () => {
  assert.equal(refersToEarlierConversation("write me an email to my professor before friday"), false);
  assert.equal(ask("write me an email about minimax before friday"), "");
  assert.equal(ask("did we ever talk about quantum gravity"), "");
  assert.equal(ask("what did we say about minimax", { temporary: 1 }), "", "a temporary chat does not read history");
  assert.equal(ask("what did we say about minimax", { personalize: false }), "");
});

test("inside a garden-only Garden, only that Garden's chats", () => {
  const context = ask("what did we say about minimax", { surface: "garden_chat", gardenId: 2 });
  assert.match(context, /"Diary"/);
  assert.doesNotMatch(context, /Neurocomputation/);
});

test("a private chat also recalls the organization rooms its user can open", () => {
  const context = ask("what did we decide about the cascode amplifier?");
  assert.match(context, /"#general" \(a room of the Lab organization/);
  assert.match(context, /Ada: We picked the cascode amplifier/);
  assert.match(context, /"#mine"/, "a private room the user is in");
  assert.doesNotMatch(context, /secret|Their cascode|Working notes/, "not a private room they are not in, another organization, or a room agent's thread");
});

test("a room agent recalls only its room and the organization's public channels", () => {
  const prompt = ["You are Bread, a member of the shared Organization room #general.", "", "Recent messages in the room:", "", "Ada: hello", "",
    "The message you are answering, from Kuzey:", "", "@bread what did we decide about the cascode amplifier?"].join(String.fromCharCode(10));
  const context = recallEarlierConversations({ userId: 7, conversationId: 30, query: prompt, surface: "dashboard_terminal", personalize: false }, db);
  assert.match(context, /Ada: We picked the cascode amplifier/);
  assert.doesNotMatch(context, /what did we decide/, "the question does not answer itself");
  assert.doesNotMatch(context, /#mine|secret|minimax|Neurocomputation/, "no private room and no private chat reaches a shared room");
});
