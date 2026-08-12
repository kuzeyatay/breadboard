import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
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
