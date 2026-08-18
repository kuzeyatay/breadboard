import assert from "node:assert/strict";
import test from "node:test";
import {
  createConversationBranch,
  previousUserMessageIndex,
  retryTargetUserMessageIndex,
} from "../src/app/components/hermes/conversation-branches.ts";

function ids(...values) {
  let index = 0;
  return () => values[index++];
}

const original = [
  {
    id: "user-1",
    clientMessageId: "user-1",
    role: "user",
    content: "First question",
  },
  {
    id: "assistant-1",
    clientMessageId: "user-1",
    role: "assistant",
    content: "First answer",
  },
  {
    id: "user-2",
    clientMessageId: "user-2",
    role: "user",
    content: "Question to resend",
  },
  {
    id: "assistant-2",
    clientMessageId: "user-2",
    role: "assistant",
    content: "Original answer",
  },
];

test("resend creates a sibling transcript from the prior user-message boundary", () => {
  assert.equal(previousUserMessageIndex(original, 3), 2);
  const branch = createConversationBranch({
    messages: original,
    branchGroups: {},
    userMessageIndex: 2,
    content: original[2].content,
    createId: ids("resent-user", "resent-assistant"),
  });

  assert.equal(branch.groupId, "user-2");
  assert.equal(branch.group.activeIndex, 1);
  assert.equal(branch.group.variants.length, 2);
  assert.deepEqual(
    branch.variant.map((message) => [message.role, message.content]),
    [
      ["user", "First question"],
      ["assistant", "First answer"],
      ["user", "Question to resend"],
      ["assistant", ""],
    ],
  );
  assert.equal(branch.variant[2].branchGroupId, "user-2");
  assert.equal(branch.variant[3].branchGroupId, "user-2");
  assert.equal(branch.variant[2].clientMessageId, "resent-user");
  assert.equal(branch.variant[3].clientMessageId, "resent-user");
  assert.equal(original[3].content, "Original answer", "the original branch remains unchanged");
});

test("another resend preserves existing variants and appends one new sibling", () => {
  const first = createConversationBranch({
    messages: original,
    branchGroups: {},
    userMessageIndex: 2,
    content: original[2].content,
    createId: ids("branch-user-1", "branch-assistant-1"),
  });
  const completedFirstBranch = first.variant.map((message, index) =>
    index === first.variant.length - 1
      ? { ...message, content: "Regenerated answer" }
      : message,
  );
  const second = createConversationBranch({
    messages: completedFirstBranch,
    branchGroups: { [first.groupId]: first.group },
    userMessageIndex: 2,
    content: completedFirstBranch[2].content,
    createId: ids("branch-user-2", "branch-assistant-2"),
  });

  assert.equal(second.group.activeIndex, 2);
  assert.equal(second.group.variants.length, 3);
  assert.equal(second.group.variants[0][3].content, "Original answer");
  assert.equal(second.group.variants[1][3].content, "Regenerated answer");
  assert.equal(second.group.variants[2][3].content, "");
});

// A delegated worker's result comes back as a user-role turn nobody typed, and
// it sits directly above the answer it produced. Redo therefore has to walk
// past it: branching there would resend internal machinery as the person's own
// words, at a boundary they cannot see in the transcript.
const afterDelegation = [
  {
    id: "user-1",
    clientMessageId: "user-1",
    role: "user",
    content: "Research every TU/e student team",
  },
  {
    id: "assistant-1",
    clientMessageId: "user-1",
    role: "assistant",
    content: "First attempt",
    delegatedAgentRun: true,
  },
  {
    id: "user-2",
    clientMessageId: "user-2",
    role: "user",
    content: "Agent Browser did not finish — it failed. This is its result",
    internalAgentContinuation: true,
  },
  {
    id: "assistant-2",
    clientMessageId: "user-2",
    role: "assistant",
    content: "Agent Browser never ran the page.",
    internalAgentContinuation: true,
  },
];

test("retrying an answer that came back from a delegation re-asks the question", () => {
  // The plain walk-back still reports the nearest user row, because branch
  // grouping is about adjacency and must not change.
  assert.equal(previousUserMessageIndex(afterDelegation, 3), 2);
  // Redo speaks about the question instead.
  assert.equal(retryTargetUserMessageIndex(afterDelegation, 3), 0);

  const branch = createConversationBranch({
    messages: afterDelegation,
    branchGroups: {},
    userMessageIndex: retryTargetUserMessageIndex(afterDelegation, 3),
    content: afterDelegation[0].content,
    createId: ids("resent-user", "resent-assistant"),
  });
  const variant = branch.group.variants[branch.group.activeIndex];
  assert.equal(variant[0].content, "Research every TU/e student team");
  assert.doesNotMatch(
    variant.map((message) => message.content).join("\n"),
    /Agent Browser did not finish/,
  );
});

test("a transcript with no delegation is unaffected by the retry walk-back", () => {
  assert.equal(retryTargetUserMessageIndex(original, 3), 2);
  assert.equal(retryTargetUserMessageIndex(original, 1), 0);
  assert.equal(retryTargetUserMessageIndex(original, 0), -1);
});
