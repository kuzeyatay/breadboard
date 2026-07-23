import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const chat = fs.readFileSync(
  new URL("../src/app/components/openharness/garden-agent-chat.tsx", import.meta.url),
  "utf8",
);

test("garden chat drives the OpenHarness runtime like the terminal", () => {
  assert.match(chat, /useAgentSession\("garden_chat"/);
  assert.match(chat, /<AgentRuntimePanel/);
  assert.match(chat, /pendingPermission=\{session\.pendingPermission\}/);
  assert.match(chat, /onPermissionDecision=/);
  assert.match(chat, /onAbort=/);
  assert.match(chat, /onRetryMessage=\{retryMessage\}/);
});

test("garden chat offers the terminal's model and reasoning-effort picker", () => {
  assert.match(chat, /fetch\("\/api\/models"\)/);
  assert.match(chat, /mergeAssistantModels/);
  assert.match(chat, /model=\{model\}/);
  assert.match(chat, /models=\{models\}/);
  assert.match(chat, /onModelChange=\{setModel\}/);
  assert.match(chat, /reasoningEffort=\{reasoningEffort\}/);
  assert.match(chat, /onReasoningEffortChange=\{setReasoningEffort\}/);
  // Every dispatch path carries the picker values.
  const sendsWithOptions = chat.match(/session\.send\([^)]*\{ model, reasoningEffort \}\)/g) ?? [];
  assert.ok(
    sendsWithOptions.length >= 3,
    `submit, suggested prompts, and retry must all send model options (found ${sendsWithOptions.length})`,
  );
});

test("garden chat has terminal-style history, new chat, and skill review", () => {
  assert.match(chat, /api\/openharness\/sessions\?surface=garden_chat/);
  assert.match(chat, /item\.gardenId === gardenSlug/);
  assert.match(chat, /id: string/);
  assert.match(chat, /New chat/);
  assert.match(chat, /Recents/);
  assert.match(chat, /openHistorySession/);
  assert.match(chat, /startNewChat/);
  assert.match(chat, /<SkillReviewPanel/);
  assert.match(chat, /SUGGESTED_PROMPTS/);
});

test("garden chat keeps the proposal reviewer", () => {
  assert.match(chat, /proposals\?status=pending/);
  assert.match(chat, /decide\(proposal\.id, "apply"\)/);
  assert.match(chat, /decide\(proposal\.id, "reject"\)/);
});
