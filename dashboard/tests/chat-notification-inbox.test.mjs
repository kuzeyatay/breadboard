import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  chatNotificationHref,
  chatNotificationTargetKey,
  isChatNotificationRecord,
  isChatNotificationTarget,
  queueChatNotificationReply,
  sameChatNotificationTarget,
  sendChatNotificationReply,
  takeChatNotificationReply,
} from "../src/lib/chat-notification-inbox.ts";
import { resolveNotificationReply } from "../src/lib/chat-notifications/reply.ts";
import { assistantHandoffContent } from "../src/lib/hermes/assistant-visible-content.ts";
import {
  chatNotificationMessageId,
  dismissChatNotifications,
  dismissChatNotificationsForTarget,
  ensureChatNotificationBaseline,
  ensureChatNotificationSchema,
  listPendingChatNotifications,
  MAX_PENDING_CHAT_NOTIFICATIONS,
  listUnreadChatMessages,
  markUnreadChatMessagesSeen,
} from "../src/lib/chat-notifications/store.ts";

const source = (relative) =>
  fs.readFileSync(new URL(relative, import.meta.url), "utf8");

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const gardenTarget = {
  surface: "garden_chat",
  gardenSlug: "breadboard-dev",
  chatId: "42",
};
const otherGardenTarget = {
  surface: "garden_chat",
  gardenSlug: "another-garden",
  chatId: "42",
};
const terminalTarget = {
  surface: "dashboard_terminal",
  chatId: "conv_example123",
};

test("notification targets distinguish Gardens and Terminal chats", () => {
  assert.equal(
    chatNotificationTargetKey(gardenTarget),
    "garden_chat:breadboard-dev:42",
  );
  assert.equal(
    chatNotificationTargetKey(terminalTarget),
    "dashboard_terminal:conv_example123",
  );
  assert.equal(sameChatNotificationTarget(gardenTarget, gardenTarget), true);
  assert.equal(
    sameChatNotificationTarget(gardenTarget, otherGardenTarget),
    false,
  );
  assert.equal(isChatNotificationTarget(gardenTarget), true);
  assert.equal(isChatNotificationTarget(terminalTarget), true);
  assert.equal(
    isChatNotificationTarget({ surface: "garden_chat", chatId: "42" }),
    false,
  );
  assert.equal(isChatNotificationTarget({ surface: "quartz_ai", chatId: "1" }), false);
  assert.equal(
    isChatNotificationRecord({
      id: "msg_1",
      title: "Response ready",
      type: "success",
      response: "Done.",
      chatTitle: "A chat",
      target: terminalTarget,
      updatedAt: "2026-08-30 10:00:00",
    }),
    true,
  );
  assert.equal(isChatNotificationRecord({ id: "msg_1" }), false);
});

test("notification links open the exact originating chat", () => {
  assert.equal(
    chatNotificationHref(gardenTarget),
    "/gardens/breadboard-dev?chat=42",
  );
  assert.equal(
    chatNotificationHref(terminalTarget),
    "/dashboard?terminalChat=conv_example123",
  );
});

test("notice ids map back to message rows and reject anything else", () => {
  assert.equal(chatNotificationMessageId("msg_91"), 91);
  assert.equal(chatNotificationMessageId(" msg_7 "), 7);
  assert.equal(chatNotificationMessageId("msg_0"), null);
  assert.equal(chatNotificationMessageId("91"), null);
  assert.equal(chatNotificationMessageId("msg_1 OR 1=1"), null);
});

test("a cross-route reply is consumed only by its destination chat", () => {
  const storage = new MemoryStorage();
  queueChatNotificationReply(storage, gardenTarget, "  Follow up here  ");

  assert.equal(takeChatNotificationReply(storage, terminalTarget), null);
  assert.equal(
    takeChatNotificationReply(storage, gardenTarget),
    "Follow up here",
  );
  assert.equal(takeChatNotificationReply(storage, gardenTarget), null);
});

test("a notification reply posts to the background endpoint without navigation", async (context) => {
  let request = null;
  context.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url, init };
    return Response.json({ accepted: true }, { status: 202 });
  });

  await sendChatNotificationReply(gardenTarget, "Follow up here");

  assert.equal(request.url, "/api/chat-notifications/reply");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    target: gardenTarget,
    message: "Follow up here",
  });
});

test("background replies resolve only chats owned by the caller", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      slug TEXT NOT NULL
    );
    CREATE TABLE chat_sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      conversation_id INTEGER
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY,
      public_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      surface TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      default_garden_id INTEGER,
      active_agency_agent_slug TEXT,
      scheduled_chat_job_id INTEGER,
      hook_id TEXT,
      legacy_chat_session_id INTEGER,
      legacy_runtime_session_id INTEGER,
      next_order_index INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      highlight TEXT,
      temporary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO clusters(id, user_id, slug) VALUES
      (7, 1, 'breadboard-dev'),
      (8, 2, 'foreign-garden');
    INSERT INTO conversations(
      id, public_id, user_id, title, surface, scope_kind, default_garden_id,
      legacy_chat_session_id, created_at, updated_at
    ) VALUES
      (11, 'conv_example123', 1, 'Terminal', 'dashboard_terminal', 'global', NULL, NULL, 'now', 'now'),
      (12, 'conv_garden', 1, 'Garden', 'garden_chat', 'garden', 7, 42, 'now', 'now'),
      (13, 'conv_foreign', 2, 'Foreign', 'garden_chat', 'garden', 8, 43, 'now', 'now');
    INSERT INTO chat_sessions(id, user_id, conversation_id) VALUES
      (42, 1, 12),
      (43, 2, 13);
  `);

  assert.equal(
    resolveNotificationReply(terminalTarget, 1, database).conversation.public_id,
    "conv_example123",
  );
  assert.deepEqual(resolveNotificationReply(gardenTarget, 1, database), {
    conversation: database.prepare("SELECT * FROM conversations WHERE id = 12").get(),
    activeGardenSlug: "breadboard-dev",
  });
  assert.throws(
    () => resolveNotificationReply(otherGardenTarget, 1, database),
    /Conversation not found/,
  );
  assert.throws(
    () =>
      resolveNotificationReply(
        { surface: "garden_chat", gardenSlug: "foreign-garden", chatId: "43" },
        1,
        database,
      ),
    /Conversation not found/,
  );
  database.close();
});

function notificationDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE clusters (id INTEGER PRIMARY KEY, slug TEXT NOT NULL);
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      surface TEXT NOT NULL,
      default_garden_id INTEGER,
      legacy_chat_session_id INTEGER,
      temporary INTEGER NOT NULL DEFAULT 0,
      buzz_room_id INTEGER,
      origin_label TEXT
    );
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      client_message_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      metadata TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO users (id) VALUES (1), (2);
    INSERT INTO clusters (id, slug) VALUES (5, 'breadboard-dev');
    INSERT INTO conversations
      (id, public_id, user_id, title, surface, default_garden_id, legacy_chat_session_id)
    VALUES
      (10, 'conv_terminal', 1, 'Terminal chat', 'dashboard_terminal', NULL, NULL),
      (11, 'conv_garden', 1, 'Garden chat', 'garden_chat', 5, 42),
      (12, 'conv_temporary', 1, 'Off the record', 'dashboard_terminal', NULL, NULL),
      (13, 'conv_other_user', 2, 'Someone else', 'dashboard_terminal', NULL, NULL),
      (14, 'conv_telegram', 1, 'Renamed Telegram chat', 'dashboard_terminal', NULL, NULL),
      (15, 'conv_voice', 1, 'News briefing', 'dashboard_terminal', NULL, NULL);
    UPDATE conversations SET temporary = 1 WHERE id = 12;
    UPDATE conversations SET origin_label = 'Voice' WHERE id = 15;
  `);
  ensureChatNotificationSchema(db);
  return db;
}

function addAnswer(
  db,
  conversationId,
  content,
  updatedAt,
  status = "complete",
  metadata = null,
  clientMessageId = null,
) {
  return Number(
    db.prepare(`
      INSERT INTO conversation_messages
        (conversation_id, client_message_id, role, content, status, updated_at, metadata)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?)
    `).run(
      conversationId,
      clientMessageId,
      content,
      status,
      updatedAt,
      metadata,
    ).lastInsertRowid,
  );
}

test("unread dots share canonical and Garden identities, survive reloads, and reset for a new answer", () => {
  const db = notificationDatabase();
  try {
    addAnswer(db, 10, "Old history", "2026-08-30 08:00:00");
    assert.deepEqual(listUnreadChatMessages(db, 1), []);
    const garden = addAnswer(db, 11, "Garden answer", "2026-08-30 09:00:00");
    assert.deepEqual(listUnreadChatMessages(db, 1), [{ id: `msg_${garden}`, target: { ...gardenTarget, conversationId: "conv_garden" } }]);
    assert.equal(markUnreadChatMessagesSeen(db, 2, [garden]), 0);
    assert.equal(markUnreadChatMessagesSeen(db, 1, [], { surface: "dashboard_terminal", chatId: "conv_garden" }), 1);
    assert.deepEqual(listUnreadChatMessages(db, 1), []);
    const next = addAnswer(db, 11, "Next answer", "2026-08-30 10:00:00");
    assert.deepEqual(listUnreadChatMessages(db, 1).map(row => row.id), [`msg_${next}`]);
    assert.equal(markUnreadChatMessagesSeen(db, 1, [], gardenTarget), 1);
    assert.deepEqual(listUnreadChatMessages(db, 1), []);
  } finally { db.close(); }
});

test("unread dots cover every durable assistant surface beyond the corner-notice limit", () => {
  const db = notificationDatabase();
  try {
    listUnreadChatMessages(db, 1);
    ensureChatNotificationBaseline(db, 1);
    db.prepare("UPDATE conversations SET surface = 'quartz_ai' WHERE id = 11").run();
    const quartz = addAnswer(db, 11, "Page assistant", "2026-08-30 08:00:00");
    const voice = addAnswer(db, 15, "Voice", "2026-08-30 08:00:00");
    addAnswer(db, 12, "Temporary", "2026-08-30 09:00:00");
    addAnswer(db, 13, "Another account", "2026-08-30 09:00:00");
    for (let n = 0; n < MAX_PENDING_CHAT_NOTIFICATIONS + 5; n++) addAnswer(db, 10, `Answer ${n}`, "2026-08-30 10:00:00");
    assert.equal(listPendingChatNotifications(db, 1).length, MAX_PENDING_CHAT_NOTIFICATIONS);
    const unread = listUnreadChatMessages(db, 1);
    assert.equal(unread.length, MAX_PENDING_CHAT_NOTIFICATIONS + 7);
    assert.ok(unread.some(row => row.id === `msg_${quartz}`));
    assert.ok(unread.some(row => row.id === `msg_${voice}`));
    assert.equal(markUnreadChatMessagesSeen(db, 1, [quartz, voice]), 2);
    assert.equal(listUnreadChatMessages(db, 1).length, MAX_PENDING_CHAT_NOTIFICATIONS + 5);
  } finally { db.close(); }
});

test("the shared unread migration preserves answers already waiting in the account inbox", () => {
  const db = notificationDatabase();
  try {
    addAnswer(db, 10, "Already read", "2026-08-30 08:00:00");
    ensureChatNotificationBaseline(db, 1);
    const pending = addAnswer(db, 11, "Waiting to be read", "2026-08-30 09:00:00");
    addAnswer(db, 15, "Old spoken answer", "2026-08-30 09:00:00");
    assert.deepEqual(listUnreadChatMessages(db, 1).map(row => row.id), [`msg_${pending}`]);
    markUnreadChatMessagesSeen(db, 1, [], gardenTarget);
    assert.deepEqual(listUnreadChatMessages(db, 1), []);
  } finally { db.close(); }
});

test("reading a handoff cannot consume the delegated answer that finishes later", () => {
  const db = notificationDatabase();
  try {
    listUnreadChatMessages(db, 1);
    const id = addAnswer(db, 10, "Starting research", "2026-08-30 09:00:00", "complete", JSON.stringify({ externalAgentOutcome: "running" }));
    assert.deepEqual(listUnreadChatMessages(db, 1), []);
    assert.equal(markUnreadChatMessagesSeen(db, 1, [id]), 0);
    db.prepare("UPDATE conversation_messages SET content = 'Research answer', metadata = '{}', updated_at = '2026-08-30 10:00:00' WHERE id = ?").run(id);
    assert.deepEqual(listUnreadChatMessages(db, 1).map(row => row.id), [`msg_${id}`]);
  } finally { db.close(); }
});

test("the first read draws a line under existing history", () => {
  const db = notificationDatabase();
  addAnswer(db, 10, "An old answer", "2026-08-30 09:00:00");

  assert.deepEqual(listPendingChatNotifications(db, 1), []);
  const baseline = ensureChatNotificationBaseline(db, 1);
  assert.equal(baseline.updated_at, "2026-08-30 09:00:00");

  const fresh = addAnswer(db, 10, "A new answer", "2026-08-30 09:05:00");
  const pending = listPendingChatNotifications(db, 1);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, `msg_${fresh}`);
  assert.equal(pending[0].title, "Response ready");
  assert.deepEqual(pending[0].target, {
    surface: "dashboard_terminal",
    chatId: "conv_terminal",
  });

  // A brand-new account with no history starts announcing immediately.
  assert.deepEqual(listPendingChatNotifications(db, 2), []);
  const first = addAnswer(db, 13, "First ever", "2026-08-30 09:06:00");
  assert.deepEqual(
    listPendingChatNotifications(db, 2).map((record) => record.id),
    [`msg_${first}`],
  );
});

test("Telegram replies never become Breadboard notifications", () => {
  const db = notificationDatabase();
  const oldTelegram = addAnswer(
    db,
    14,
    "An old Telegram reply",
    "2026-08-30 08:00:00",
    "complete",
    null,
    "telegram-chat-1:1",
  );

  assert.deepEqual(listPendingChatNotifications(db, 1), []);
  assert.deepEqual(ensureChatNotificationBaseline(db, 1), {
    updated_at: "",
    message_id: 0,
  });

  const terminal = addAnswer(
    db,
    10,
    "A Breadboard reply",
    "2026-08-30 08:05:00",
  );
  const freshTelegram = addAnswer(
    db,
    14,
    "A new Telegram reply",
    "2026-08-30 08:06:00",
    "complete",
    null,
    "telegram-chat-1:2",
  );

  assert.deepEqual(
    listPendingChatNotifications(db, 1).map((record) => record.id),
    [`msg_${terminal}`],
  );
  assert.equal(dismissChatNotifications(db, 1, [oldTelegram, freshTelegram]), 0);
  assert.match(
    source("../src/lib/telegram/inbound.ts"),
    /const clientMessageId = `telegram-\$\{/,
  );
});

test("a Garden response matches its canonical chat when opened in the Terminal hub", () => {
  const target = { ...gardenTarget, conversationId: 'conv_garden' };
  const hubTarget = { surface: 'dashboard_terminal', chatId: 'conv_garden' };
  assert.equal(sameChatNotificationTarget(target, hubTarget), true);
  assert.equal(sameChatNotificationTarget(hubTarget, target), true);
  assert.equal(sameChatNotificationTarget(target, gardenTarget), true);
  assert.equal(sameChatNotificationTarget(target, terminalTarget), false);
  assert.equal(sameChatNotificationTarget(target, otherGardenTarget), false);
  assert.equal(chatNotificationHref(target), '/gardens/breadboard-dev?chat=42');
  assert.equal(isChatNotificationTarget({ ...target, conversationId: 42 }), false);
});

test('Voice responses stay out of the shared inbox, including failures and later reads after closing', () => {
  const db = notificationDatabase();
  try {
    addAnswer(db, 15, 'Earlier spoken answer', '2026-09-06 08:00:00');
    assert.deepEqual(listPendingChatNotifications(db, 1), []);
    assert.deepEqual(ensureChatNotificationBaseline(db, 1), { updated_at: '', message_id: 0 });
    addAnswer(db, 15, 'Here is the news briefing.', '2026-09-06 08:05:00');
    addAnswer(db, 15, 'The answer could not finish.', '2026-09-06 08:06:00', 'failed');
    addAnswer(db, 15, 'Goodbye, Kuzey.', '2026-09-06 08:07:00');
    // Provenance survives renaming and requires no open voice window or
    // client-side dismissal. Ordinary chat notifications remain available.
    db.prepare('UPDATE conversations SET title = ? WHERE id = 15').run('Renamed conversation');
    db.prepare('UPDATE conversations SET title = ? WHERE id = 10').run('Voice');
    const terminal = addAnswer(db, 10, 'A typed chat answer.', '2026-09-06 08:08:00');
    const garden = addAnswer(db, 11, 'A garden answer.', '2026-09-06 08:09:00');
    for (let read = 0; read < 3; read++) {
      assert.deepEqual(listPendingChatNotifications(db, 1).map(record => record.id), [`msg_${terminal}`, `msg_${garden}`]);
    }
  } finally { db.close(); }
});

test("hidden workers and Telegram-owned continuations never raise false chat notices", () => {
  const db = notificationDatabase();
  listPendingChatNotifications(db, 1);

  addAnswer(
    db,
    14,
    "",
    "2026-08-30 08:10:00",
    "complete",
    JSON.stringify({
      delegatedAgentRun: true,
      externalAgentOutcome: "completed",
      externalAgentResult: "A complete research report",
      deliveryChannel: "telegram",
    }),
    "agent-launch-research-1",
  );
  addAnswer(
    db,
    14,
    "The final synthesis",
    "2026-08-30 08:11:00",
    "complete",
    JSON.stringify({
      internalAgentContinuation: true,
      deliveryChannel: "telegram",
    }),
    "browser-generated-continuation-id",
  );

  assert.deepEqual(listPendingChatNotifications(db, 1), []);

  const ordinary = addAnswer(
    db,
    10,
    "An ordinary in-app answer",
    "2026-08-30 08:12:00",
  );
  assert.deepEqual(
    listPendingChatNotifications(db, 1).map((record) => record.id),
    [`msg_${ordinary}`],
  );
});

test("delegated progress stays in Thinking until the synthesis is ready on either chat surface", (t) => {
  const db = notificationDatabase();
  t.after(() => db.close());
  listPendingChatNotifications(db, 1);
  const progress = "Max Research is reviewing the evidence while Deep Research builds your personalized beginner program. I’ll combine their results into one calorie, diet, training, supplement, and August 2027 roadmap.";
  const externalAgents = [{ agentName: "Max Research", carried: false }, { agentName: "Deep Research" }];
  const verification = { externalAgents };
  assert.equal(assistantHandoffContent({ content: progress, verification }), progress);

  for (const conversationId of [10, 11]) {
    // Both canonical and reconciled Garden metadata must follow the same rule.
    for (const metadata of [{ verification }, { toolCalls: { verification } }]) {
      const id = addAnswer(db, conversationId, progress, "2026-09-07 10:30:00", "complete", JSON.stringify(metadata));
      assert.deepEqual(listPendingChatNotifications(db, 1), []);
      assert.equal(dismissChatNotifications(db, 1, [id]), 0);
    }
  }
  const synthesis = "Here are the combined calorie, diet, training, supplement, and timeline recommendations.";
  const returned = { externalAgents: externalAgents.map(agent => ({ ...agent, carried: true })) };
  assert.equal(assistantHandoffContent({ content: synthesis, verification: returned }), "");
  const finalIds = [10, 11].map(conversationId => addAnswer(db, conversationId, synthesis,
    "2026-09-07 10:40:00", "complete", JSON.stringify({ internalAgentContinuation: true, verification: returned })));
  for (let poll = 0; poll < 2; poll++) {
    assert.deepEqual(listPendingChatNotifications(db, 1).map(record => record.id), finalIds.map(id => `msg_${id}`));
  }
  assert.equal(dismissChatNotifications(db, 1, finalIds), 2);
  assert.deepEqual(listPendingChatNotifications(db, 1), []);
});

test("viewing or baselining a running worker cannot consume its eventual result", (t) => {
  const db = notificationDatabase();
  t.after(() => db.close());
  const id = addAnswer(db, 10, "Research is running.", "2026-09-07 10:30:00", "complete",
    JSON.stringify({ externalAgent: true, externalAgentOutcome: "running" }));
  assert.deepEqual(listPendingChatNotifications(db, 1), []);
  assert.deepEqual(ensureChatNotificationBaseline(db, 1), { updated_at: "", message_id: 0 });
  assert.equal(dismissChatNotificationsForTarget(db, 1, { surface: "dashboard_terminal", chatId: "conv_terminal" }), 0);
  assert.equal(dismissChatNotifications(db, 1, [id]), 0);
  // A fast worker can finish within the same SQLite timestamp second.
  db.prepare("UPDATE conversation_messages SET content = ?, metadata = ? WHERE id = ?")
    .run("The research report is ready.", JSON.stringify({ externalAgent: true, externalAgentOutcome: "completed" }), id);
  assert.deepEqual(listPendingChatNotifications(db, 1).map(record => record.id), [`msg_${id}`]);
});

test("preambles and empty progress do not notify or crowd finished answers out of the inbox", (t) => {
  const db = notificationDatabase();
  t.after(() => db.close());
  listPendingChatNotifications(db, 1);
  const answer = addAnswer(db, 10, "An actual answer.", "2026-09-07 10:30:00");
  const progress = "I am preparing the answer.";
  for (let index = 0; index < MAX_PENDING_CHAT_NOTIFICATIONS * 4 + 1; index++) {
    addAnswer(db, 10, `\n\t${progress}\n`, "2026-09-07 10:31:00", "complete",
      JSON.stringify({ delegatedAgentPreamble: progress }));
  }
  addAnswer(db, 10, "\n\t ", "2026-09-07 10:32:00", "complete", JSON.stringify({ progressNotes: [progress] }));
  assert.deepEqual(listPendingChatNotifications(db, 1).map(record => record.id), [`msg_${answer}`]);
});

test("real answers, carried results, and failures still notify with delegation metadata", (t) => {
  const db = notificationDatabase();
  t.after(() => db.close());
  listPendingChatNotifications(db, 1);
  const cases = [
    { content: "Ordinary answer." },
    { content: "Answer with no workers.", metadata: { verification: { externalAgents: [] } } },
    { content: "Results plus follow-up work.", metadata: { verification: { externalAgents: [{ carried: true }, { carried: false }] } } },
    { content: "Reconciled results.", metadata: { toolCalls: { verification: { externalAgents: [{ carried: true }] } } } },
    { content: "The finished answer.", metadata: { delegatedAgentPreamble: "I am preparing the answer." } },
    { content: "Research failed.", status: "failed", metadata: { verification: { externalAgents: [{ carried: false }] } } },
    { content: "Worker failed.", metadata: { externalAgentOutcome: "failed", delegatedAgentPreamble: "Worker failed." } },
    { content: "", status: "failed" },
  ];
  const ids = cases.map(({ content, status = "complete", metadata = null }) =>
    addAnswer(db, 10, content, "2026-09-07 10:30:00", status, JSON.stringify(metadata)));
  const records = listPendingChatNotifications(db, 1);
  assert.deepEqual(records.map(record => record.id), ids.map(id => `msg_${id}`));
  assert.deepEqual(records.map(record => record.title), cases.map(({ status, metadata }) =>
    status === "failed" || metadata?.externalAgentOutcome === "failed" ? "Response failed" : "Response ready"));
});

test("a dismissal is permanent and belongs to the account", () => {
  const db = notificationDatabase();
  listPendingChatNotifications(db, 1);
  const terminal = addAnswer(db, 10, "Terminal answer", "2026-08-30 10:00:00");
  const garden = addAnswer(db, 11, "Garden answer", "2026-08-30 10:00:01");
  const failed = addAnswer(db, 11, "", "2026-08-30 10:00:02", "failed");
  addAnswer(db, 12, "Temporary chat answer", "2026-08-30 10:00:03");

  const before = listPendingChatNotifications(db, 1);
  assert.deepEqual(
    before.map((record) => record.id),
    [`msg_${terminal}`, `msg_${garden}`, `msg_${failed}`],
  );
  assert.equal(before[2].title, "Response failed");
  assert.equal(before[2].response, "The response could not be completed.");
  assert.deepEqual(before[1].target, { ...gardenTarget, conversationId: 'conv_garden' });

  assert.equal(dismissChatNotifications(db, 1, [terminal]), 1);
  assert.deepEqual(
    listPendingChatNotifications(db, 1).map((record) => record.id),
    [`msg_${garden}`, `msg_${failed}`],
  );
  // Dismissing again, or dismissing someone else's notice, changes nothing.
  assert.equal(dismissChatNotifications(db, 1, [terminal]), 0);
  assert.equal(dismissChatNotifications(db, 2, [garden]), 0);
  assert.deepEqual(
    listPendingChatNotifications(db, 1).map((record) => record.id),
    [`msg_${garden}`, `msg_${failed}`],
  );
});

test("reconciled copies of one Garden selection answer dismiss as one notice", () => {
  const db = notificationDatabase();
  listPendingChatNotifications(db, 1);
  const requestId = "selection-request-1";
  const first = addAnswer(
    db,
    11,
    "One explanation",
    "2026-08-30 10:30:00",
    "complete",
    JSON.stringify({ inlineSelection: { requestId } }),
  );
  const migratedCopy = addAnswer(
    db,
    11,
    "One explanation",
    "2026-08-30 10:30:01",
    "complete",
    JSON.stringify({ toolCalls: { inlineSelection: { requestId } }, migrated: true }),
  );

  // Canonical reconciliation produced two rows, but the inbox exposes the
  // newest representation of the logical answer only once.
  assert.deepEqual(
    listPendingChatNotifications(db, 1).map((record) => record.id),
    [`msg_${migratedCopy}`],
  );

  // Closing that one visible notice retires both row ids. Neither copy can
  // become the next poll's replacement notification.
  assert.equal(listPendingChatNotifications(db, 1)[0].inlineSelectionId, requestId);
  assert.equal(dismissChatNotifications(db, 1, [migratedCopy]), 2);
  assert.deepEqual(listPendingChatNotifications(db, 1), []);
  assert.deepEqual(
    db.prepare(`
      SELECT message_id
      FROM chat_notification_dismissals
      WHERE user_id = 1
      ORDER BY message_id
    `).all().map((row) => row.message_id),
    [first, migratedCopy],
  );
});

test("a dismissal written before deduplication also hides its reconciled copy", () => {
  const db = notificationDatabase();
  listPendingChatNotifications(db, 1);
  const requestId = "selection-request-before-fix";
  const first = addAnswer(
    db,
    11,
    "One older explanation",
    "2026-08-30 10:40:00",
    "complete",
    JSON.stringify({ inlineSelection: { requestId } }),
  );
  addAnswer(
    db,
    11,
    "One older explanation",
    "2026-08-30 10:40:01",
    "complete",
    JSON.stringify({ toolCalls: { inlineSelection: { requestId } }, migrated: true }),
  );

  // This is the state produced by the previous implementation: only the row
  // whose close button was clicked was recorded as dismissed.
  db.prepare(`
    INSERT INTO chat_notification_dismissals (user_id, message_id)
    VALUES (1, ?)
  `).run(first);

  assert.deepEqual(listPendingChatNotifications(db, 1), []);
});

test("looking at a chat retires every finished answer in it", () => {
  const db = notificationDatabase();
  listPendingChatNotifications(db, 1);
  const terminal = addAnswer(db, 10, "Terminal answer", "2026-08-30 11:00:00");
  const garden = addAnswer(db, 11, "Garden answer", "2026-08-30 11:00:01");
  addAnswer(db, 11, "Still streaming", "2026-08-30 11:00:02", "pending");

  // The same legacy chat id under another garden is a different chat.
  assert.equal(dismissChatNotificationsForTarget(db, 1, otherGardenTarget), 0);
  assert.equal(dismissChatNotificationsForTarget(db, 1, gardenTarget), 1);
  assert.deepEqual(
    listPendingChatNotifications(db, 1).map((record) => record.id),
    [`msg_${terminal}`],
  );

  // The answer that was still streaming is announced once it finishes.
  db.prepare(
    "UPDATE conversation_messages SET status = 'complete', updated_at = ? WHERE content = 'Still streaming'",
  ).run("2026-08-30 11:00:05");
  assert.equal(listPendingChatNotifications(db, 1).length, 2);

  assert.equal(
    dismissChatNotificationsForTarget(db, 1, {
      surface: "dashboard_terminal",
      chatId: "conv_terminal",
    }),
    1,
  );
  assert.equal(dismissChatNotifications(db, 1, [garden]), 0);
  assert.equal(listPendingChatNotifications(db, 1).length, 1);
});

test("every surface reports the chat it shows and opens notices in place", () => {
  const toast = source("../src/app/components/toast.tsx");
  const dashboard = source("../src/app/dashboard/dashboard-client.tsx");
  const terminal = source(
    "../src/app/components/hermes/dashboard-agent-terminal.tsx",
  );
  const gardenWorkspace = source(
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const route = source("../src/app/api/chat-notifications/route.ts");
  const replyRoute = source("../src/app/api/chat-notifications/reply/route.ts");
  const schema = source("../src/lib/conversations/schema.ts");

  // The list on screen is the server's list; nothing is kept per browser.
  assert.match(toast, /listPendingChatNotifications|fetch\('\/api\/chat-notifications'/);
  assert.doesNotMatch(toast, /localStorage/);
  assert.match(toast, /postChatNotificationDismissal\(\{ dismiss: \[notificationId\] \}\)/);
  assert.match(toast, /postChatNotificationDismissal\(\{ seen: target \}\)/);
  assert.match(toast, /CHAT_RESPONSE_SEEN_EVENT/);

  assert.match(route, /export async function POST/);
  assert.match(route, /dismissChatNotificationsForTarget/);
  assert.match(replyRoute, /resolveNotificationReply/);
  assert.match(replyRoute, /startSessionEventPump\(runtime\)/);
  assert.match(replyRoute, /startConversationTurn\(\{/);
  assert.match(replyRoute, /getHermesUserSettings\(userId\)/);
  assert.match(schema, /ensureChatNotificationSchema\(database\)/);

  // Viewing a chat is reported by both surfaces; the Terminal only while the
  // dock is actually showing it.
  assert.match(terminal, /const viewingChatId = bodyMounted \? session\.sessionId : null/);
  assert.match(terminal, /setActiveChatNotificationTarget\(\s*viewingChatId/);
  assert.match(gardenWorkspace, /setActiveChatNotificationTarget\(target\)/);

  // A Terminal notice on the dashboard opens the dock without a navigation.
  assert.match(dashboard, /onOpenChat=\{openChatFromNotification\}/);
  assert.match(dashboard, /requestChatNotificationOpen\(target\)/);
  assert.match(terminal, /CHAT_NOTIFICATION_OPEN_REQUEST_EVENT/);
  assert.match(terminal, /openNotificationChatRef\.current\(chatId\)/);
});

test("both destination pages accept notification deep links", () => {
  const gardenPage = source("../src/app/gardens/[clusterSlug]/page.tsx");
  const gardenWorkspace = source(
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const dashboardPage = source("../src/app/dashboard/page.tsx");
  const terminal = source(
    "../src/app/components/hermes/dashboard-agent-terminal.tsx",
  );

  assert.match(gardenPage, /requested\.chat/);
  assert.match(gardenPage, /initialChatId=\{initialChatId\}/);
  assert.match(gardenWorkspace, /openChatById\(requested\)/);
  assert.match(dashboardPage, /requested\.terminalChat/);
  assert.match(
    dashboardPage,
    /initialTerminalChatId=\{initialTerminalChatId\}/,
  );
  assert.match(terminal, /openHistorySession\(requested\)/);
  assert.match(terminal, /takeChatNotificationReply\(window\.sessionStorage/);
});

test("an upload failure already shown in the dialog is not repeated in the corner", () => {
  const gardenWorkspace = source(
    "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
  );
  const uploadStore = source("../src/lib/garden-upload-store.ts");
  assert.match(gardenWorkspace, /showUploadRef\.current = showUpload/);
  assert.match(
    gardenWorkspace,
    /if \(!showUploadRef\.current\) \{\s*addToast\(`\$\{record\.filename\}: \$\{event\.error\}`\)/,
  );
  assert.match(
    gardenWorkspace,
    /isTaskStatusVisible: \(taskId\) =>\s*showUploadRef\.current && selectedUploadTaskIdRef\.current === taskId/,
  );
  const gatedTaskErrors = uploadStore.match(
    /if \(!taskStatusVisible\(clusterSlug, taskId\)\) \{\s*sinkToast\(clusterSlug, \{ message: `\$\{file\.name\}: \$\{(?:message|streamError)\}` \}\);/g,
  );
  assert.equal(gatedTaskErrors?.length, 6);
});
