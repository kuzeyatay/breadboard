import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
  chatConversationWasOpened,
} from "../src/app/components/use-chat-auto-scroll.ts";

test("response keys remain stable while an answer streams and change for duplicate prompts", () => {
  const firstTurn = [
    { role: "user", content: "repeat this" },
    { role: "assistant", content: "Starting" },
  ];
  const expandedAnswer = [
    firstTurn[0],
    { role: "assistant", content: "Starting and still streaming" },
  ];
  const duplicatePrompt = [
    ...expandedAnswer,
    { role: "user", content: "repeat this" },
    { role: "assistant", content: "" },
  ];

  assert.equal(
    chatAutoScrollResponseKey(firstTurn),
    chatAutoScrollResponseKey(expandedAnswer),
  );
  assert.notEqual(
    chatAutoScrollResponseKey(firstTurn),
    chatAutoScrollResponseKey(duplicatePrompt),
  );
  assert.notEqual(
    chatAutoScrollContentKey(firstTurn),
    chatAutoScrollContentKey(expandedAnswer),
  );
});

test("a transcript treats being shown a conversation as opening it", () => {
  const opened = (previous, next, responding = false) =>
    chatConversationWasOpened({ previous, next, responding });

  // The first conversation a transcript shows, however it got there.
  assert.equal(opened(undefined, "chat_9"), true);
  assert.equal(opened(undefined, null), true);
  // One conversation replacing another, in either direction.
  assert.equal(opened("chat_9", "chat_10"), true);
  assert.equal(opened(7, 8), true);
  assert.equal(opened("chat_9", null), true);
  // Sitting on an empty new chat and opening a saved one is a real open.
  assert.equal(opened(null, "chat_9"), true);
  // The same transition mid-turn is a new chat being given its id, not a chat
  // being opened: the rows are already on screen and may be being read.
  assert.equal(opened(null, "chat_9", true), false);
  // Re-rendering is not re-opening.
  assert.equal(opened("chat_9", "chat_9"), false);
  assert.equal(opened(null, null), false);
});

test("opening a conversation lands it on the newest message", async () => {
  const hook = await readFile(
    new URL("../src/app/components/use-chat-auto-scroll.ts", import.meta.url),
    "utf8",
  );

  // The landing beats the paint, so the top of the transcript is never drawn on
  // the way past — and the virtualized list clears the same scroller on that
  // commit, from a child effect that React runs first.
  assert.match(hook, /useIsomorphicLayoutEffect\(\(\) => \{\s*\n\s*if \(!enabled\)/);
  assert.match(hook, /chatConversationWasOpened\(\{/);
  // It re-aims itself while the transcript is still laying itself out, rather
  // than jumping once at an estimated height.
  assert.match(hook, /LANDING_STABLE_FRAMES/);
  assert.match(hook, /now - startedAt >= LANDING_SETTLE_MS/);
  // A chat whose messages arrive after the chat itself is still landed on.
  assert.match(hook, /awaitingContentRef\.current = true/);
  assert.match(hook, /container\.scrollHeight > container\.clientHeight/);
  // And the reader always outranks it.
  assert.match(hook, /const handleTouchMove = \(\) => cancelLanding\(\)/);
  assert.match(hook, /cancelLanding\(\);\s*\n\s*stopFollowing\(\);/);
});

test("every transcript names the conversation it should open at the end of", async () => {
  const surfaces = {
    "src/app/components/hermes/agent-runtime-panel.tsx": "sessionId \\?\\? null",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx": "activeChatId",
    "src/app/garden/garden-assistant.tsx": "activeChatId",
    "src/app/components/knowledge-terminal.tsx": "activeId",
  };

  for (const [path, key] of Object.entries(surfaces)) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`conversationKey: ${key},`), path);
  }
});

test("async transcripts wait for their real rows before landing", async () => {
  const surfaces = {
    "src/app/components/hermes/agent-runtime-panel.tsx": "conversationLoading",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx": "chatContentLoading",
  };

  for (const [path, loading] of Object.entries(surfaces)) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`enabled: !${loading},`), path);
  }
});

test("all conversation transcripts use response-scoped auto-scroll", async () => {
  const paths = [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
    "src/app/garden/garden-assistant.tsx",
    "src/app/components/knowledge-terminal.tsx",
  ];

  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /useChatAutoScroll/);
    assert.match(source, /ref=\{transcriptScrollRef\}/);
    assert.doesNotMatch(source, /messagesEndRef|endRef\.current\?\.scrollIntoView/);
  }

  const hook = await readFile(
    new URL("../src/app/components/use-chat-auto-scroll.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /event\.deltaY < 0/);
  assert.match(hook, /nextScrollTop < lastScrollTopRef\.current - 1/);
  assert.match(hook, /activeResponseKeyRef\.current !== responseKey/);
  assert.match(hook, /followingRef\.current = true/);
});
