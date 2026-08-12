"use client";

import { useMemo } from "react";
import {
  useDelegationTree,
  type DelegationNode,
  type DelegationStatus,
  type RosterPersonaMeta,
} from "@/lib/hermes/use-delegation-tree";

const PERSONA_TAG = /^\s*\[persona:\s*[a-z0-9-]+\]\s*/i;

function cleanGoal(goal?: string): string {
  return goal ? goal.replace(PERSONA_TAG, "").trim() : "";
}

function prettifySlug(slug?: string): string {
  if (!slug) return "Specialist";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_META: Record<DelegationStatus, { label: string; dot: string }> = {
  running: { label: "Working", dot: "#f59e0b" },
  thinking: { label: "Thinking", dot: "#3b82f6" },
  done: { label: "Done", dot: "#22c55e" },
  failed: { label: "Failed", dot: "#ef4444" },
};

function displayName(node: DelegationNode, meta?: RosterPersonaMeta): string {
  return meta?.name ?? prettifySlug(node.personaSlug) ?? "Specialist";
}

function initial(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

interface Group {
  label: string;
  color: string;
  nodes: Array<{ node: DelegationNode; meta?: RosterPersonaMeta }>;
}

export default function AgentOrgChart({
  orchestratorName = "Chief of Staff",
}: {
  orchestratorName?: string;
}) {
  const {
    nodes,
    personaMeta,
    divisions,
    rosterCount,
    catalogReady,
    activeCount,
  } = useDelegationTree();

  const groups = useMemo<Group[]>(() => {
    const byLabel = new Map<string, Group>();
    for (const node of nodes) {
      const meta = node.personaSlug
        ? personaMeta.get(node.personaSlug)
        : undefined;
      const label = meta?.divisionLabel || "Delegated";
      const color = meta?.color || meta?.divisionColor || "#64748b";
      const group = byLabel.get(label) ?? { label, color, nodes: [] };
      group.nodes.push({ node, meta });
      byLabel.set(label, group);
    }
    return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes, personaMeta]);

  const divisionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const meta of personaMeta.values()) {
      counts.set(meta.divisionLabel, (counts.get(meta.divisionLabel) ?? 0) + 1);
    }
    return counts;
  }, [personaMeta]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-[var(--ink-heading)]">The Company</p>
        <span className="text-[11px] text-[var(--ink-muted)]">
          {activeCount > 0
            ? `${activeCount} working`
            : catalogReady
              ? `${rosterCount} specialists`
              : "—"}
        </span>
      </div>

      {/* Orchestrator — the front door */}
      <div
        className="neu-surface-raised flex items-center gap-2.5 rounded-xl border border-[var(--line)] px-3 py-2"
        style={{ borderLeft: "3px solid #6366F1" }}
      >
        <span className="text-lg leading-none">🧭</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[var(--ink-heading)]">
            {orchestratorName}
          </p>
          <p className="truncate text-[11px] text-[var(--ink-muted)]">
            {activeCount > 0 ? "Coordinating the team…" : "Front door · routes & delegates"}
          </p>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--ink-muted)]">
            No specialists deployed yet. Ask for something specialized or multi-part
            and the Chief of Staff will bring in the right people.
          </p>
          {catalogReady && divisions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {divisions.map((division) => (
                <span
                  key={division.slug}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]"
                  title={`${divisionCounts.get(division.label) ?? 0} specialists`}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: division.color }}
                  />
                  {division.label}
                  <span className="opacity-70">
                    {divisionCounts.get(division.label) ?? 0}
                  </span>
                </span>
              ))}
            </div>
          ) : !catalogReady ? (
            <p className="text-[11px] text-[var(--ink-muted)]">Loading roster…</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.label} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                  {group.label}
                </span>
              </div>
              <div className="space-y-1.5 border-l border-[var(--line)] pl-2.5">
                {group.nodes.map(({ node, meta }) => {
                  const status = STATUS_META[node.status];
                  const name = displayName(node, meta);
                  const goal = cleanGoal(node.goal);
                  return (
                    <div
                      key={node.subagentId}
                      className="rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{ backgroundColor: group.color }}
                        >
                          {meta?.emoji ?? initial(name)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink-heading)]">
                          {name}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
                          <span
                            aria-hidden
                            className={`h-1.5 w-1.5 rounded-full ${node.status === "running" || node.status === "thinking" ? "animate-pulse" : ""}`}
                            style={{ backgroundColor: status.dot }}
                          />
                          {status.label}
                        </span>
                      </div>
                      {goal ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--ink-muted)]">
                          {goal}
                        </p>
                      ) : null}
                      {node.status === "done" && node.summary ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--ink)]">
                          {node.summary}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
