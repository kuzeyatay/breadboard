import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createConversationBranch } from "../src/app/components/hermes/conversation-branches.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const runtimePanel = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const branchHelpers = source(
  "../src/app/components/hermes/conversation-branches.ts",
);
const actions = source("../src/app/components/assistant-message-actions.tsx");
const sessionHook = source(
  "../src/app/components/hermes/use-agent-session.ts",
);
const dashboardTerminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const gardenChat = source(
  "../src/app/components/hermes/garden-agent-chat.tsx",
);
const messageRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/messages/route.ts",
);
const branchRuntimeRoute = source(
  "../src/app/api/hermes/sessions/[sessionId]/branch-runtime/route.ts",
);
const sessionPresentation = source("../src/lib/hermes/session-presentation.ts");
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
  assert.match(branchHelpers, /ConversationBranchGroup/);
  assert.match(runtimePanel, /BRANCH_STORAGE_PREFIX/);
  assert.match(branchHelpers, /variants\.push\(variant\)/);
  assert.match(runtimePanel, /createConversationBranch\(/);
  assert.match(runtimePanel, /onEditMessage\(messageIndex, text, branch\.groupId\)/);
  // Switching splices only the branched turn back in. Swapping the whole
  // snapshot was destructive: everything said after the branch point belongs
  // to no variant, and vanished on every press.
  assert.match(
    runtimePanel,
    /onSelectBranch\(\s*applyBranchVariant\(\{\s*messages,\s*variant: variants\[targetIndex\],\s*groupId: group\.id,/,
  );
  assert.match(sessionHook, /historyOverride\?: AgentMessage\[\]/);
  assert.match(
    sessionHook,
    /options\?\.historyOverride \?\? pendingHistoryOverrideRef\.current/,
  );
  assert.match(sessionHook, /setMessages: setMessagesExternal/);
  assert.match(sessionHook, /branchGroupId\?: string/);
  assert.match(runtimePanel, /Save &amp; send/);
  assert.match(runtimePanel, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.doesNotMatch(runtimePanel, /messageEditText\.trim\(\) === message\.content/);
  assert.doesNotMatch(runtimePanel, /text === message\.content/);
});

test("saving an unchanged message still creates a new response branch", () => {
  const messages = [
    { id: "user-1", role: "user", content: "Repeat this prompt" },
    { id: "assistant-1", role: "assistant", content: "First answer" },
  ];
  let sequence = 0;
  const branch = createConversationBranch({
    messages,
    branchGroups: {},
    userMessageIndex: 0,
    content: messages[0].content,
    createId: () => `new-${++sequence}`,
  });

  assert.equal(branch.group.variants.length, 2);
  assert.equal(branch.group.activeIndex, 1);
  assert.equal(branch.variant[0].content, messages[0].content);
  assert.equal(branch.variant[1].content, "");
});

test("resending an answer creates a sibling branch in the existing conversation", () => {
  assert.match(runtimePanel, /retryAssistantAsBranch/);
  assert.match(runtimePanel, /previousUserMessageIndex\(/);
  assert.match(runtimePanel, /onRetryMessage\(userMessageIndex, branch\.groupId\)/);
  for (const surface of [dashboardTerminal, gardenChat]) {
    assert.match(
      surface,
      /historyOverride: session\.messages\.slice\(0, userMessageIndex\)/,
    );
    assert.match(surface, /branchGroupId/);
  }
  assert.doesNotMatch(
    dashboardTerminal.match(/const retryMessage[\s\S]*?\n  \);/)?.[0] ?? "",
    /session\.reset\(\)/,
  );
  assert.doesNotMatch(
    gardenChat.match(/const retryMessage[\s\S]*?\n  \);/)?.[0] ?? "",
    /session\.reset\(\)/,
  );
  assert.match(sessionHook, /branchHistoryReferences\(selectedHistory\)/);
  assert.match(sessionHook, /\/branch-runtime/);
  assert.match(branchRuntimeRoute, /forceRecreate: true/);
  assert.match(branchRuntimeRoute, /historyOverride: runtimeMessagesForBranch\(history\)/);
  assert.match(messageRoute, /branchHistory,\s+branchContextId:/);
  assert.match(turnService, /recentMessages: input\.branchHistory/);
  assert.match(turnService, /includeConversationState: false/);
});

test("branch navigation sits beside the assistant overflow menu", () => {
  const menuIndex = actions.indexOf('aria-label="More response actions"');
  const branchIndex = actions.indexOf("<AssistantResponseBranchNavigation");
  assert.ok(menuIndex >= 0);
  assert.ok(branchIndex > menuIndex);
  // The "only when there is something to switch between" guard lives in the
  // component now, so a caller cannot forget it.
  assert.match(actions, /if \(branch\.total <= 1\) return null;/);
  assert.match(actions, /Previous response branch/);
  assert.match(actions, /\{branch\.current\}\/\{branch\.total\}/);
  assert.match(actions, /Next response branch/);
});

test("branch identity survives the canonical message persistence path", () => {
  assert.match(messageRoute, /branchGroupId: stringValue\(body\.branchGroupId\)/);
  assert.match(turnService, /branchGroupId\?: string/);
  assert.match(turnService, /\{ branchGroupId: input\.branchGroupId \}/);
  assert.match(sessionPresentation, /metadata\.branchGroupId/);
  assert.match(conversationStore, /mergedMetadata/);
  assert.match(conversationStore, /parseObject\(row\.metadata\)/);
});

test("a retried external turn labels its replacement pair with the branch group", () => {
  // The preview removes the turn being replaced from the transcript before the
  // run has started. If the two rows that take its place arrive unlabelled, the
  // switcher cannot match them to the group holding the earlier answer: no
  // arrows appear, and the answer that was just replaced is unreachable rather
  // than one press away. Deep Research and every other `/agents:*` retry takes
  // this path, so an unlabelled pair loses the previous answer outright.
  const preview = sessionHook.slice(
    sessionHook.indexOf("const preview: AgentMessage[] = ["),
    sessionHook.indexOf("return preview;"),
  );
  assert.ok(preview, "the external preview block still exists");
  assert.match(preview, /withoutReplacedBranch\(current, input\.branchGroupId\)/);
  // Both rows, not just the user one: the switcher reads the group off the
  // assistant message first.
  assert.equal(
    preview.match(/\.\.\.\(branchGroupId \? \{ branchGroupId \} : \{\}\),/g)?.length,
    2,
  );
  assert.match(
    sessionHook,
    /const branchGroupId = input\.branchGroupId\?\.trim\(\) \|\| undefined;/,
  );
});

test("the ordinary send path labels its pair the same way", () => {
  // The two paths have to agree. This one was already correct; pinning it means
  // a future change cannot quietly fix one and regress the other.
  assert.equal(
    sessionHook.match(
      /\.\.\.\(options\?\.branchGroupId\s*\r?\n?\s*\? \{ branchGroupId: options\.branchGroupId \}\s*\r?\n?\s*: \{\}\),/g,
    )?.length,
    2,
  );
});
