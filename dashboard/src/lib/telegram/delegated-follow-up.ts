import {
  agentLaunchContinuationMessage,
  MAX_AGENT_LAUNCH_HOPS,
} from "../hermes/agent-launch.ts";
import { agentLaunchContinuationIds } from "../conversations/delegated-agent-provenance.ts";
import {
  externalAgentDisplayName,
  parseExternalAgentOutcome,
  parseExternalAgentRun,
} from "../conversations/external-agent-runs.ts";

export interface TelegramFollowUpMessage {
  clientMessageId: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "failed" | "aborted";
  orderIndex: number;
  metadata: Record<string, unknown>;
}

export interface TelegramDelegatedFollowUp {
  conversationId: number;
  afterOrder: number;
}

export interface TelegramFollowUpWorker {
  clientMessageId: string;
  orderIndex: number;
  agentName: string;
  reason?: string;
  outcome: "running" | "completed" | "failed" | "aborted";
  content: string;
}

export interface DeliverTelegramFollowUpsInput extends TelegramDelegatedFollowUp {
  listMessages: () => TelegramFollowUpMessage[];
  startContinuation: (input: {
    clientMessageId: string;
    text: string;
  }) => Promise<void>;
  onReply: (content: string) => Promise<void>;
  maxWaitMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

function deliveryChannel(metadata: Record<string, unknown>): string {
  return typeof metadata.deliveryChannel === "string"
    ? metadata.deliveryChannel
    : "";
}

function workerFromMessage(
  message: TelegramFollowUpMessage,
  afterOrder: number,
): TelegramFollowUpWorker | null {
  if (
    message.role !== "assistant" ||
    message.orderIndex <= afterOrder ||
    message.metadata.delegatedAgentRun !== true ||
    deliveryChannel(message.metadata) !== "telegram"
  ) {
    return null;
  }
  const run = parseExternalAgentRun(message.metadata.externalAgentRun);
  const outcome = parseExternalAgentOutcome(message.metadata.externalAgentOutcome);
  if (!run || !outcome) return null;
  return {
    clientMessageId: message.clientMessageId,
    orderIndex: message.orderIndex,
    agentName: externalAgentDisplayName(run.kind),
    ...(typeof message.metadata.delegatedAgentReason === "string" &&
    message.metadata.delegatedAgentReason.trim()
      ? { reason: message.metadata.delegatedAgentReason.trim() }
      : {}),
    outcome,
    content:
      typeof message.metadata.externalAgentResult === "string"
        ? message.metadata.externalAgentResult
        : "",
  };
}

export function telegramDelegatedWorkers(
  messages: TelegramFollowUpMessage[],
  afterOrder: number,
): TelegramFollowUpWorker[] {
  return messages
    .map((message) => workerFromMessage(message, afterOrder))
    .filter((worker): worker is TelegramFollowUpWorker => worker !== null)
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

export function telegramContinuationClientMessageId(workerClientMessageId: string): string {
  const safe = workerClientMessageId
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, 104);
  return `telegram-followup-${safe || "delegated-result"}`.slice(0, 128);
}

function continuationPair(
  messages: TelegramFollowUpMessage[],
  workerClientMessageId: string,
): { user: TelegramFollowUpMessage; assistant: TelegramFollowUpMessage | null } | null {
  const user = messages.find(
    (message) =>
      message.role === "user" &&
      agentLaunchContinuationIds(message.content).includes(workerClientMessageId),
  );
  if (!user) return null;
  return {
    user,
    assistant:
      messages.find(
        (message) =>
          message.role === "assistant" &&
          message.clientMessageId === user.clientMessageId,
      ) ?? null,
  };
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Complete the private worker -> Super Agent hand-back for a Telegram turn.
 *
 * Browser chats perform this hand-back in their mounted surface. Telegram has
 * no mounted React surface, so leaving it there makes the bot send only the
 * assistant's immediate "research is running" line. This transport-owned loop
 * waits for each durable worker, starts the same hidden continuation turn, and
 * emits every resulting user-visible assistant reply. A worker result is used
 * verbatim as the final safety net if synthesis cannot be started or completed.
 */
export async function deliverTelegramDelegatedFollowUps(
  input: DeliverTelegramFollowUpsInput,
): Promise<void> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const pollMs = Math.max(1, input.pollMs ?? 750);
  const deadline = now() + Math.max(1, input.maxWaitMs);
  const handled = new Set<string>();

  for (let hop = 0; hop < MAX_AGENT_LAUNCH_HOPS; hop += 1) {
    let workers = telegramDelegatedWorkers(input.listMessages(), input.afterOrder);
    let worker = workers.find((candidate) => !handled.has(candidate.clientMessageId));
    if (!worker) return;
    const workerClientMessageId = worker.clientMessageId;

    while (worker.outcome === "running" && now() < deadline) {
      await sleep(pollMs);
      workers = telegramDelegatedWorkers(input.listMessages(), input.afterOrder);
      worker =
        workers.find((candidate) => candidate.clientMessageId === workerClientMessageId) ??
        worker;
    }
    if (worker.outcome === "running") return;
    handled.add(worker.clientMessageId);

    const remaining = workers.filter(
      (candidate) =>
        candidate.clientMessageId !== workerClientMessageId &&
        !handled.has(candidate.clientMessageId),
    ).length;
    let messages = input.listMessages();
    let pair = continuationPair(messages, workerClientMessageId);
    let continuationDeadline = deadline;
    if (!pair) {
      const clientMessageId = telegramContinuationClientMessageId(workerClientMessageId);
      const text = agentLaunchContinuationMessage({
        continuationId: workerClientMessageId,
        agentName: worker.agentName,
        reason: worker.reason,
        outcome: worker.outcome,
        content: worker.content,
        remaining,
      });
      try {
        await input.startContinuation({ clientMessageId, text });
      } catch {
        // A browser from an older build can win this race. Its marker is the
        // durable claim, so briefly check for that continuation before using
        // the raw worker report as the safety net.
        continuationDeadline = Math.min(deadline, now() + 5_000);
      }
    }

    while (now() < continuationDeadline) {
      messages = input.listMessages();
      pair = continuationPair(messages, workerClientMessageId);
      if (pair?.assistant && pair.assistant.status !== "pending") break;
      await sleep(pollMs);
    }

    const assistant = pair?.assistant;
    if (assistant?.status === "complete" && assistant.content.trim()) {
      await input.onReply(assistant.content.trim());
      continue;
    }

    // Never discard a completed research report because the final wording
    // turn failed or exceeded its wait window. Telegram's sender splits this
    // full text across as many messages as the Bot API requires.
    if (worker.content.trim()) {
      await input.onReply(worker.content.trim());
    } else if (assistant?.content.trim()) {
      await input.onReply(assistant.content.trim());
    }
  }
}
