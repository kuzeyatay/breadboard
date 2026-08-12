"use client";

import { useMemo } from "react";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";

export interface AgentTarsMetricEvent {
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

interface TokenUsage {
  totalTokens: number;
  estimated: boolean;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function usageFrom(event: AgentTarsMetricEvent | undefined): TokenUsage | null {
  if (!event) return null;
  const totalTokens = count(event.payload.totalTokens);
  if (totalTokens === undefined) return null;
  return { totalTokens, estimated: event.payload.estimated === true };
}

export default function AgentTarsRunMetrics({
  events,
  active,
  failed = false,
  agentName = "Agent TARS",
}: {
  events: AgentTarsMetricEvent[];
  active: boolean;
  failed?: boolean;
  /** Name used in fallback copy; lets other runtimes reuse this. */
  agentName?: string;
}) {
  const thinkingEvents = useMemo(
    () => events.filter((event) => event.type === "agent.thinking"),
    [events],
  );
  const latestThinking = thinkingEvents.at(-1);
  const usage = useMemo(
    () => usageFrom(events.findLast((event) => event.type === "agent.usage")),
    [events],
  );
  const startedAt =
    thinkingEvents[0]?.at ??
    events.find((event) => event.type === "run.started")?.at;
  const reportedDuration =
    latestThinking?.payload.state === "completed"
      ? count(latestThinking.payload.durationMs)
      : undefined;
  const summary =
    (typeof latestThinking?.payload.summary === "string" &&
      latestThinking.payload.summary) ||
    (active
      ? `${agentName} is preparing the next step`
      : failed
        ? `${agentName} could not complete the task`
        : `${agentName} finished processing`);

  return (
    <AssistantResponseMeta
      active={active}
      failed={failed}
      totalTokens={usage?.totalTokens}
      estimated={usage?.estimated}
      responseDurationMs={reportedDuration}
      startedAt={startedAt}
      summary={summary}
      agentName={agentName}
    />
  );
}
