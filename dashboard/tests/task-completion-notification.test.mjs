import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  chatResponseNotification,
  notifyChatResponseFailed,
  notifyChatResponseReady,
  CHAT_RESPONSE_SEEN_EVENT,
  notifyTaskCompleted,
  TASK_COMPLETION_NOTIFICATION_EVENT,
  taskCompletionLabel,
  taskCompletionNotification,
} from "../src/lib/task-completion-notification.ts";

const source = (relative) =>
  fs.readFileSync(new URL(relative, import.meta.url), "utf8");

test("completion notification names the finished task concisely", () => {
  assert.equal(
    taskCompletionLabel("  /interactive-visualizer   build a spring damper model  "),
    "build a spring damper model",
  );
  const longLabel = taskCompletionLabel("x".repeat(120));
  assert.equal(longLabel.length, 78);
  assert.match(longLabel, /…$/);
  assert.deepEqual(taskCompletionNotification("summarize the lecture"), {
    title: "Task completed",
    message: "Finished “summarize the lecture”.",
    type: "success",
  });
  assert.deepEqual(chatResponseNotification("summarize the lecture"), {
    title: "Response ready",
    message: "Answered “summarize the lecture”.",
    type: "success",
  });
  assert.deepEqual(chatResponseNotification("summarize the lecture", "error"), {
    title: "Response failed",
    message: "Couldn’t finish “summarize the lecture”.",
    type: "error",
  });
});

test("completion notification dispatches through the shared page toaster", () => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const eventTarget = new EventTarget();
  let received = null;
  class TestCustomEvent extends Event {
    constructor(type, options) {
      super(type);
      this.detail = options?.detail;
    }
  }
  globalThis.window = eventTarget;
  globalThis.CustomEvent = TestCustomEvent;
  eventTarget.addEventListener(
    TASK_COMPLETION_NOTIFICATION_EVENT,
    (event) => {
      received = event.detail;
    },
  );
  try {
    notifyTaskCompleted("research the source");
    assert.deepEqual(received, taskCompletionNotification("research the source"));

    notifyChatResponseReady("background answer", {
      chatId: 42,
      activeChatId: 7,
      response: "The complete answer stays visible without added dots.",
    });
    assert.equal(received.chatId, "42");
    assert.equal(received.title, "Response ready");
    assert.equal(
      received.response,
      "The complete answer stays visible without added dots.",
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});

test("completion notification stays silent for the focused chat", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousCustomEvent = globalThis.CustomEvent;
  const eventTarget = new EventTarget();
  let count = 0;
  class TestCustomEvent extends Event {
    constructor(type, options) {
      super(type);
      this.detail = options?.detail;
    }
  }
  globalThis.window = eventTarget;
  globalThis.document = {
    visibilityState: "visible",
    hasFocus: () => true,
  };
  globalThis.CustomEvent = TestCustomEvent;
  eventTarget.addEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, () => {
    count += 1;
  });
  // An answer that lands in the open chat is reported as seen instead, so the
  // account-wide inbox can retire it before any window announces it.
  const seenChatIds = [];
  eventTarget.addEventListener(CHAT_RESPONSE_SEEN_EVENT, (event) => {
    seenChatIds.push(event.detail.chatId);
  });
  try {
    notifyTaskCompleted("visible task", {
      chatId: "chat-a",
      activeChatId: "chat-a",
    });
    assert.equal(count, 0);
    assert.deepEqual(seenChatIds, []);

    notifyTaskCompleted("background task", {
      chatId: "chat-b",
      activeChatId: "chat-a",
    });
    assert.equal(count, 1);

    notifyChatResponseReady("background answer", {
      chatId: "chat-b",
      activeChatId: "chat-a",
    });
    notifyChatResponseFailed("background failure", {
      chatId: "chat-b",
      activeChatId: "chat-a",
    });
    assert.equal(count, 3);

    // The open chat stays silent even when the window has lost focus.
    globalThis.document = {
      visibilityState: "hidden",
      hasFocus: () => false,
    };
    notifyChatResponseFailed("open chat failure, window unfocused", {
      chatId: "chat-a",
      activeChatId: "chat-a",
    });
    notifyChatResponseReady("open chat answer, window unfocused", {
      chatId: "chat-a",
      activeChatId: "chat-a",
    });
    assert.equal(count, 3);
    assert.deepEqual(seenChatIds, ["chat-a", "chat-a"]);
    notifyChatResponseFailed("background failure, window unfocused", {
      chatId: "chat-b",
      activeChatId: "chat-a",
    });
    assert.equal(count, 4);
    // A run with no chat of its own still notifies when the window is away.
    notifyTaskCompleted("chatless task, window unfocused");
    assert.equal(count, 5);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});

test("chat completions and failures notify through persistent minimal notices", () => {
  const toast = source("../src/app/components/toast.tsx");
  const notificationApi = source("../src/lib/chat-notifications/store.ts");
  const session = source("../src/app/components/hermes/use-agent-session.ts");
  const garden = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const gardenSessions = source("../src/app/api/chat-sessions/route.ts");
  const browser = source("../src/app/components/hermes/inline-browser-run.tsx");
  const agentBrowser = source("../src/app/components/hermes/inline-agent-browser-run.tsx");
  const research = source("../src/app/components/hermes/inline-deep-research-run.tsx");
  const openPlanter = source("../src/app/components/hermes/inline-openplanter-run.tsx");

  assert.match(toast, /TASK_COMPLETION_NOTIFICATION_EVENT/);
  assert.match(toast, /t\.title/);
  assert.match(toast, /bg-\[var\(--paper-surface\)\]/);
  assert.match(toast, /size-2/);
  assert.match(toast, /bg-\[var\(--botanical\)\]/);
  assert.match(toast, /bg-\[var\(--danger\)\]/);
  assert.match(toast, /dismissChatToasts/);
  assert.match(toast, /aria-label="Open this chat"/);
  assert.match(toast, /↗/);
  assert.match(toast, /w-\[min\(36rem,calc\(100vw-2rem\)\)\]/);
  assert.match(toast, /max-h-\[min\(42vh,24rem\)\] overflow-y-auto/);
  assert.match(toast, /whitespace-pre-wrap break-words/);
  assert.match(toast, /Reply to this chat/);
  assert.match(toast, /onReplyToChat/);
  assert.match(toast, /aria-label="Dismiss message"/);
  assert.match(toast, /<span aria-hidden>\u00d7<\/span>/);
  assert.doesNotMatch(toast, />\s*Dismiss\s*</);
  assert.match(toast, /grid-cols-\[minmax\(0,1fr\)_auto\] items-stretch/);
  assert.match(toast, /min-h-16 self-stretch/);
  assert.match(toast, /fetch\('\/api\/chat-notifications', \{\s*cache: 'no-store'/);
  assert.match(toast, /method: 'POST'/);
  assert.match(toast, /keepalive: true/);
  // Dismissals live on the account, never in a browser's storage.
  assert.doesNotMatch(toast, /localStorage/);
  assert.match(toast, /window\.sessionStorage/);
  assert.match(toast, /chatNotificationHref/);
  assert.match(toast, /CHAT_NOTIFICATION_OPENED_EVENT/);
  assert.match(toast, /CHAT_RESPONSE_SEEN_EVENT/);
  assert.match(toast, /seenTargetsRef/);
  assert.doesNotMatch(toast, /line-clamp/);
  assert.doesNotMatch(toast, /setTimeout/);
  assert.doesNotMatch(toast, /<svg/);
  assert.doesNotMatch(toast, /neu-inset/);
  assert.doesNotMatch(toast, /bg-gray-950/);

  assert.match(garden, /latestAssistantVersions/);
  assert.match(garden, /previousAssistantVersions\.get\(chat\.id\) !== currentVersion/);
  assert.match(garden, /locallyAnnouncedChatResponses/);
  assert.match(garden, /notifyFinishedGardenChat\(chat\.id, chat\.title\)/);
  assert.match(garden, /latestAssistantResponse/);
  assert.match(garden, /dismissChatToasts\(target\)/);
  assert.match(garden, /onOpenChat=\{openChatFromNotification\}/);
  assert.match(garden, /onReplyToChat=\{replyToChatFromNotification\}/);
  assert.match(garden, /pendingNotificationReplyRef/);
  assert.match(garden, /takeChatNotificationReply\(window\.sessionStorage/);
  assert.match(
    garden,
    /notifyChatResponseReady\(displayText,\s*\{[\s\S]*?response: assistantMsg\.content/,
  );
  assert.match(gardenSessions, /readLatestAssistantVersions/);
  assert.match(gardenSessions, /latestAssistantVersion:/);

  assert.match(notificationApi, /FROM conversation_messages m/);
  assert.match(notificationApi, /c\.surface IN \('dashboard_terminal', 'garden_chat'\)/);
  assert.match(notificationApi, /m\.role = 'assistant'/);
  assert.match(notificationApi, /m\.status IN \('complete', 'failed'\)/);
  assert.match(notificationApi, /id: `msg_\$\{row\.message_id\}`/);
  assert.match(notificationApi, /response = row\.content\.trim\(\)/);

  assert.match(session, /monitorBackgroundChatResponse/);
  assert.match(session, /notifyChatResponseReady\((?:instruction|trimmed|input\.text)/);
  assert.match(session, /notifyChatResponseFailed\((?:instruction|trimmed|input\.text)/);
  assert.match(session, /chatId: activeSessionId/);
  assert.match(session, /activeChatId: sessionRef\.current/);
  assert.match(session, /surface !== "quartz_ai"/);
  assert.match(garden, /payload === "\[DONE\]"[\s\S]*agentCompleted = true/);
  assert.match(garden, /event\.type === "error"[\s\S]*agentReportedError = true/);
  assert.match(
    garden,
    /agentCompleted &&[\s\S]*!agentReportedError[\s\S]*notifyChatResponseReady\(displayText,\s*\{[\s\S]*chatId: sessionId,[\s\S]*activeChatId: activeChatIdRef\.current[\s\S]*agentFailed \|\| agentReportedError[\s\S]*notifyChatResponseFailed/,
  );

  assert.match(browser, /if \(outcome === "completed"\) notifyTaskCompleted\(task\)/);
  assert.match(agentBrowser, /if \(outcome === "completed"\) notifyTaskCompleted\(task\)/);
  assert.match(research, /if \(outcome === "completed"\) notifyTaskCompleted\(query\)/);
  assert.match(
    openPlanter,
    /event\.type === "run.completed"[\s\S]*notifyTaskCompleted\(task\)[\s\S]*event\.type === "run.failed"/,
  );
});
