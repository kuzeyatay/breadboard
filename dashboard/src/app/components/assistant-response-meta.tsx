"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatExactTokenCount,
  formatResponseDuration,
  formatTokenCount,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";

function timestamp(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function AssistantResponseMeta({
  active,
  shimmer = active,
  failed = false,
  usage,
  totalTokens,
  estimated = false,
  responseDurationMs,
  startedAt,
  completedAt,
  summary,
  agentName = "Assistant",
  label = "Thinking",
  action,
  showTokenUsage = true,
}: {
  active: boolean;
  shimmer?: boolean;
  failed?: boolean;
  usage?: ChatTokenUsage;
  totalTokens?: number;
  estimated?: boolean;
  responseDurationMs?: number;
  startedAt?: string | number;
  completedAt?: string | number;
  summary?: string;
  agentName?: string;
  /** Current assistant lifecycle state, shown in the message's meta row. */
  label?: string;
  action?: ReactNode;
  showTokenUsage?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const elapsedMs = useMemo(() => {
    const reported = responseDurationMs ?? usage?.responseDurationMs;
    if (
      typeof reported === "number" &&
      Number.isFinite(reported) &&
      reported >= 0
    ) {
      return reported;
    }
    const started = timestamp(startedAt);
    if (started === undefined) return undefined;
    return Math.max(0, (timestamp(completedAt) ?? now) - started);
  }, [
    completedAt,
    now,
    responseDurationMs,
    startedAt,
    usage?.responseDurationMs,
  ]);

  const reportedTokens = usage?.totalTokens ?? totalTokens;
  const tokensEstimated = usage?.estimated ?? estimated;
  // A cumulative session snapshot counts every earlier turn as well, so it is
  // not what this answer cost. This row only ever states one response's tokens:
  // a snapshot leaves the count unavailable rather than charging the whole
  // conversation to the message that happens to carry it.
  const sessionSnapshot = usage?.scope === "session";
  const responseTokens = sessionSnapshot ? undefined : reportedTokens;
  const tokenLabel = showTokenUsage
    ? typeof responseTokens === "number" &&
      Number.isFinite(responseTokens) &&
      responseTokens >= 0
      ? `↓ ${tokensEstimated ? "~" : ""}${formatTokenCount(
          responseTokens,
        ).toLowerCase()} tokens`
      : active
        ? "↓ counting tokens..."
        : "↓ tokens unavailable"
    : null;
  const usageBreakdown = usage && !sessionSnapshot
    ? [
        `${formatExactTokenCount(usage.inputTokens)} input processed`,
        `${formatExactTokenCount(usage.outputTokens)} generated`,
        usage.contextUsedTokens !== undefined &&
        usage.contextLimitTokens !== undefined
          ? `context ${formatExactTokenCount(usage.contextUsedTokens)} / ${formatExactTokenCount(usage.contextLimitTokens)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const metadata = [
    elapsedMs === undefined ? null : formatResponseDuration(elapsedMs),
    tokenLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  // "Thinking" is the only label that names something still happening, so it is
  // the only one that reads wrong once the turn is over — the row stays on the
  // message for good, and a finished answer should say what it did, not what it
  // is doing. Every other label a caller passes ("Interrupted", an artifact's
  // own) already describes a state of its own and is shown exactly as given.
  const displayLabel = label === "Thinking" && !active && !failed ? "Thought" : label;

  return (
    <section
      aria-label={`${agentName} ${displayLabel.toLowerCase()}${showTokenUsage ? " and token usage" : ""}`}
      className="my-1 text-[var(--ink)]"
      data-response-state={failed ? "failed" : active ? "active" : "complete"}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 py-1 text-sm leading-6 text-[var(--ink-muted)]">
          <span className={shimmer ? "thinking-shimmer" : ""}>{displayLabel}</span>
          {metadata ? <span title={usageBreakdown}>({metadata})</span> : null}
        </div>
        {action}
      </div>
      {summary ? (
        <p className="truncate text-[11px] text-[var(--ink)]" title={summary}>
          {summary}
        </p>
      ) : null}
    </section>
  );
}
