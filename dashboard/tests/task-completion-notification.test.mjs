import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
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
  try {
    notifyTaskCompleted("visible task", {
      chatId: "chat-a",
      activeChatId: "chat-a",
    });
    assert.equal(count, 0);

    notifyTaskCompleted("background task", {
      chatId: "chat-b",
      activeChatId: "chat-a",
    });
    assert.equal(count, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});

test("successful chat and specialist tasks notify, while failures stay silent", () => {
  const toast = source("../src/app/components/toast.tsx");
  const session = source("../src/app/components/hermes/use-agent-session.ts");
  const garden = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const browser = source("../src/app/components/hermes/inline-browser-run.tsx");
  const agentBrowser = source("../src/app/components/hermes/inline-agent-browser-run.tsx");
  const research = source("../src/app/components/hermes/inline-deep-research-run.tsx");
  const openPlanter = source("../src/app/components/hermes/inline-openplanter-run.tsx");

  assert.match(toast, /TASK_COMPLETION_NOTIFICATION_EVENT/);
  assert.match(toast, /title: "Task completed"|t\.title/);
  assert.match(toast, /bg-\[var\(--paper-surface\)\]/);
  assert.match(toast, /shadow-\[8px_8px_18px/);
  assert.doesNotMatch(toast, /bg-gray-950/);

  assert.match(
    session,
    /outcome === "failed"[\s\S]*else \{[\s\S]*notifyTaskCompleted\((?:instruction|trimmed)\)/,
  );
  assert.match(session, /surface !== "quartz_ai"/);
  assert.match(garden, /payload === "\[DONE\]"[\s\S]*agentCompleted = true/);
  assert.match(garden, /event\.type === "error"[\s\S]*agentReportedError = true/);
  assert.match(
    garden,
    /agentCompleted &&[\s\S]*!agentReportedError[\s\S]*notifyTaskCompleted\(displayText,\s*\{[\s\S]*chatId: sessionId,[\s\S]*activeChatId: activeChatIdRef\.current/,
  );

  assert.match(browser, /if \(outcome === "completed"\) notifyTaskCompleted\(task\)/);
  assert.match(agentBrowser, /if \(outcome === "completed"\) notifyTaskCompleted\(task\)/);
  assert.match(research, /if \(outcome === "completed"\) notifyTaskCompleted\(query\)/);
  assert.match(
    openPlanter,
    /event\.type === "run.completed"[\s\S]*notifyTaskCompleted\(task\)[\s\S]*event\.type === "run.failed"/,
  );
});
