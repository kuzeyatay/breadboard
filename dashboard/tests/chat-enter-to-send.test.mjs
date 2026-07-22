import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const runtime = source(
  "../src/app/components/openharness/agent-runtime-panel.tsx",
);
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const garden = source("../src/app/garden/garden-assistant.tsx");
const quartz = source(
  "../../quartz/quartz/components/scripts/breadboardAI.inline.ts",
);

test("the shared composer sends on Enter without breaking commands or multiline input", () => {
  const start = composer.indexOf('onKeyDown={(event) => {');
  const block = composer.slice(start, start + 900);
  assert.ok(start >= 0);
  assert.match(block, /commandHubRef\.current\?\.handleKeyDown\(event\)/);
  assert.match(block, /onKeyDown\?\.\(event\)/);
  assert.match(block, /event\.defaultPrevented/);
  assert.match(block, /event\.key !== 'Enter'/);
  assert.match(block, /event\.shiftKey/);
  assert.match(block, /event\.nativeEvent\.isComposing/);
  assert.match(block, /if \(activeRun\)/);
  assert.match(block, /queueSteer\(\)/);
  assert.match(block, /!canSubmit \|\| isSending \|\| disabled/);
  assert.match(block, /onSubmit\(\)/);
});

test("terminal and garden chats use the shared Enter behavior", () => {
  assert.match(runtime, /<AssistantComposer/);
  assert.match(workspace, /<AssistantComposer/);
  assert.match(garden, /<AssistantComposer/);
  assert.doesNotMatch(workspace, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(garden, /onKeyDown=\{handleInputKeyDown\}/);
});

test("Quartz sends on Enter only when idle and composition is complete", () => {
  const start = quartz.indexOf('input.addEventListener("keydown"');
  const block = quartz.slice(start, start + 650);
  assert.ok(start >= 0);
  assert.match(block, /event\.key === "Enter"/);
  assert.match(block, /!event\.shiftKey/);
  assert.match(block, /!event\.isComposing/);
  assert.match(block, /if \(sendBtn\.disabled\) return/);
  assert.match(block, /if \(!value\.trim\(\)\) return/);
  assert.match(block, /void send\(value\)/);
});
