import type { AgentMessage } from "./use-agent-session";

/**
 * The little a transcript has to expose to be branchable. Terminal and Garden
 * chat carry different message shapes; only these fields decide where a branch
 * boundary is and which group a variant belongs to.
 */
export interface BranchableMessage {
  id?: string;
  clientMessageId?: string;
  branchGroupId?: string;
  role: string;
  content: string;
  /** A delegated worker's result, handed back as a turn nobody typed. */
  internalAgentContinuation?: boolean;
}

export interface ConversationBranchGroup<
  T extends BranchableMessage = AgentMessage,
> {
  id: string;
  activeIndex: number;
  variants: T[][];
}

export function messageBranchId(
  message: BranchableMessage,
  index: number,
): string {
  return (
    message.branchGroupId ??
    message.clientMessageId ??
    message.id ??
    `message-${index}-${message.content.slice(0, 48)}`
  );
}

export function cloneMessages<T extends BranchableMessage>(messages: T[]): T[] {
  return messages.map((message) => {
    const copy = { ...message } as T & {
      sources?: unknown[];
      tools?: unknown[];
      uiResources?: unknown[];
    };
    if (Array.isArray(copy.sources)) copy.sources = [...copy.sources];
    if (Array.isArray(copy.tools)) {
      copy.tools = copy.tools.map((tool) =>
        tool && typeof tool === "object" ? { ...tool } : tool,
      );
    }
    if (Array.isArray(copy.uiResources)) {
      // Resources are JSON-only by contract. Branch snapshots must not share
      // nested product/source arrays, or selecting a comparison in one variant
      // could mutate another variant before it is persisted.
      copy.uiResources = copy.uiResources.map((resource) =>
        resource && typeof resource === "object"
          ? JSON.parse(JSON.stringify(resource))
          : resource,
      );
    }
    return copy;
  });
}

export function previousUserMessageIndex(
  messages: BranchableMessage[],
  assistantMessageIndex: number,
): number {
  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

/**
 * The question a retry should re-ask.
 *
 * After a delegation the transcript ends with a turn nobody typed: the worker's
 * result, handed back as a user message so the agent can answer from it. That
 * message is the nearest one above the answer, so a plain walk-back made Redo
 * re-send internal machinery — "Agent Browser did not finish, here is its
 * result" — as though the person had written it, branching the conversation at
 * a boundary they cannot see. Walk past those turns to the real question, which
 * is what re-running the answer actually means: ask it again.
 */
export function retryTargetUserMessageIndex(
  messages: BranchableMessage[],
  assistantMessageIndex: number,
): number {
  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (message.internalAgentContinuation === true) continue;
    return index;
  }
  return -1;
}

/**
 * Where one branched turn starts and ends inside a transcript.
 *
 * A turn is the anchored user message plus everything it produced, which runs
 * until the next thing the person actually typed. Delegation results come back
 * as user-role messages nobody wrote, so they stay inside the turn they belong
 * to rather than closing it early.
 */
export function branchTurnBounds(
  messages: BranchableMessage[],
  groupId: string,
): { start: number; end: number } | null {
  let start = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (messageBranchId(message, index) !== groupId) continue;
    start = index;
    break;
  }
  if (start < 0) return null;
  let end = start + 1;
  while (end < messages.length) {
    const message = messages[end];
    if (message?.role === "user" && message.internalAgentContinuation !== true) {
      break;
    }
    end += 1;
  }
  return { start, end };
}

/**
 * Switch which variant of one turn is on screen without disturbing the rest of
 * the conversation.
 *
 * A variant is stored as a whole-transcript snapshot, but only the branched
 * turn inside it is the thing being chosen. Swapping the entire transcript made
 * the arrows destructive: everything said after the branch point — turns that
 * belong to no variant, because they happened after the branch was made —
 * vanished on every press and came back on the way back. So splice: keep the
 * live transcript on both sides and replace only the anchored turn. When the
 * anchor cannot be located in either list, fall back to the old whole-snapshot
 * swap rather than guessing at a boundary.
 */
export function applyBranchVariant<T extends BranchableMessage>(input: {
  messages: T[];
  variant: T[];
  groupId: string;
}): T[] {
  const current = branchTurnBounds(input.messages, input.groupId);
  const incoming = branchTurnBounds(input.variant, input.groupId);
  if (!current || !incoming) return cloneMessages(input.variant);
  return cloneMessages([
    ...input.messages.slice(0, current.start),
    ...input.variant.slice(incoming.start, incoming.end),
    ...input.messages.slice(current.end),
  ]);
}

/**
 * Create a response variant at one user-message boundary. The old transcript
 * remains one variant; the new variant contains only the selected branch's
 * history before that user message, followed by the resent/edited prompt.
 */
export function createConversationBranch<T extends BranchableMessage>(input: {
  messages: T[];
  branchGroups: Record<string, ConversationBranchGroup<T>>;
  userMessageIndex: number;
  content: string;
  createId: () => string;
  /**
   * The empty assistant row the new variant waits on. Surfaces whose message
   * shape is not the Terminal's pass their own so a branch snapshot never
   * carries fields that transcript does not know how to persist.
   */
  createAssistantPlaceholder?: (seed: {
    id: string;
    clientMessageId: string;
    branchGroupId: string;
  }) => T;
}): {
  groupId: string;
  group: ConversationBranchGroup<T>;
  variant: T[];
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
  const createAssistantPlaceholder =
    input.createAssistantPlaceholder ??
    ((seed: { id: string; clientMessageId: string; branchGroupId: string }) =>
      ({
        ...seed,
        role: "assistant",
        content: "",
        sources: [],
        tools: [],
      }) as unknown as T);
  const variant: T[] = [
    ...cloneMessages(input.messages.slice(0, input.userMessageIndex)),
    {
      ...sourceUser,
      id: userId,
      clientMessageId: userId,
      content: input.content,
      branchGroupId: groupId,
    },
    createAssistantPlaceholder({
      id: assistantId,
      clientMessageId: userId,
      branchGroupId: groupId,
    }),
  ];
  const activeIndex = variants.length;
  variants.push(variant);
  return {
    groupId,
    group: { id: groupId, activeIndex, variants },
    variant,
  };
}
