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
import {
  chatNotificationMessageId,
  dismissChatNotifications,
  dismissChatNotificationsForTarget,
  ensureChatNotificationBaseline,
  ensureChatNotificationSchema,
  listPendingChatNotifications,
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
      buzz_room_id INTEGER
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
      (14, 'conv_telegram', 1, 'Renamed Telegram chat', 'dashboard_terminal', NULL, NULL);
    UPDATE conversations SET temporary = 1 WHERE id = 12;
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
  assert.deepEqual(before[1].target, gardenTarget);

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
