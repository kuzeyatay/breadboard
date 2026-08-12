import type { AgentMessage } from "./use-agent-session";

export interface ConversationBranchGroup {
  id: string;
  activeIndex: number;
  variants: AgentMessage[][];
}

export function messageBranchId(message: AgentMessage, index: number): string {
  return (
    message.branchGroupId ??
    message.clientMessageId ??
    message.id ??
    `message-${index}-${message.content.slice(0, 48)}`
  );
}

export function cloneMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    ...message,
    sources: message.sources ? [...message.sources] : undefined,
    tools: message.tools ? message.tools.map((tool) => ({ ...tool })) : undefined,
  }));
}

export function previousUserMessageIndex(
  messages: AgentMessage[],
  assistantMessageIndex: number,
): number {
  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

/**
 * Create a response variant at one user-message boundary. The old transcript
 * remains one variant; the new variant contains only the selected branch's
 * history before that user message, followed by the resent/edited prompt.
 */
export function createConversationBranch(input: {
  messages: AgentMessage[];
  branchGroups: Record<string, ConversationBranchGroup>;
  userMessageIndex: number;
  content: string;
  createId: () => string;
}): {
  groupId: string;
  group: ConversationBranchGroup;
  variant: AgentMessage[];
} {
  const sourceUser = input.messages[input.userMessageIndex];
  if (!sourceUser || sourceUser.role !== "user") {
    throw new Error("branch_source_not_user_message");
  }

  const groupId = messageBranchId(sourceUser, input.userMessageIndex);
  const currentSnapshot = cloneMessages(input.messages);
  const existing = input.branchGroups[groupId];
  const variants = existing
    ? existing.variants.map((variant) => cloneMessages(variant))
    : [currentSnapshot];
  if (existing) variants[existing.activeIndex] = currentSnapshot;

  const userId = input.createId();
  const assistantId = input.createId();
  const variant: AgentMessage[] = [
    ...cloneMessages(input.messages.slice(0, input.userMessageIndex)),
    {
      ...sourceUser,
      id: userId,
      clientMessageId: userId,
      content: input.content,
      branchGroupId: groupId,
    },
    {
      id: assistantId,
      clientMessageId: userId,
      role: "assistant",
      content: "",
      sources: [],
      tools: [],
      branchGroupId: groupId,
    },
  ];
  const activeIndex = variants.length;
  variants.push(variant);
  return {
    groupId,
    group: { id: groupId, activeIndex, variants },
    variant,
  };
}
