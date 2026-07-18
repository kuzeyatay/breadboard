"use client";

import { useEffect, useMemo, useState } from "react";
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
  reasoning?: string;
  onAbort: () => void;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
}

function lowerFirst(value: string): string {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}

function activityStatusSentence(item: ActivityItem): string {
  const rawLabel = item.label.trim().replace(/[.!?]+$/, "");
  const phrase =
    item.kind === "answer"
      ? "Writing the answer"
      : item.kind === "permission"
        ? "Requesting permission"
        : rawLabel || "Working";

  if (item.status === "permission_required") return "Permission is required.";
  if (item.status === "denied") return "Permission was denied.";
  if (item.status === "failed") {
    return item.kind === "permission"
      ? "The permission request failed."
      : `${phrase} failed.`;
  }
  if (item.status === "cancelled") {
    return item.kind === "permission"
      ? "The permission request was cancelled."
      : `${phrase} was cancelled.`;
  }
  if (item.status === "running") return `${phrase}.`;
  if (item.kind === "reasoning") return "Done thinking.";
  if (item.kind === "answer") return "Finished writing the answer.";
  if (item.kind === "permission") return "Permission was granted.";
  return `Finished ${lowerFirst(phrase)}.`;
}

export default function ActivityPanel({
  activities,
  connection,
  pendingPermission,
  usage,
  reasoning,
  onAbort,
  onPermissionDecision,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const active =
    connection === "connecting" ||
    connection === "streaming" ||
    connection === "waiting";
  const startedAt = activities[0]?.startedAt;
  const completedAt = [...activities]
    .reverse()
    .find((item) => item.completedAt)?.completedAt;
  const elapsedMs = useMemo(() => {
    if (usage?.responseDurationMs !== undefined)
      return usage.responseDurationMs;
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    const end = active
      ? now
      : completedAt
        ? new Date(completedAt).getTime()
        : now;
    const value = end - start;
    return Number.isFinite(value) ? Math.max(0, value) : null;
  }, [active, completedAt, now, startedAt, usage?.responseDurationMs]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!activities.length && !usage && !reasoning) return null;
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
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 cursor-pointer flex-wrap items-baseline gap-x-1 py-1 text-left text-sm leading-6 text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          aria-expanded={expanded}
        >
          <span
            className={active && !pendingPermission ? "thinking-shimmer" : ""}
          >
            Thinking
          </span>
          <span>({statusMetadata})</span>
        </button>
        {active ? (
          <button
            type="button"
            onClick={onAbort}
            className="px-1.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Stop
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-1 space-y-2">
          {reasoning ? (
            <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-[var(--ink-muted)]">
              {reasoning}
            </pre>
          ) : null}
          {activities.length ? (
            <ol className="space-y-1.5 pl-0.5">
              {activities.map((item) => (
                <li key={item.id} className="text-xs">
                  <span className="min-w-0">
                    <span className="block text-[var(--ink)]">
                      {activityStatusSentence(item)}
                    </span>
                    {item.detail ? (
                      <span className="block truncate text-[10px] text-[var(--ink-muted)]">
                        {item.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {pendingPermission ? (
        <div className="mt-3 rounded-2xl bg-[var(--paper-strong)] px-4 py-3.5 shadow-[0_10px_30px_rgba(53,75,65,0.08)]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--paper-raised)] text-[var(--botanical)] shadow-sm">
              <svg
                aria-hidden
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3.75 5.25 6.5v4.75c0 4.18 2.77 7.73 6.75 9 3.98-1.27 6.75-4.82 6.75-9V6.5L12 3.75Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.5 12.1 11.2 14l3.6-4"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-[var(--ink-heading)]">
                  Permission required
                </p>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium capitalize tracking-wide text-[#936222]">
                  {pendingPermission.risk}
                </span>
              </div>
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
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2 pl-12">
            <button
              type="button"
              onClick={() => onPermissionDecision("once")}
              className="rounded-full bg-[var(--botanical)] px-4 py-2 text-xs font-medium text-white shadow-[0_4px_14px_rgba(32,91,69,0.18)] transition hover:bg-[var(--botanical-hover)]"
            >
              Allow once
            </button>
            {pendingPermission.allowSession ? (
              <button
                type="button"
                onClick={() => onPermissionDecision("always")}
                className="rounded-full bg-[var(--paper-raised)] px-4 py-2 text-xs font-medium text-[var(--botanical)] shadow-[0_2px_10px_rgba(53,75,65,0.08)] transition hover:bg-[var(--paper-bg)]"
              >
                Allow similar for session
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onPermissionDecision("reject")}
              className="rounded-full bg-red-500/[0.07] px-3.5 py-2 text-xs font-medium text-[#a45f56] transition hover:bg-red-500/[0.12]"
            >
              Deny
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
