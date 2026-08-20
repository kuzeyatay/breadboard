import {
  sumChatTokenUsage,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";

const SUPER_AGENT_TOOL_LABELS: Readonly<Record<string, string>> = {
  agent_launch: "Choosing an agent",
  skill_open: "Opening skill",
  workflow_run: "Running automation",
  mcp_call: "Using connected service",
  capability_search: "Searching capabilities",
  capability_gap: "Finding a capability",
  tool_search: "Inspecting capabilities",
  tool_describe: "Inspecting capability",
  research_begin: "Planning research",
  research_record: "Recording research",
  research_status: "Checking research coverage",
  delegate_task: "Starting specialist",
};

/**
 * Present-tense orchestration labels used only for a Super Agent turn.
 * Ordinary agent turns keep the evidence-oriented tool labels they already use.
 */
export function superAgentActivityLabelForTool(
  toolName: string,
): string | undefined {
  const normalized = toolName.trim().toLowerCase().replace(/-/g, "_");
  return SUPER_AGENT_TOOL_LABELS[normalized];
}

export function delegatedAgentActivityLabel(agentName: string): string {
  return delegationLabel("Delegating to", agentName);
}

export function delegatedAgentCompletedLabel(agentName: string): string {
  return delegationLabel("Delegated to", agentName);
}

interface DelegatedAgentMessageMetadata {
  externalAgentName?: string;
  externalAgentStartedAt?: string;
  verification?: {
    externalAgents?: Array<{ agentName?: string; requestedAt?: string }>;
  };
}

function lastDelegatedAgent(message: DelegatedAgentMessageMetadata) {
  return message.verification?.externalAgents?.findLast(
    (agent) => Boolean(agent.agentName?.trim()),
  );
}

/**
 * Recover the completed hand-off label from fields that are persisted with the
 * assistant message. This keeps delegation distinct from Thought after reload.
 */
export function delegatedAgentCompletedLabelForMessage(
  message: DelegatedAgentMessageMetadata,
): string | undefined {
  const agentName = delegatedAgentNameForMessage(message);
  return agentName ? delegatedAgentCompletedLabel(agentName) : undefined;
}

/**
 * The present-tense hand-off label for a worker that is still running.
 *
 * A delegated run has no visible card, so this row is the only thing on screen
 * saying the turn is still going. Reading it back in the past tense made a live
 * delegation look like a finished answer that had stopped mid-thought.
 */
export function delegatedAgentActivityLabelForMessage(
  message: DelegatedAgentMessageMetadata,
): string | undefined {
  const agentName = delegatedAgentNameForMessage(message);
  return agentName ? delegatedAgentActivityLabel(agentName) : undefined;
}

function delegatedAgentNameForMessage(
  message: DelegatedAgentMessageMetadata,
): string | undefined {
  const verifiedAgentName = lastDelegatedAgent(message)?.agentName;
  return message.externalAgentName?.trim() || verifiedAgentName;
}

/** When the worker hand-off actually began; unlike message creation, this is run-specific. */
export function delegatedAgentStartedAtForMessage(
  message: DelegatedAgentMessageMetadata,
): string | undefined {
  if (
    message.externalAgentStartedAt &&
    Number.isFinite(Date.parse(message.externalAgentStartedAt))
  ) {
    return message.externalAgentStartedAt;
  }
  const requestedAt = lastDelegatedAgent(message)?.requestedAt?.trim();
  return requestedAt || undefined;
}

function delegationLabel(prefix: string, agentName: string): string {
  const name = agentName.trim();
  if (!name) return `${prefix} agent`;
  return `${prefix} ${name}${/\bagent$/i.test(name) ? "" : " agent"}`;
}

/**
 * The time a hand-back row inherits from the turn it is speaking for.
 *
 * A delegation ends with two turns and one visible row: the turn that delegated
 * is hidden, its text is carried into the hand-back, and the hand-back reports
 * the result. Its own duration is therefore only the synthesis — fifteen
 * seconds at the end of an operation that had been running for minutes, which
 * read as a wrong number rather than a partial one.
 *
 * The delegating turn's stored duration already folds in its worker phase (see
 * externalAgentResponseDurationMs), so it is the whole of what came before and
 * the two halves add up to the operation the person actually waited through.
 */
export function delegatedTurnCarriedDurationMs(
  owner: { delegatedAgentRun?: boolean; responseDurationMs?: number } | undefined,
): number | undefined {
  if (owner?.delegatedAgentRun !== true) return undefined;
  const duration = owner.responseDurationMs;
  return typeof duration === "number" && Number.isFinite(duration)
    ? Math.max(0, duration)
    : undefined;
}

/**
 * The token cost a hand-back row inherits from the turn it is speaking for.
 *
 * The same accounting as the clock above, and hidden for the same reason: the
 * delegating turn is dropped from the transcript once its hand-back exists, so
 * its tokens — usually the larger half, since that is the turn that did the
 * orchestrating — were spent where nobody could see them, and the visible row
 * reported only what the synthesis itself cost.
 *
 * The counters add; the context-window readings do not. Those describe how full
 * the window was for one response, so the last response's are the true ones and
 * summing them would invent a number that was never measured.
 */
export function delegatedTurnTotalUsage(
  owner:
    | { delegatedAgentRun?: boolean; usage?: ChatTokenUsage }
    | undefined,
  continuation: ChatTokenUsage | undefined,
): ChatTokenUsage | undefined {
  const ownerUsage =
    owner?.delegatedAgentRun === true ? owner.usage : undefined;
  if (!ownerUsage) return continuation;
  const apiCalls =
    ownerUsage.apiCalls !== undefined || continuation?.apiCalls !== undefined
      ? (ownerUsage.apiCalls ?? 0) + (continuation?.apiCalls ?? 0)
      : undefined;
  return {
    // sumChatTokenUsage drops a legacy cumulative session snapshot rather than
    // double-counting rows it already covers; that rule holds here too.
    ...sumChatTokenUsage([ownerUsage, continuation]),
    ...(continuation?.scope ? { scope: continuation.scope } : {}),
    ...(apiCalls !== undefined ? { apiCalls } : {}),
    ...(continuation?.contextUsedTokens !== undefined
      ? { contextUsedTokens: continuation.contextUsedTokens }
      : {}),
    ...(continuation?.contextLimitTokens !== undefined
      ? { contextLimitTokens: continuation.contextLimitTokens }
      : {}),
    // The row's own duration stays its own: the delegation's share of the clock
    // is carried separately, and adding it twice would double the total.
    ...(continuation?.responseDurationMs !== undefined
      ? { responseDurationMs: continuation.responseDurationMs }
      : {}),
  };
}
