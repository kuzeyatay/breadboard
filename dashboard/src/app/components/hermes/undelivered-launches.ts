// Agent hand-offs the page never received.
//
// When the model delegates a turn (`agent_launch`), the server records the
// request and emits it on the conversation's live event stream; the surface
// then starts the run. A page that had no live stream at that moment — it
// navigated away, refreshed, or the stream had already closed — never sees
// the request, the turn completes with only its hand-off sentence, and nothing
// runs. The request is not lost, though: the finished reply's evidence ledger
// carries the tool call with its `agent` and `brief`. This rebuilds it from
// there so a restored transcript can still start the run.

import type { AgentLaunchRequestPayload } from "../../../lib/hermes/agent-launch.ts";

/** The subset of a transcript message this needs; the real type is wider. */
export interface LaunchEvidenceMessage {
  readonly role: "user" | "assistant";
  readonly clientMessageId?: string;
  readonly pending?: boolean;
  readonly failed?: boolean;
  readonly interrupted?: boolean;
  readonly tools?: ReadonlyArray<{
    readonly toolCallId: string;
    readonly toolName: string;
    readonly status?: string;
  }>;
  readonly verification?: {
    readonly evidence?: ReadonlyArray<{
      readonly toolCallId?: string;
      readonly success?: boolean;
      readonly details?: Record<string, unknown>;
    }>;
  };
  readonly externalAgent?: unknown;
  readonly delegatedAgentRun?: boolean;
  readonly modelChange?: unknown;
}

const AGENT_NAMES: Record<string, string> = {
  "max-research": "Max Research",
  "deep-research": "Deep Research",
  "agent-reach": "Agent Reach",
  "get-doc": "Get Doc",
  openscience: "OpenScience",
};

function agentName(agentId: string): string {
  return (
    AGENT_NAMES[agentId] ??
    agentId
      .split("-")
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(" ")
  );
}

/** Identity shared by a live request and its rebuilt twin for one tool call. */
export function restoredLaunchRequestId(toolCallId: string): string {
  return `restored:${toolCallId}`;
}

/**
 * Launch requests recorded by the newest finished assistant turn that nothing
 * ever acted on. Only the last assistant message is considered: once anything
 * follows it — the launched run's own turn, a new question — the hand-off was
 * either delivered or overtaken.
 */
export function undeliveredLaunchRequests(
  messages: ReadonlyArray<LaunchEvidenceMessage>,
): AgentLaunchRequestPayload[] {
  const visible = messages.filter((message) => !message.modelChange);
  const last = visible.at(-1);
  if (
    !last ||
    last.role !== "assistant" ||
    last.pending ||
    last.failed ||
    last.interrupted ||
    (last.externalAgent || last.delegatedAgentRun === true)
  ) {
    return [];
  }
  const requests: AgentLaunchRequestPayload[] = [];
  for (const tool of last.tools ?? []) {
    if (tool.toolName !== "agent_launch" || tool.status === "failed") continue;
    const evidence = last.verification?.evidence?.find(
      (entry) => entry.toolCallId === tool.toolCallId,
    );
    if (!evidence || evidence.success === false) continue;
    const args =
      evidence.details && typeof evidence.details.args === "object" && evidence.details.args
        ? (evidence.details.args as Record<string, unknown>)
        : null;
    const agentId = typeof args?.agent === "string" ? args.agent.trim() : "";
    const brief = typeof args?.brief === "string" ? args.brief.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(agentId) || !brief) continue;
    requests.push({
      requestId: restoredLaunchRequestId(tool.toolCallId),
      agentId,
      agentName: agentName(agentId),
      command: `/agents:${agentId}`,
      brief,
      reason: "",
      awaitResult: true,
      // The original request's approval class is not in the ledger. Asking is
      // the safe default; under YOLO the queue starts it without asking.
      requiresApproval: true,
      ...(last.clientMessageId ? { originClientMessageId: last.clientMessageId } : {}),
    });
  }
  return requests;
}
