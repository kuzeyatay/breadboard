import assert from "node:assert/strict";
import test, { beforeEach, after } from "node:test";
import Database from "better-sqlite3";
import { ChatCoordinationStore, chatMessageClientId } from "../src/lib/conversations/coordination-store.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { acquireDetachedEventPump, waitForDetachedEventPumps } from "../src/lib/hermes/detached-event-pump.ts";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
  INSERT INTO users VALUES (1),(2);
  CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,user_id INTEGER,title TEXT,surface TEXT,
    default_garden_id INTEGER,temporary INTEGER DEFAULT 0,archived_at TEXT);
  CREATE TABLE conversation_messages(conversation_id INTEGER,client_message_id TEXT,role TEXT,status TEXT,content TEXT);`);
const store = new ChatCoordinationStore(db);
beforeEach(() => {
  db.exec(`DELETE FROM chat_agent_messages; DELETE FROM conversation_messages; DELETE FROM conversations;
    INSERT INTO conversations VALUES
      (1,'conv_one',1,'Chat one','dashboard_terminal',NULL,0,NULL),
      (2,'conv_two',1,'Chat two','dashboard_terminal',NULL,0,NULL),
      (3,'conv_three',1,'Chat three','garden_chat',7,0,NULL),
      (4,'conv_foreign',2,'Foreign','dashboard_terminal',NULL,0,NULL),
      (5,'conv_temporary',1,'Temporary','dashboard_terminal',NULL,1,NULL),
      (6,'conv_archived',1,'Archived','dashboard_terminal',NULL,0,'yesterday'),
      (7,'conv_public',1,'Public','quartz_ai',NULL,0,NULL);`);
});
after(() => db.close());
const send = (overrides = {}) => store.enqueue({ userId: 1, sourceId: 1, targetId: "conv_two", sourceRunId: "run-one", requestId: "question-one", message: "What did we decide?", ...overrides });
const errorCode = code => error => error.code === code;

test("two chats exchange a durable question and its exact answer", () => {
  const sent = send();
  assert.equal(store.receipt(1, 1, sent.id).status, "queued");
  assert.equal("error" in store.receipt(1, 1, sent.id), false, "a queued receipt is a successful tool result");
  assert.equal(store.claim(sent.id), true);
  assert.equal(store.claim(sent.id), false);
  store.finish(sent.id, "running");
  assert.equal("error" in store.receipt(1, 1, sent.id), false, "a running receipt must not trigger Hermes error detection");
  db.prepare("INSERT INTO conversation_messages VALUES (?,?,'assistant','complete',?)")
    .run(2, chatMessageClientId(sent.id), "We chose the 47 ohm resistor.");
  const restored = new ChatCoordinationStore(db);
  assert.deepEqual(restored.receipt(1, 1, sent.id), { messageId: sent.id, chatId: "conv_two", title: "Chat two",
    status: "complete", answer: "We chose the 47 ohm resistor.", answerTruncated: false });
  assert.equal(restored.next(2), undefined);
});

test("retrying a send returns the same receipt; different payloads cannot reuse its key", () => {
  const sent = send();
  assert.equal(send().id, sent.id);
  assert.throws(() => send({ message: "Different request" }), errorCode("chat_message_conflict"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM chat_agent_messages").get().n, 1);
});

test("reusing a request label in a later turn starts fresh work", () => {
  const first = send();
  const nextTurn = send({ sourceRunId: "run-later" });
  assert.notEqual(first.id, nextTurn.id);
  assert.equal(send({ sourceRunId: "run-later" }).id, nextTurn.id);
});

test("user, temporary, archive, public surface and sender boundaries are enforced", () => {
  for (const targetId of ["conv_foreign", "conv_temporary", "conv_archived", "conv_public", "missing"]) {
    assert.throws(() => send({ targetId }), errorCode("chat_unavailable"));
  }
  for (const sourceId of [4,5,6,7]) assert.throws(() => send({ sourceId }), errorCode("chat_unavailable"));
  assert.throws(() => send({ targetId: "conv_one" }), errorCode("chat_self_message"));
  const sent = send();
  assert.throws(() => store.receipt(2, 1, sent.id), errorCode("chat_message_not_found"));
  assert.throws(() => store.receipt(1, 2, sent.id), errorCode("chat_message_not_found"));
});

test("chat discovery paginates and filters inaccessible Gardens", () => {
  assert.deepEqual(store.list(1, "", 0, 50, []).map(c => c.chatId), ["conv_one", "conv_two"]);
  assert.deepEqual(store.list(1, "CHAT", 1, 1, [7]).map(c => c.chatId), ["conv_two"]);
  assert.deepEqual(store.list(1, "three", 0, 50, [7]).map(c => c.chatId), ["conv_three"]);
});

test("concurrent chains cannot deadlock through two or three chats", () => {
  const first = send();
  assert.throws(() => send({ sourceId: 2, targetId: "conv_one", sourceRunId: "run-two" }), errorCode("chat_coordination_cycle"));
  const second = send({ sourceId: 2, targetId: "conv_three", sourceRunId: "run-two", parentId: first.id });
  assert.throws(() => send({ sourceId: 3, targetId: "conv_one", sourceRunId: "run-three", parentId: second.id }), errorCode("chat_coordination_cycle"));
  store.finish(first.id, "complete");
  store.finish(second.id, "complete");
  // Even a completed ancestor cannot be used to start recursive ping-pong.
  assert.throws(() => send({ sourceId: 3, targetId: "conv_one", sourceRunId: "run-three", parentId: second.id }), errorCode("chat_coordination_cycle"));
});

test("a queue survives new store instances and only one dispatcher claims a target", () => {
  const first = send();
  const second = send({ requestId: "second", message: "Follow up" });
  const restored = new ChatCoordinationStore(db);
  assert.equal(restored.next(2).id, first.id);
  assert.equal(restored.claim(first.id), true);
  assert.throws(() => restored.claim(second.id), /UNIQUE constraint/);
  store.finish(first.id, "complete");
  assert.equal(restored.next(2).id, second.id);
});

test("failed and stopped answers never masquerade as successful responses", () => {
  for (const status of ["failed", "aborted"]) {
    const sent = send({ requestId: status });
    db.prepare("INSERT INTO conversation_messages VALUES (?,?,'assistant',?,?)").run(2, chatMessageClientId(sent.id), status, "Partial answer");
    const result = store.receipt(1, 1, sent.id);
    assert.equal(result.status, status === "aborted" ? "cancelled" : "failed");
    assert.equal(result.answer, null);
    assert.ok(result.error);
  }
});

test("deleted conversations remove their envelopes and large answers are explicitly bounded", () => {
  const sent = send();
  db.prepare("INSERT INTO conversation_messages VALUES (?,?,'assistant','complete',?)").run(2, chatMessageClientId(sent.id), "a".repeat(24001));
  assert.equal(store.receipt(1, 1, sent.id).answer.length, 24000);
  assert.equal(store.receipt(1, 1, sent.id).answerTruncated, true);
  db.prepare("DELETE FROM conversations WHERE id = 2").run();
  assert.equal(store.get(sent.id), undefined);
});

test("coordination is available on both private chat surfaces but never public Quartz", () => {
  for (const name of ["chat_list", "chat_send_message", "chat_wait"]) {
    assert.ok(allowedToolsForSurface("dashboard_terminal").includes(name));
    assert.ok(allowedToolsForSurface("garden_chat").includes(name));
    assert.ok(!allowedToolsForSurface("quartz_ai").includes(name));
  }
});

test("a turn cannot create an unbounded message fan-out", () => {
  for (let i = 0; i < 16; i++) send({ requestId: `message-${i}` });
  assert.throws(() => send({ requestId: "too-many" }), errorCode("chat_message_limit"));
  assert.ok(send({ requestId: "new-turn", sourceRunId: "run-new" }));
});

test("finite workers join queued delivery before its receiving turn has a pump", async () => {
  let releaseDelivery;
  let releaseAnswer;
  const deliveryGate = new Promise(resolve => { releaseDelivery = resolve; });
  const answerGate = new Promise(resolve => { releaseAnswer = resolve; });
  const deliveries = globalThis.__breadboardChatCoordinationPromises = new Map();
  const work = deliveryGate.then(() => {
    acquireDetachedEventPump("coordination-test", async sink => { await answerGate; sink.close(); });
  }).finally(() => deliveries.delete(2));
  deliveries.set(2, work);
  let joined = false;
  const joinedWork = waitForDetachedEventPumps().then(() => { joined = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joined, false);
  releaseDelivery();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joined, false);
  releaseAnswer();
  await joinedWork;
  assert.equal(joined, true);
  delete globalThis.__breadboardChatCoordinationPromises;
});
