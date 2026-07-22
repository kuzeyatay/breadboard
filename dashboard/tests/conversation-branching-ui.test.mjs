import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const runtimePanel = source(
  "../src/app/components/openharness/agent-runtime-panel.tsx",
);
const actions = source("../src/app/components/assistant-message-actions.tsx");
const sessionHook = source(
  "../src/app/components/openharness/use-agent-session.ts",
);
const messageRoute = source(
  "../src/app/api/openharness/sessions/[sessionId]/messages/route.ts",
);
const sessionsRoute = source("../src/app/api/openharness/sessions/route.ts");
const turnService = source("../src/lib/conversations/turn-service.ts");
const conversationStore = source("../src/lib/conversations/store.ts");

test("sent user messages expose copy and pencil actions only on hover or focus", () => {
  assert.match(runtimePanel, /group-hover:opacity-100/);
  assert.match(runtimePanel, /group-focus-within:opacity-100/);
  assert.match(runtimePanel, /Copy message/);
  assert.match(runtimePanel, /Edit message and create a branch/);
  assert.match(runtimePanel, /navigator\.clipboard\.writeText\(message\.content\)/);
  assert.match(runtimePanel, /aria-label="Edit message"/);
});

test("editing a sent message creates and persists switchable transcript variants", () => {
  assert.match(runtimePanel, /ConversationBranchGroup/);
  assert.match(runtimePanel, /BRANCH_STORAGE_PREFIX/);
  assert.match(runtimePanel, /variants\.push\(/);
  assert.match(runtimePanel, /onEditMessage\(messageIndex, text, groupId\)/);
  assert.match(runtimePanel, /onSelectBranch\(cloneMessages\(variants\[targetIndex\]\)\)/);
  assert.match(sessionHook, /historyOverride\?: AgentMessage\[\]/);
  assert.match(sessionHook, /options\?\.historyOverride \?\? messages/);
  assert.match(sessionHook, /branchGroupId\?: string/);
});

test("branch navigation sits beside the assistant overflow menu", () => {
  const menuIndex = actions.indexOf('aria-label="More response actions"');
  const branchIndex = actions.indexOf("branch && branch.total > 1");
  assert.ok(menuIndex >= 0);
  assert.ok(branchIndex > menuIndex);
  assert.match(actions, /Previous response branch/);
  assert.match(actions, /\{branch\.current\}\/\{branch\.total\}/);
  assert.match(actions, /Next response branch/);
});

test("branch identity survives the canonical message persistence path", () => {
  assert.match(messageRoute, /branchGroupId: stringValue\(body\.branchGroupId\)/);
  assert.match(turnService, /branchGroupId\?: string/);
  assert.match(turnService, /\{ branchGroupId: input\.branchGroupId \}/);
  assert.match(sessionsRoute, /presented\.metadata\.branchGroupId/);
  assert.match(conversationStore, /mergedMetadata/);
  assert.match(conversationStore, /parseObject\(row\.metadata\)/);
});
