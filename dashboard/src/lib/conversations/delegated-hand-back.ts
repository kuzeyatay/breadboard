import { agentLaunchContinuationMessage, MAX_AGENT_LAUNCH_HOPS } from "../hermes/agent-launch.ts";
import { agentLaunchContinuationIds } from "./delegated-agent-provenance.ts";
import {
  externalAgentDisplayName,
  parseExternalAgentOutcome,
  parseExternalAgentRun,
} from "./external-agent-runs.ts";

export interface HandBackMessage {
  clientMessageId: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface PendingHandBack {
  workerClientMessageId: string;
  text: string;
}

/**
 * The next finished delegated worker whose result was never handed back.
 *
 * The browser normally starts this hidden continuation turn from memory
 * (awaitedLaunchesRef), so a closed tab or a dashboard restart left the
 * parent waiting forever. Continuation messages carry a durable
 * `agent-launch-result:<worker>` marker, which is the claim checked here.
 * Telegram owns its own workers; a turn still pending blocks hand-back.
 */
export function nextPendingHandBack(
  messages: readonly HandBackMessage[],
  options: { now?: number; minAgeMs?: number; maxAgeMs?: number } = {},
): PendingHandBack | null {
  const now = options.now ?? Date.now();
  if (messages.some((m) => m.status === "pending")) return null;
  const claimed = new Set(
    messages.filter((m) => m.role === "user").flatMap((m) => agentLaunchContinuationIds(m.content)),
  );
  // Same hop budget as the browser: after this many hand-backs in a row with
  // no message from the person, wait for them.
  let hops = 0;
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (agentLaunchContinuationIds(message.content).length === 0) break;
    hops += 1;
  }
  if (hops >= MAX_AGENT_LAUNCH_HOPS) return null;
  const workers = messages.filter((m) =>
    m.role === "assistant" &&
    m.metadata.delegatedAgentRun === true &&
    m.metadata.awaitResult !== false &&
    m.metadata.deliveryChannel !== "telegram",
  );
  for (const worker of workers) {
    if (claimed.has(worker.clientMessageId)) continue;
    const outcome = parseExternalAgentOutcome(worker.metadata.externalAgentOutcome);
    const run = parseExternalAgentRun(worker.metadata.externalAgentRun);
    if (!outcome || outcome === "running" || !run) continue;
    const finishedAt = Date.parse(String(worker.metadata.responseCompletedAt ?? ""));
    if (Number.isFinite(finishedAt)) {
      // Leave an open page time to do it first; never revive ancient runs.
      if (now - finishedAt < (options.minAgeMs ?? 0)) continue;
      if (options.maxAgeMs !== undefined && now - finishedAt > options.maxAgeMs) continue;
    }
    const remaining = workers.filter((other) =>
      other !== worker &&
      !claimed.has(other.clientMessageId) &&
      parseExternalAgentOutcome(other.metadata.externalAgentOutcome) === "running",
    ).length;
    const reason = typeof worker.metadata.delegatedAgentReason === "string"
      ? worker.metadata.delegatedAgentReason
      : undefined;
    return {
      workerClientMessageId: worker.clientMessageId,
      text: agentLaunchContinuationMessage({
        continuationId: worker.clientMessageId,
        agentName: externalAgentDisplayName(run.kind),
        reason,
        outcome,
        content: typeof worker.metadata.externalAgentResult === "string"
          ? worker.metadata.externalAgentResult
          : worker.content,
        remaining,
      }),
    };
  }
  return null;
}
