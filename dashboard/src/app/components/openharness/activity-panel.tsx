"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActivityItem, ConnectionState, PermissionPrompt } from "./use-agent-session";

interface Props {
  activities: ActivityItem[];
  connection: ConnectionState;
  pendingPermission: PermissionPrompt | null;
  onAbort: () => void;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
}

function statusGlyph(status: ActivityItem["status"]): string {
  if (status === "completed") return "✓";
  if (status === "failed" || status === "denied") return "×";
  if (status === "cancelled") return "■";
  if (status === "permission_required") return "!";
  return "•";
}

export default function ActivityPanel({
  activities,
  connection,
  pendingPermission,
  onAbort,
  onPermissionDecision,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const active = connection === "connecting" || connection === "streaming" || connection === "waiting";
  const startedAt = activities[0]?.startedAt;
  const completedAt = [...activities].reverse().find((item) => item.completedAt)?.completedAt;
  const elapsed = useMemo(() => {
    if (!startedAt || !completedAt) return null;
    const value = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return Number.isFinite(value) ? Math.max(0, Math.round(value / 100) / 10) : null;
  }, [completedAt, startedAt]);

  useEffect(() => {
    if (active || pendingPermission) return;
    if (!activities.length) return;
    const timer = window.setTimeout(() => setExpanded(false), 900);
    return () => window.clearTimeout(timer);
  }, [active, activities.length, pendingPermission]);

  if (!activities.length) return null;
  if (!expanded && !active && !pendingPermission) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
      >
        View activity
      </button>
    );
  }

  return (
    <section className="my-1 text-[var(--ink)]">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex items-center gap-1.5 py-1 text-xs text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          aria-expanded={expanded}
        >
          <span className={active && !pendingPermission ? "thinking-shimmer" : ""}>
            {pendingPermission
              ? "Permission required"
              : active
                ? "Thinking"
                : connection === "error"
                  ? "Stopped with an error"
                  : `Completed${elapsed === null ? "" : ` in ${elapsed}s`}`}
          </span>
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
        <ol className="mt-1 space-y-1.5 pl-0.5">
          {activities.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs">
              <span aria-hidden className="w-3 shrink-0 text-center text-[var(--ink-muted)]">{statusGlyph(item.status)}</span>
              <span className="min-w-0">
                <span className="block text-[var(--ink)]">{item.label}</span>
                {item.detail ? <span className="block truncate text-[10px] text-[var(--ink-muted)]">{item.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {pendingPermission ? (
        <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-100/30 p-3">
          <p className="text-xs font-semibold text-amber-900">Permission required · {pendingPermission.risk}</p>
          <p className="mt-1 text-xs text-amber-950/80">{pendingPermission.description}</p>
          {pendingPermission.command ? (
            <code className="mt-2 block overflow-x-auto rounded bg-black/5 px-2 py-1 text-[10px]">{pendingPermission.command}</code>
          ) : null}
          {pendingPermission.affectedPaths.length ? (
            <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-amber-950/75">
              {pendingPermission.affectedPaths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onPermissionDecision("once")} className="rounded-md bg-emerald-800 px-2.5 py-1 text-xs text-white">
              Allow once
            </button>
            {pendingPermission.allowSession ? (
              <button type="button" onClick={() => onPermissionDecision("always")} className="rounded-md border border-emerald-800 px-2.5 py-1 text-xs text-emerald-900">
                Allow similar for session
              </button>
            ) : null}
            <button type="button" onClick={() => onPermissionDecision("reject")} className="rounded-md border border-red-800 px-2.5 py-1 text-xs text-red-900">
              Deny
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
