import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureStarredMessagesSchema, listStarredMessages, setMessageStar } from "../src/lib/starred-messages-store.ts";
import { matchesStarredMessage, starredMessageHref } from "../src/lib/starred-messages-types.ts";
import { wholeMessageReply, normalizeChatTextSelectionReference, chatTextSelectionDraft, chatTextSelectionQuestionPrompt } from "../src/lib/chat-text-selection.ts";

function fixture(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT,
      surface TEXT, default_garden_id INTEGER, legacy_chat_session_id INTEGER, temporary INTEGER DEFAULT 0);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE, client_message_id TEXT, role TEXT, content TEXT);
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (1, 'my-garden');
    INSERT INTO conversations VALUES
      (1, 'conv_one', 1, 'First chat', 'dashboard_terminal', NULL, NULL, 0),
      (2, 'conv_two', 2, 'Private chat', 'dashboard_terminal', NULL, NULL, 0),
      (3, 'conv_garden', 1, 'Garden chat', 'garden_chat', 1, 42, 0),
      (4, 'conv_temp', 1, 'Temporary', 'dashboard_terminal', NULL, NULL, 1);
    INSERT INTO conversation_messages VALUES
      (1, 1, 'client-turn-one', 'assistant', 'Full response'),
      (2, 1, 'client-turn-one', 'user', 'Question'),
      (3, 2, 'client-turn-two', 'assistant', 'Private response'),
      (4, 3, 'client-turn-garden', 'assistant', 'Garden response'),
      (5, 4, 'client-turn-temp', 'assistant', 'Temporary response');`);
  ensureStarredMessagesSchema(db);
  return db;
}

test("stars resolve live and restored identities to one durable message", (t) => {
  const db = fixture(t);
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "client-turn-one", starred: true });
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "msg_1", starred: true });
  ensureStarredMessagesSchema(db);
  const [star] = listStarredMessages(db, 1);
  assert.equal(listStarredMessages(db, 1).length, 1);
  assert.equal(star.messageId, "msg_1");
  assert.ok(matchesStarredMessage(star, "conv_one", "client-turn-one"));
  assert.ok(matchesStarredMessage(star, "conv_one", "msg_1"));
  assert.equal(starredMessageHref(star), "/dashboard?terminalChat=conv_one&message=msg_1");
  db.prepare("UPDATE conversation_messages SET content = 'Edited answer' WHERE id = 1").run();
  db.prepare("UPDATE conversations SET title = 'Renamed chat' WHERE id = 1").run();
  assert.equal(listStarredMessages(db, 1)[0].preview, "Edited answer");
  assert.equal(listStarredMessages(db, 1)[0].title, "Renamed chat");
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "client-turn-one", starred: false });
  assert.deepEqual(listStarredMessages(db, 1), []);
});

test("stars enforce ownership, message membership and temporary-chat privacy", (t) => {
  const db = fixture(t);
  for (const [conversationId, messageId] of [["conv_two", "msg_3"], ["conv_one", "msg_3"], ["conv_one", "msg_2"], ["conv_temp", "msg_5"]]) {
    assert.throws(() => setMessageStar(db, 1, { conversationId, messageId, starred: true }), /no longer available/);
  }
  setMessageStar(db, 2, { conversationId: "conv_two", messageId: "msg_3", starred: true });
  assert.deepEqual(listStarredMessages(db, 1), []);
});

test("garden stars open their original chat and disappear with deleted messages", (t) => {
  const db = fixture(t);
  setMessageStar(db, 1, { conversationId: "42", messageId: "msg_4", starred: true });
  const [star] = listStarredMessages(db, 1);
  assert.equal(starredMessageHref(star), "/gardens/my-garden?chat=42&message=msg_4");
  assert.ok(matchesStarredMessage(star, "42", "client-turn-garden"));
  db.prepare("DELETE FROM conversations WHERE id = 3").run();
  assert.deepEqual(listStarredMessages(db, 1), []);
  assert.equal(db.prepare("SELECT count(*) n FROM starred_messages").get().n, 0);
});

test("Reply attaches the entire long message and survives metadata normalization", () => {
  const content = `  Heading\n${"Long response. ".repeat(1500)}\nFinal sentence.  `;
  const reply = wholeMessageReply("msg_1", content);
  assert.equal(reply.quote, content);
  assert.equal(reply.start, 0);
  assert.equal(reply.end, content.length);
  assert.deepEqual(normalizeChatTextSelectionReference(JSON.parse(JSON.stringify(reply))), reply);
  assert.ok(chatTextSelectionQuestionPrompt("Explain the ending", reply).includes("Final sentence."));
  assert.equal(chatTextSelectionDraft(content, 0, content.length).quote.length, 4000);
  assert.equal(wholeMessageReply("msg_1", "   "), null);
  assert.equal(normalizeChatTextSelectionReference({ ...reply, mode: "inline" }), null);
});
