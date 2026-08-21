import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createConversationBranch,
  previousUserMessageIndex,
} from "../src/app/components/hermes/conversation-branches.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);

test("retrying a Garden answer opens a branch instead of resending the question", () => {
  assert.match(workspace, /createConversationBranch<Message>\(/);
  assert.match(workspace, /BRANCH_STORAGE_PREFIX/);
  assert.match(workspace, /setBranchGroups\(loadBranchGroups\(activeChatId\)\)/);
  // The old behaviour: walk back to the user message and submit it again with
  // nothing preserving the answer being replaced.
  assert.doesNotMatch(
    workspace,
    /while \(userIndex >= 0 && messages\[userIndex\]\?\.role !== "user"\)/,
  );
});

test("the branch switcher reaches the Garden transcript's assistant actions", () => {
  assert.match(workspace, /branchGroups: Record<string, ConversationBranchGroup<Message>>/);
  assert.match(workspace, /onSwitchBranch: \(groupId: string, direction: -1 \| 1\) => void/);
  assert.match(workspace, /function branchForAssistant\(/);
  // Tolerant of formatting: the wiring is what matters, not whether the
  // arrow body happens to fit on one line.
  assert.match(
    workspace,
    /onPrevious: \(\) =>\s*onSwitchBranch\(branch\.id, -1\)/,
  );
  assert.match(workspace, /onNext: \(\) =>\s*onSwitchBranch\(branch\.id, 1\)/);
  assert.match(workspace, /onSwitchBranch=\{switchBranch\}/);
  // Switching has to write the chosen variant back, since a Garden chat row
  // stores exactly the transcript on screen.
  assert.match(
    workspace,
    /void persistChatSession\(activeChat\.id, nextMessages\)/,
  );
});

test("a retried external-agent turn replaces its predecessor rather than stacking on it", () => {
  // Every launcher appends through the retry-aware transcript, so the run being
  // retried leaves the transcript the moment the new one is previewed.
  assert.doesNotMatch(workspace, /\.\.\.prepared\.session\.messages,/);
  assert.match(workspace, /function transcriptForRetriedTurn\(session: ChatSession\): Message\[\]/);
  assert.match(
    workspace,
    /const nextMessages: Message\[\] = \[\s*\.\.\.transcriptForRetriedTurn\(session\),/,
  );
  assert.match(
    workspace,
    /if \(historyOverride === undefined\) retryBranchRef\.current = null;/,
  );
});

test("a Garden branch variant carries only fields this transcript persists", () => {
  const messages = [
    { role: "user", content: "/agents:opencode fix the flaky test" },
    {
      role: "assistant",
      content: "",
      openCodeRun: {
        runId: "run-1",
        task: "fix the flaky test",
        gardenSlug: "notes",
        repository: "breadboard",
      },
      externalAgentOutcome: "failed",
    },
  ];
  assert.equal(previousUserMessageIndex(messages, 1), 0);

  let sequence = 0;
  const branch = createConversationBranch({
    messages,
    branchGroups: {},
    userMessageIndex: 0,
    content: messages[0].content,
    createId: () => `new-${++sequence}`,
    createAssistantPlaceholder: (seed) => ({
      ...seed,
      role: "assistant",
      content: "",
      sources: [],
    }),
  });

  assert.equal(branch.group.variants.length, 2);
  assert.equal(branch.group.activeIndex, 1);
  // The failed run survives as the sibling variant, which is the whole point.
  assert.equal(branch.group.variants[0][1].openCodeRun.runId, "run-1");
  assert.equal(branch.variant[1].content, "");
  assert.ok(!("tools" in branch.variant[1]));
  assert.equal(branch.variant[0].branchGroupId, branch.groupId);
});
