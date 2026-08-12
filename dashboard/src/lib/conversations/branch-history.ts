import { ApiError } from "../hermes/route-core.ts";
import {
  listConversationMessages,
  type ConversationMessageRow,
} from "./store.ts";

export interface ConversationBranchHistoryReference {
  role: "user" | "assistant";
  clientMessageId?: string;
  messageId?: string;
}

const MAX_BRANCH_HISTORY_MESSAGES = 200;

function conversationMessageBranchGroupId(
  message: Pick<ConversationMessageRow, "metadata">,
): string | undefined {
  if (!message.metadata) return undefined;
  try {
    const metadata = JSON.parse(message.metadata) as Record<string, unknown>;
    return typeof metadata.branchGroupId === "string" &&
      metadata.branchGroupId.trim().length > 0
      ? metadata.branchGroupId
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Canonical storage retains every regenerated attempt so an older branch can
 * still be selected. A session transcript, however, must expose only the
 * currently active path. Each regenerated user row points at the original
 * client message (or an earlier sibling) through branchGroupId, so replaying
 * the log can replace that visible suffix with the newest sibling.
 */
export function projectConversationBranchMessages(
  messages: readonly ConversationMessageRow[],
): ConversationMessageRow[] {
  const projected: ConversationMessageRow[] = [];

  for (const message of messages) {
    const branchGroupId =
      message.role === "user"
        ? conversationMessageBranchGroupId(message)
        : undefined;

    if (branchGroupId) {
      const branchStart = projected.findIndex(
        (candidate) =>
          candidate.client_message_id === branchGroupId ||
          conversationMessageBranchGroupId(candidate) === branchGroupId,
      );
      if (branchStart >= 0) {
        projected.splice(branchStart);
      }
    }

    projected.push(message);
  }

  return projected;
}

export function parseConversationBranchHistory(
  value: unknown,
): ConversationBranchHistoryReference[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_BRANCH_HISTORY_MESSAGES) {
    throw new ApiError(
      400,
      "invalid_branch_history",
      `Branch history must contain at most ${MAX_BRANCH_HISTORY_MESSAGES} messages.`,
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(
        400,
        "invalid_branch_history",
        `Branch history item ${index + 1} is invalid.`,
      );
    }
    const candidate = item as Record<string, unknown>;
    if (candidate.role !== "user" && candidate.role !== "assistant") {
      throw new ApiError(
        400,
        "invalid_branch_history",
        `Branch history item ${index + 1} has an invalid role.`,
      );
    }
    const clientMessageId =
      typeof candidate.clientMessageId === "string" &&
      candidate.clientMessageId.trim().length > 0 &&
      candidate.clientMessageId.length <= 128
        ? candidate.clientMessageId
        : undefined;
    const messageId =
      typeof candidate.messageId === "string" &&
      /^msg_\d+$/.test(candidate.messageId)
        ? candidate.messageId
        : undefined;
    if (!clientMessageId && !messageId) {
      throw new ApiError(
        400,
        "invalid_branch_history",
        `Branch history item ${index + 1} has no durable message identity.`,
      );
    }
    return {
      role: candidate.role,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(messageId ? { messageId } : {}),
    };
  });
}

/**
 * Resolve browser-supplied references back to this conversation's canonical
 * rows. Content is never trusted from the browser, and the selected path must
 * retain canonical message order.
 */
export function resolveConversationBranchHistory(
  conversationId: number,
  references: readonly ConversationBranchHistoryReference[],
): ConversationMessageRow[] {
  const messages = listConversationMessages(conversationId, {
    limit: 500,
    includePending: false,
  });
  return selectConversationBranchHistory(messages, references);
}

export function selectConversationBranchHistory(
  messages: readonly ConversationMessageRow[],
  references: readonly ConversationBranchHistoryReference[],
): ConversationMessageRow[] {
  const byPublicId = new Map(messages.map((message) => [`msg_${message.id}`, message]));
  const byClientRole = new Map(
    messages.map((message) => [
      `${message.client_message_id}\0${message.role}`,
      message,
    ]),
  );
  const resolved: ConversationMessageRow[] = [];
  let priorOrder = -1;

  for (const [index, reference] of references.entries()) {
    const message =
      (reference.messageId ? byPublicId.get(reference.messageId) : undefined) ??
      (reference.clientMessageId
        ? byClientRole.get(`${reference.clientMessageId}\0${reference.role}`)
        : undefined);
    if (
      !message ||
      message.role !== reference.role ||
      message.status === "pending" ||
      message.order_index <= priorOrder
    ) {
      throw new ApiError(
        409,
        "branch_history_stale",
        `Branch history item ${index + 1} no longer matches this conversation.`,
      );
    }
    resolved.push(message);
    priorOrder = message.order_index;
  }

  return resolved;
}

export function runtimeMessagesForBranch(
  messages: readonly ConversationMessageRow[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter(
      (
        message,
      ): message is ConversationMessageRow & {
        role: "user" | "assistant";
      } => message.role === "user" || message.role === "assistant",
    )
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
}
