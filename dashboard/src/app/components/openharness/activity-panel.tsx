"use client";

import { useEffect, useMemo, useState } from "react";
import { assistantResponseElapsedMs } from "@/lib/assistant-activity-timing";
import {
  formatResponseDuration,
  formatTokenCount,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import type {
  ActivityItem,
  ConnectionState,
  PermissionPrompt,
} from "./use-agent-session";

interface Props {
  activities: ActivityItem[];
  connection: ConnectionState;
  pendingPermission: PermissionPrompt | null;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  onAbort: () => void;
  showAbort?: boolean;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
}

export default function ActivityPanel({
  activities,
  connection,
  pendingPermission,
  usage,
  responseDurationMs,
  onAbort,
  showAbort = true,
  onPermissionDecision,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const active =
    connection === "connecting" ||
    connection === "streaming" ||
    connection === "waiting";
  const elapsedMs = useMemo(
    () => assistantResponseElapsedMs({
      activities,
      active,
      now,
      reportedDurationMs: responseDurationMs ?? usage?.responseDurationMs,
    }),
    [active, activities, now, responseDurationMs, usage?.responseDurationMs],
  );

  useEffect(() => {
    // Capture the exact transition to both active and terminal states instead
    // of leaving the display on the previous one-second interval tick.
    const transitionTick = window.setTimeout(() => setNow(Date.now()), 0);
    if (!active) return () => window.clearTimeout(transitionTick);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(transitionTick);
      window.clearInterval(timer);
    };
  }, [active]);

  if (!activities.length && !usage && responseDurationMs === undefined) return null;
  const durationLabel =
    elapsedMs === null ? null : formatResponseDuration(elapsedMs);
  const tokenLabel = usage
    ? `↓ ${usage.estimated ? "~" : ""}${formatTokenCount(usage.totalTokens).toLowerCase()} tokens`
    : active
      ? "↓ counting tokens..."
      : "↓ tokens unavailable";
  const statusMetadata = [durationLabel, tokenLabel]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="my-1 text-[var(--ink)]">
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex min-w-0 flex-wrap items-baseline gap-x-1 py-1 text-sm leading-6 text-[var(--ink-muted)]"
        >
          <span
            className={active && !pendingPermission ? "thinking-shimmer" : ""}
          >
            Thinking
          </span>
          <span>({statusMetadata})</span>
        </div>
        {active && showAbort ? (
          <button
            type="button"
            onClick={onAbort}
            className="px-1.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Stop
          </button>
        ) : null}
      </div>

      {pendingPermission ? (
        <div className="neu-surface-subtle mt-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              Permission required
            </p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
              {pendingPermission.description}
            </p>
            {pendingPermission.command ? (
              <code className="mt-2 block overflow-x-auto rounded-lg bg-black/[0.035] px-2.5 py-1.5 text-[10px] text-[var(--ink)]">
                {pendingPermission.command}
              </code>
            ) : null}
            {pendingPermission.affectedPaths.length ? (
              <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                {pendingPermission.affectedPaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPermissionDecision("once")}
              className="neu-button-accent rounded-full bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-white transition hover:bg-[var(--botanical-hover)]"
            >
              Allow once
            </button>
            {pendingPermission.allowSession ? (
              <button
                type="button"
                onClick={() => onPermissionDecision("always")}
                className="neu-button rounded-full bg-[var(--paper-raised)] px-4 py-2 text-xs font-medium text-[var(--botanical)] transition hover:bg-[var(--paper-bg)]"
              >
                Allow similar for session
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onPermissionDecision("reject")}
              className="neu-button-destructive rounded-full bg-red-500/[0.07] px-3.5 py-2 text-xs font-medium text-[#a45f56] transition hover:bg-red-500/[0.12]"
            >
              Deny
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
