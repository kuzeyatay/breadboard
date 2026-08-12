import assert from "node:assert/strict";
import test from "node:test";
import {
  createConversationBranch,
  previousUserMessageIndex,
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
