import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureStarredMessagesSchema, getStarredMessageContent, listStarredMessages, setMessageStar, sideChatHasStars } from "../src/lib/starred-messages-store.ts";
import { matchesStarredMessage, starredMessageHref } from "../src/lib/starred-messages-types.ts";
import { wholeMessageReply, normalizeChatTextSelectionReference, chatTextSelectionDraft, chatTextSelectionQuestionPrompt } from "../src/lib/chat-text-selection.ts";

function fixture(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT);
    CREATE TABLE chat_sessions(id INTEGER PRIMARY KEY, history_surface TEXT);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT,
      surface TEXT, default_garden_id INTEGER, legacy_chat_session_id INTEGER, temporary INTEGER DEFAULT 0, origin_label TEXT);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE, client_message_id TEXT, role TEXT, content TEXT);
    INSERT INTO users VALUES (1), (2);
    INSERT INTO clusters VALUES (1, 'my-garden');
    INSERT INTO chat_sessions VALUES (42, 'garden_chat');
    INSERT INTO conversations(id, public_id, user_id, title, surface, default_garden_id, legacy_chat_session_id, temporary) VALUES
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

test("side-chat stars stay temporary, retain the chat, and reopen in the correct workspace", (t) => {
  const db = fixture(t);
  db.exec("UPDATE conversations SET origin_label = 'Side chat' WHERE id = 4");
  assert.equal(sideChatHasStars(db, 1, 4), false);
  setMessageStar(db, 1, { conversationId: "conv_temp", messageId: "msg_5", starred: true });
  assert.equal(sideChatHasStars(db, 1, 4), true);
  assert.equal(sideChatHasStars(db, 2, 4), false);
  assert.equal(db.prepare("SELECT temporary FROM conversations WHERE id = 4").get().temporary, 1);
  let star = listStarredMessages(db, 1)[0];
  assert.equal(star.sideChat, true);
  assert.equal(starredMessageHref(star), "/dashboard?sideChat=conv_temp&message=msg_5");
  assert.equal(getStarredMessageContent(db, 1, "msg_5").content, "Temporary response");
  assert.throws(() => setMessageStar(db, 2, { conversationId: "conv_temp", messageId: "msg_5", starred: true }), /no longer available/);
  db.exec("UPDATE conversations SET surface = 'garden_chat', default_garden_id = 1 WHERE id = 4");
  star = listStarredMessages(db, 1)[0];
  assert.equal(star.chatId, "conv_temp");
  assert.equal(star.gardenSlug, "my-garden");
  assert.equal(starredMessageHref(star), "/gardens/my-garden?sideChat=conv_temp&message=msg_5");
  setMessageStar(db, 1, { conversationId: "conv_temp", messageId: "msg_5", starred: false });
  assert.equal(sideChatHasStars(db, 1, 4), false);
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

test("saved message popups read the full current answer and enforce ownership", (t) => {
  const db = fixture(t);
  const content = "# Full answer\n\n" + "Long saved response. ".repeat(100) + "\n\nFINAL SENTENCE";
  db.prepare("UPDATE conversation_messages SET content = ? WHERE id = 1").run(content);
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "msg_1", starred: true });
  setMessageStar(db, 1, { conversationId: "42", messageId: "msg_4", starred: true });
  assert.equal(listStarredMessages(db, 1).find(message => message.messageId === "msg_1").preview.length, 300);
  assert.deepEqual(getStarredMessageContent(db, 1, "msg_1"), { messageId: "msg_1", content });
  assert.equal(getStarredMessageContent(db, 1, "msg_4").content, "Garden response");
  assert.throws(() => getStarredMessageContent(db, 2, "msg_1"), /no longer available/);
  for (const messageId of ["msg_2", "msg_3", "msg_5", "msg_999"]) {
    assert.throws(() => getStarredMessageContent(db, 1, messageId), /no longer available/);
  }
  db.prepare("UPDATE conversation_messages SET content = 'Updated answer' WHERE id = 1").run();
  assert.equal(getStarredMessageContent(db, 1, "msg_1").content, "Updated answer");
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "msg_1", starred: false });
  assert.throws(() => getStarredMessageContent(db, 1, "msg_1"), /no longer available/);
  db.prepare("DELETE FROM conversations WHERE id = 3").run();
  assert.throws(() => getStarredMessageContent(db, 1, "msg_4"), /no longer available/);
});

test("Quartz and PDF answers belong to Garden stars and reopen through the message hub", (t) => {
  const db = fixture(t);
  db.exec("UPDATE chat_sessions SET history_surface = 'assistant' WHERE id = 42");
  setMessageStar(db, 1, { conversationId: "conv_garden", messageId: "client-turn-garden", starred: true });
  let [star] = listStarredMessages(db, 1);
  assert.equal(star.gardenSlug, "my-garden");
  assert.equal(star.workspaceChat, false);
  assert.ok(matchesStarredMessage(star, "42", "client-turn-garden"));
  assert.equal(starredMessageHref(star), "/dashboard?terminalChat=conv_garden&message=msg_4");
  db.exec("UPDATE conversations SET origin_label = 'PDF Assistant' WHERE id = 1");
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "client-turn-one", starred: true, pdfGardenId: () => 1 });
  // Retrying a star from the message hub must preserve its source Garden.
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "msg_1", starred: true });
  star = listStarredMessages(db, 1).find(message => message.messageId === "msg_1");
  assert.equal(star.gardenSlug, "my-garden");
  assert.equal(starredMessageHref(star), "/dashboard?terminalChat=conv_one&message=msg_1");
  assert.equal(getStarredMessageContent(db, 1, "msg_1").content, "Full response");
  assert.equal(db.prepare("SELECT default_garden_id FROM conversations WHERE id = 1").get().default_garden_id, null);
  setMessageStar(db, 1, { conversationId: "conv_one", messageId: "msg_1", starred: false, pdfGardenId: () => { throw Error("Unstar needs no source access"); } });
  assert.equal(listStarredMessages(db, 1).length, 1);
});

test("PDF source resolution runs only for an authorized PDF reply", (t) => {
  const db = fixture(t);
  const pdfGardenId = () => { throw Error("Should not resolve source"); };
  assert.throws(() => setMessageStar(db, 1, { conversationId: "conv_two", messageId: "msg_3", starred: true, pdfGardenId }), /no longer available/);
  setMessageStar(db, 1, { conversationId: "conv_garden", messageId: "msg_4", starred: true, pdfGardenId });
});

test("existing star databases gain source Garden scope without losing stars", (t) => {
  const db = fixture(t);
  db.exec(`DROP TABLE starred_messages;
    CREATE TABLE starred_messages(user_id INTEGER, message_id INTEGER, starred_at TEXT, PRIMARY KEY(user_id, message_id));
    INSERT INTO starred_messages VALUES (1, 1, '2026-10-05');`);
  ensureStarredMessagesSchema(db);
  ensureStarredMessagesSchema(db);
  assert.equal(listStarredMessages(db, 1)[0].messageId, "msg_1");
  assert.equal(db.prepare("SELECT garden_id FROM starred_messages").get().garden_id, null);
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
  const inlineReply = wholeMessageReply("msg_1", content, "inline");
  assert.equal(inlineReply.mode, "inline");
  assert.equal(inlineReply.quote, content);
  assert.deepEqual(normalizeChatTextSelectionReference(JSON.parse(JSON.stringify(inlineReply))), inlineReply);
  assert.equal(normalizeChatTextSelectionReference({ ...inlineReply, start: 1 }), null);
});
