"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import AssistantResponseMeta from "@/app/components/assistant-response-meta";
import { assistantResponseElapsedMs } from "@/lib/assistant-activity-timing";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
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
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  /** Overrides Thinking for terminal states such as an interrupted turn. */
  stateLabel?: string;
  stateFailed?: boolean;
  stateAction?: ReactNode;
}

export default function ActivityPanel({
  activities,
  connection,
  pendingPermission,
  usage,
  responseDurationMs,
  onPermissionDecision,
  stateLabel,
  stateFailed = false,
  stateAction,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const active =
    connection === "connecting" ||
    connection === "streaming" ||
    connection === "waiting";
  const artifactState = activities.findLast(
    (item) =>
      item.kind === "artifact" &&
      (item.status === "running" || item.status === "failed"),
  );
  const effectiveLabel = stateLabel ?? artifactState?.label ?? "Thinking";
  const effectiveFailed = stateFailed || artifactState?.status === "failed";
  const responseActive = (active || artifactState?.status === "running") && !effectiveFailed;
  const elapsedMs = useMemo(
    () =>
      assistantResponseElapsedMs({
        activities,
        active: responseActive,
        now,
        reportedDurationMs: responseDurationMs ?? usage?.responseDurationMs,
      }),
    [activities, now, responseActive, responseDurationMs, usage?.responseDurationMs],
  );

  useEffect(() => {
    const transitionTick = window.setTimeout(() => setNow(Date.now()), 0);
    if (!responseActive) return () => window.clearTimeout(transitionTick);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(transitionTick);
      window.clearInterval(timer);
    };
  }, [responseActive]);

  return (
    <section className="text-[var(--ink)]">
      <AssistantResponseMeta
        active={responseActive}
        shimmer={responseActive && !pendingPermission}
        failed={effectiveFailed}
        label={effectiveLabel}
        usage={usage}
        responseDurationMs={elapsedMs ?? undefined}
        action={stateAction}
      />

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
