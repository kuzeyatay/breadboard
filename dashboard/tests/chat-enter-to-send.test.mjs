import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const runtime = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
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
  const block = composer.slice(start, start + 1_200);
  assert.ok(start >= 0);
  assert.match(block, /commandHubRef\.current\?\.handleKeyDown\(event\)/);
  assert.match(block, /onKeyDown\?\.\(event\)/);
  assert.match(block, /event\.defaultPrevented/);
  assert.match(block, /event\.key !== 'Enter'/);
  assert.match(block, /event\.shiftKey/);
  assert.match(block, /event\.nativeEvent\.isComposing/);
  assert.match(block, /if \(queueHeld\)/);
  assert.match(block, /queueSteer\(\)/);
  assert.match(block, /!canSubmit \|\| isSending \|\| disabled/);
  assert.match(block, /onSubmit\(\)/);
});

test("Enter queues behind an external agent run, not only a chat turn", () => {
  // A blueprint/research/coding run lives in its own inline card and leaves
  // runState "idle", so gating on activeRun alone sent the next message
  // straight past the working agent.
  assert.match(composer, /const runInFlight = activeRun \|\| externalRunActive/);
  assert.match(composer, /const queueHeld = loading \|\| runInFlight/);
  assert.match(composer, /externalRunActive = false,/);
  assert.match(runtime, /externalRunLaunching \|\|[\s\S]{0,100}?messages\.some\(externalAgentRunInFlight\)/);
  assert.match(runtime, /const runInFlight = activeRun \|\| externalRunActive/);
  assert.match(runtime, /const queueHeld = conversationLoading \|\| runInFlight/);
  assert.match(runtime, /runInFlight: queueHeld/);
  assert.match(runtime, /externalRunActive=\{externalRunActive\}/);
});

test("terminal and garden chats use the shared Enter behavior", () => {
  assert.match(runtime, /<AssistantComposer/);
  assert.match(workspace, /<AssistantComposer/);
  assert.match(garden, /<AssistantComposer/);
  assert.doesNotMatch(workspace, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(garden, /onKeyDown=\{handleInputKeyDown\}/);
});

test("the shared send button does not forward its click event as message text", () => {
  // The handler is an arrow, so the click event is never forwarded as an
  // argument. An agent that takes a form runs its typed request instead of the
  // draft; everything else still queues or sends the message.
  const clicks = composer.replace(/\s+/g, " ");
  assert.match(
    clicks,
    /onClick=\{\(\) => formAgent \? submitFormAgent\(\) : queueHeld \? queueSteer\(\) : onSubmit\(\) \}/,
  );
  // …and the shared submit dispatches to the agent that is selected.
  assert.match(
    clicks,
    /if \(tradingAgentsAgent\) submitTradingAgents\(\); else if \(shortsAgent\) submitShorts\(\);/,
  );
  assert.doesNotMatch(composer, /onClick=\{onSubmit\}/);
  assert.doesNotMatch(composer, /onClick=\{submitShorts\}/);
  assert.doesNotMatch(composer, /onClick=\{submitTradingAgents\}/);
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
