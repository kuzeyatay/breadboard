import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("every chat surface offers retry on earlier answers and edit on assistant answers", () => {
  const runtime = read("src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = read("src/app/garden/garden-assistant.tsx");
  const workspace = read("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const knowledge = read("src/app/components/knowledge-terminal.tsx");

  // Earlier answers are rewritten in place (a new version of that one message),
  // never by re-sending with a history truncated at that turn.
  assert.match(runtime, /regenerateResponseText\(messages\.slice\(0, userMessageIndex \+ 1\), model\)[\s\S]*?onEditAssistantMessage\(message, content\)/);
  assert.match(garden, /regenerateResponseText\(messages\.slice\(0, userIndex \+ 1\), model\)[\s\S]*?replaceAssistantContent\(message, content\)/);
  assert.match(garden, /\(\) => void userMessageActionsRef\.current\.regenerateInPlace\(storedIndex\)/);
  assert.match(workspace, /messageIndex !== lastAssistant && !messages\[messageIndex\]\?\.failed[\s\S]*?regenerateInPlace\(messageIndex\)/);
  assert.match(workspace, /onRetry=\{\(\) => onRetryAssistant\(i\)\}/);
  // The knowledge terminal re-runs its own pipeline but keeps the tail.
  assert.match(knowledge, /tail: messages\.slice\(messageIndex \+ 1\)/);
  assert.match(knowledge, /setMessages\(\[\.\.\.nextMessages, assistantMessage, \.\.\.tail\]\)/);
  assert.match(knowledge, /keep \? \[\.\.\.nextMessages, keep\.original, \.\.\.tail\]/);

  for (const source of [garden, workspace, knowledge]) {
    assert.match(source, /<AssistantResponseEditor/);
  }
});

test("the regenerate route answers only a trailing user message and stores nothing", () => {
  const route = read("src/app/api/chat-regenerate/route.ts");
  assert.match(route, /messages\.at\(-1\)\?\.role !== "user"/);
  assert.doesNotMatch(route, /db\.|insert|persist/i);
});
