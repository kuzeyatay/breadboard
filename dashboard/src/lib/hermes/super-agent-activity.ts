import {
  sumChatTokenUsage,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";

const SUPER_AGENT_TOOL_LABELS: Readonly<Record<string, string>> = {
  agent_launch: "Choosing an agent",
  skill_open: "Opening skill",
  workflow_run: "Running automation",
  workflow_create: "Creating automation",
  mcp_call: "Using connected service",
  capability_search: "Searching capabilities",
  capability_gap: "Finding a capability",
  tool_search: "Inspecting capabilities",
  tool_describe: "Inspecting capability",
  research_begin: "Planning research",
  research_record: "Recording research",
  research_status: "Checking research coverage",
  delegate_task: "Starting specialist",
  clarify: "Asking you a question",
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

interface DelegationPresentationMessage {
  role: "user" | "assistant";
  content: string;
  internalAgentContinuation?: boolean;
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  openGymRun?: unknown;
  godsEyeRun?: unknown;
  modelChange?: unknown;
  textSelection?: { mode?: string };
}

// openGym and God's Eye answer with their own self-contained presentation — a
// framed animation, a framed globe — so a delegation to them stays a visible
// row instead of a hidden worker awaiting synthesis.
function selfPresentingDelegation(message: {
  openGymRun?: unknown;
  godsEyeRun?: unknown;
}): boolean {
  return Boolean(message.openGymRun || message.godsEyeRun);
}

function visibleAssistantCandidate(
  message: DelegationPresentationMessage,
): boolean {
  return (
    message.role === "assistant" &&
    !(message.delegatedAgentRun === true && !selfPresentingDelegation(message)) &&
    !message.modelChange &&
    message.textSelection?.mode !== "inline"
  );
}

/**
 * Internal hand-backs are separate durable turns, but one delegation is one
 * visible answer. Each continuation therefore supersedes the prior visible
 * assistant in the same uninterrupted chain; a real user message starts a new
 * chain and prevents unrelated answers from being folded together.
 *
 * A self-presenting worker is the exception. Its animation or globe is an
 * irreplaceable part of the answer, not an interim sentence synthesis can carry
 * forward. Keep that row beside the hand-back instead of dropping the widget.
 */
export function supersededDelegationAssistantIndices(
  messages: readonly DelegationPresentationMessage[],
): Set<number> {
  const superseded = new Set<number>();
  let visibleAssistantIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "user" && message.internalAgentContinuation !== true) {
      visibleAssistantIndex = -1;
      continue;
    }
    if (!visibleAssistantCandidate(message)) continue;
    if (
      messages[index - 1]?.role === "user" &&
      messages[index - 1]?.internalAgentContinuation === true &&
      visibleAssistantIndex >= 0
    ) {
      const visibleAssistant = messages[visibleAssistantIndex]!;
      if (!selfPresentingDelegation(visibleAssistant)) {
        superseded.add(visibleAssistantIndex);
      }
    }
    visibleAssistantIndex = index;
  }
  return superseded;
}

/** Keep the original hand-off text in the single row until synthesis speaks. */
export function delegatedContinuationPreamble(
  messages: readonly DelegationPresentationMessage[],
  assistantIndex: number,
): string {
  if (
    messages[assistantIndex]?.role !== "assistant" ||
    messages[assistantIndex - 1]?.role !== "user" ||
    messages[assistantIndex - 1]?.internalAgentContinuation !== true
  ) {
    return "";
  }
  let preamble = "";
  for (let index = assistantIndex - 2; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && message.internalAgentContinuation !== true) {
      break;
    }
    if (!visibleAssistantCandidate(message)) continue;
    const content =
      message.delegatedAgentPreamble?.trim() || message.content.trim();
    if (content) preamble = content;
  }
  return preamble;
}

function agentLabel(agentName: string): string {
  const name = agentName.trim();
  if (!name) return "agent";
  return `${name}${/\bagent$/i.test(name) ? "" : " agent"}`;
}

function delegationLabel(prefix: string, agentName: string): string {
  return `${prefix} ${agentLabel(agentName)}`;
}

interface DelegatedContinuationPhaseMessage extends DelegationPresentationMessage {
  responseDurationMs?: number;
  usage?: ChatTokenUsage;
}

/**
 * Every completed assistant phase hidden behind one continuation answer.
 *
 * The Super Agent's orchestration response and the worker response are separate
 * durable turns. Looking only at the immediately preceding worker loses the
 * orchestration time (30 seconds in the common God's Eye path). Walk back to the
 * person's actual message so the visible hand-back can report the full wait.
 */
function delegatedContinuationPriorPhases(
  messages: readonly DelegatedContinuationPhaseMessage[],
  assistantIndex: number,
): DelegatedContinuationPhaseMessage[] {
  if (
    messages[assistantIndex]?.role !== "assistant" ||
    messages[assistantIndex - 1]?.role !== "user" ||
    messages[assistantIndex - 1]?.internalAgentContinuation !== true
  ) {
    return [];
  }

  const phases: DelegatedContinuationPhaseMessage[] = [];
  let containsDelegatedWorker = false;
  for (let index = assistantIndex - 2; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") {
      if (message.internalAgentContinuation === true) continue;
      break;
    }
    phases.push(message);
    if (message.delegatedAgentRun === true) containsDelegatedWorker = true;
  }
  return containsDelegatedWorker ? phases.reverse() : [];
}

/** The elapsed time a hand-back inherits from all of its earlier phases. */
export function delegatedTurnCarriedDurationMs(
  messages: readonly DelegatedContinuationPhaseMessage[],
  assistantIndex: number,
): number | undefined {
  const durations = delegatedContinuationPriorPhases(messages, assistantIndex)
    .map((phase) => phase.responseDurationMs)
    .filter(
      (duration): duration is number =>
        typeof duration === "number" && Number.isFinite(duration),
    );
  return durations.length > 0
    ? durations.reduce((total, duration) => total + Math.max(0, duration), 0)
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
  messages: readonly DelegatedContinuationPhaseMessage[],
  assistantIndex: number,
  continuation: ChatTokenUsage | undefined,
): ChatTokenUsage | undefined {
  const priorUsages = delegatedContinuationPriorPhases(messages, assistantIndex)
    .map((phase) => phase.usage)
    .filter((usage): usage is ChatTokenUsage => Boolean(usage));
  if (priorUsages.length === 0) return continuation;
  const usages = continuation ? [...priorUsages, continuation] : priorUsages;
  const latestUsage = continuation ?? priorUsages.at(-1);
  const apiCalls =
    usages.some((usage) => usage.apiCalls !== undefined)
      ? usages.reduce((total, usage) => total + (usage.apiCalls ?? 0), 0)
      : undefined;
  return {
    // sumChatTokenUsage drops a legacy cumulative session snapshot rather than
    // double-counting rows it already covers; that rule holds here too.
    ...sumChatTokenUsage(usages),
    ...(latestUsage?.scope ? { scope: latestUsage.scope } : {}),
    ...(apiCalls !== undefined ? { apiCalls } : {}),
    ...(latestUsage?.contextUsedTokens !== undefined
      ? { contextUsedTokens: latestUsage.contextUsedTokens }
      : {}),
    ...(latestUsage?.contextLimitTokens !== undefined
      ? { contextLimitTokens: latestUsage.contextLimitTokens }
      : {}),
    // The row's own duration stays its own: the delegation's share of the clock
    // is carried separately, and adding it twice would double the total.
    ...(continuation?.responseDurationMs !== undefined
      ? { responseDurationMs: continuation.responseDurationMs }
      : {}),
  };
}

export type DelegatedWorkerOutcome = "running" | "completed" | "failed" | "aborted";

interface DelegatedWorkerMessage {
  role: "user" | "assistant";
  content: string;
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  openGymRun?: unknown;
  godsEyeRun?: unknown;
  internalAgentContinuation?: boolean;
  externalAgentOutcome?: string;
  externalAgentName?: string;
  externalAgentResult?: string;
  delegatedAgentReason?: string;
}

/**
 * The hidden workers a visible assistant turn delegated to.
 *
 * A delegated worker is its own durable turn, but it draws nothing: its rows
 * sit directly after the assistant that launched it, hidden, until either a
 * hand-back speaks for it or a real user message starts a new chain. The
 * launching row is the only thing on screen that can say what became of the
 * work, so it has to be able to read those rows.
 */
export function delegatedWorkersForMessage<T extends DelegatedWorkerMessage>(
  messages: readonly T[],
  assistantIndex: number,
): T[] {
  if (messages[assistantIndex]?.role !== "assistant") return [];
  const workers: T[] = [];
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === "user") {
      if (message.internalAgentContinuation === true) continue;
      break;
    }
    if (message.delegatedAgentRun === true && !selfPresentingDelegation(message)) {
      workers.push(message);
      continue;
    }
    // A visible assistant — a hand-back or a later answer — closes the chain.
    break;
  }
  return workers;
}

/**
 * One outcome for a batch: still going while any worker runs; otherwise the
 * worst result, because a batch with one worker stopped is not a finished one.
 */
export function delegatedWorkersOutcome(
  workers: readonly DelegatedWorkerMessage[],
): DelegatedWorkerOutcome | undefined {
  if (workers.length === 0) return undefined;
  const outcomes = workers.map(
    (worker) => (worker.externalAgentOutcome ?? "running") as DelegatedWorkerOutcome,
  );
  if (outcomes.includes("running")) return "running";
  if (outcomes.includes("aborted")) return "aborted";
  if (outcomes.includes("failed")) return "failed";
  return "completed";
}

/**
 * The past-tense hand-off label, telling the truth about how it ended.
 *
 * "Delegated to Max Research agent" reads as an answer that came back. When the
 * worker was stopped or failed and nothing was handed back, the row was the
 * last word on screen and it said the same thing — a chat that looked finished
 * while its promised synthesis was never going to arrive.
 */
export function delegatedAgentOutcomeLabel(
  agentName: string,
  outcome: DelegatedWorkerOutcome | undefined,
): string {
  if (outcome === "aborted") return `${agentLabel(agentName)} stopped`;
  if (outcome === "failed") return `${agentLabel(agentName)} failed`;
  return delegatedAgentCompletedLabel(agentName);
}

export function delegatedAgentOutcomeLabelForMessage(
  message: DelegatedAgentMessageMetadata,
  outcome: DelegatedWorkerOutcome | undefined,
): string | undefined {
  const agentName = delegatedAgentNameForMessage(message);
  return agentName ? delegatedAgentOutcomeLabel(agentName, outcome) : undefined;
}

/** What the runtime recorded when a worker was stopped by a person, not by a failure. */
export const DELEGATED_WORKER_STOPPED_BY_USER = "Stopped by the user.";

function readableDelegatedFailure(value: string | undefined): string | undefined {
  const firstLine = value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 240);
  if (!firstLine) return undefined;
  // Worker output is diagnostic data, not UI copy. Keep a useful sentence such
  // as "Deep Research is not configured", but never flash implementation
  // debris while the Super Agent prepares the proper hand-back.
  if (
    /(?:node:internal|\\\\\?\\|[A-Za-z]:[\\/]|\b(?:EISDIR|ENOENT|EINVAL|EPERM|errno|syscall|lstat|argv)\b|^\s*at\s+\S)/i.test(
      firstLine,
    )
  ) {
    return undefined;
  }
  return firstLine.replace(/^(?:error|failure)\s*:\s*/i, "").trim() || undefined;
}

/**
 * A sentence for the row when the delegation ended without a hand-back.
 *
 * Stopped runs never come back as a continuation turn (the person asked for
 * quiet, or the run was cancelled underneath them), so without this line
 * nothing on screen would ever say the research is not coming. Failed runs do
 * hand back, but the synthesis can be a while; the line covers that gap and
 * disappears once the hand-back supersedes the row.
 */
export function delegatedWorkersOutcomeNote(
  workers: readonly DelegatedWorkerMessage[],
): string | undefined {
  const outcome = delegatedWorkersOutcome(workers);
  if (outcome !== "aborted" && outcome !== "failed") return undefined;
  const ended = workers.filter((worker) => worker.externalAgentOutcome === outcome);
  const names = [...new Set(ended.map((worker) => worker.externalAgentName?.trim() || "The delegated agent"))];
  const subject = names.join(" and ");
  if (outcome === "aborted") {
    const byUser = ended.every(
      (worker) => worker.externalAgentResult?.trim() === DELEGATED_WORKER_STOPPED_BY_USER,
    );
    return byUser
      ? `You stopped ${subject} before it returned anything, so there is nothing to synthesize. Retry to run it again.`
      : `${subject} was stopped before it returned anything, so there is nothing to synthesize. Retry to run it again.`;
  }
  const selectionReasons = [
    ...new Set(
      ended
        .map((worker) => worker.delegatedAgentReason?.trim().replace(/\s+/g, " "))
        .filter((reason): reason is string => Boolean(reason)),
    ),
  ];
  const reasons = ended
    .map((worker) => readableDelegatedFailure(worker.externalAgentResult))
    .filter((reason): reason is string => Boolean(reason))
  const selection = selectionReasons.length
    ? `Why ${subject} was selected: ${selectionReasons.join(" ")} `
    : "";
  return reasons.length
    ? `${selection}${subject} could not complete its part: ${reasons.join(" ")} No result was returned; the main assistant will explain the next step.`
    : `${selection}${subject} could not complete its part because a supporting service did not start. No result was returned; the main assistant will explain the next step.`;
}
