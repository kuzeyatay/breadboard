"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatExactTokenCount,
  formatResponseDuration,
  formatTokenCount,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import { parseChatTimestamp } from "@/lib/chat-time-separators";

function timestamp(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  return parseChatTimestamp(value) ?? undefined;
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
  agentName = "Assistant",
  label = "Thinking",
  action,
  showTokenUsage = true,
  disclosureExpanded,
  disclosureControls,
  onDisclosureToggle,
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
  /** Makes the lifecycle row the trigger for response-owned progress updates. */
  disclosureExpanded?: boolean;
  disclosureControls?: string;
  onDisclosureToggle?: () => void;
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
  // A usage record can exist purely to carry the response's duration — an
  // external agent that never reported tokens still has to say how long it
  // took. All-zero counters are the absence of a token report, not a response
  // that somehow cost nothing, and reading them as "0 tokens" states a number
  // nobody measured.
  const noTokenReport =
    usage !== undefined &&
    !usage.inputTokens &&
    !usage.outputTokens &&
    !usage.totalTokens &&
    totalTokens === undefined;
  const responseTokens =
    sessionSnapshot || noTokenReport ? undefined : reportedTokens;
  const tokenLabel = showTokenUsage
    ? typeof responseTokens === "number" &&
      Number.isFinite(responseTokens) &&
      responseTokens >= 0
      ? `↓ ${tokensEstimated ? "~" : ""}${formatTokenCount(
          responseTokens,
        ).toLowerCase()} tokens`
      : active
        ? "↓ counting tokens..."
        : null
    : null;
  const usageBreakdown = usage && !sessionSnapshot && !noTokenReport
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
  const metaContents = (
    <>
      <span className={shimmer ? "thinking-shimmer" : ""}>{displayLabel}</span>
      {metadata ? (
        <span title={usageBreakdown}>
          (
          {elapsedMs === undefined
            ? null
            : formatResponseDuration(elapsedMs)}
          {elapsedMs !== undefined && tokenLabel ? " · " : null}
          {tokenLabel ? (
            <>
              <span
                aria-hidden="true"
                className={active ? "thinking-token-arrow" : undefined}
              >
                ↓
              </span>
              {tokenLabel.slice(1)}
            </>
          ) : null}
          )
        </span>
      ) : null}
      {onDisclosureToggle ? (
        <svg
          aria-hidden="true"
          className={`ml-0.5 h-3 w-3 self-center transition-transform ${
            disclosureExpanded ? "rotate-90" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
        </svg>
      ) : null}
    </>
  );

  return (
    <section
      aria-label={`${agentName} ${displayLabel.toLowerCase()}${tokenLabel ? " and token usage" : ""}`}
      className="my-1 text-[var(--ink)]"
      data-response-state={failed ? "failed" : active ? "active" : "complete"}
    >
      <div className="flex items-center justify-between gap-3">
        {onDisclosureToggle ? (
          <button
            type="button"
            onClick={onDisclosureToggle}
            aria-expanded={disclosureExpanded}
            aria-controls={disclosureControls}
            title={disclosureExpanded ? "Hide thinking updates" : "Show thinking updates"}
            className="-ml-1 flex min-w-0 cursor-pointer flex-wrap items-baseline gap-x-1 rounded-md px-1 py-1 text-left text-sm leading-6 text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-heading)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
          >
            {metaContents}
          </button>
        ) : (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 py-1 text-sm leading-6 text-[var(--ink-muted)]">
            {metaContents}
          </div>
        )}
        {action}
      </div>
    </section>
  );
}
