"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAgencyAgentsClientCatalog } from "./agency-agents-client";

export type DelegationStatus = "running" | "thinking" | "done" | "failed";

export interface DelegationNode {
  subagentId: string;
  parentId?: string;
  depth?: number;
  goal?: string;
  personaSlug?: string;
  status: DelegationStatus;
  summary?: string;
  model?: string;
  startedAt: number;
  updatedAt: number;
}

export interface RosterPersonaMeta {
  slug: string;
  name: string;
  divisionSlug: string;
  divisionLabel: string;
  divisionIcon: string;
  divisionColor: string;
  emoji?: string;
  color?: string;
}

export interface AgencyDivision {
  slug: string;
  label: string;
  icon: string;
  color: string;
}

interface SubagentEventDetail {
  subagentId?: string;
  parentId?: string;
  depth?: number;
  goal?: string;
  personaSlug?: string;
  status?: DelegationStatus;
  summary?: string;
  model?: string;
}

const SUBAGENT_EVENT = "breadboard:subagent-event";

function isTerminal(status: DelegationStatus): boolean {
  return status === "done" || status === "failed";
}

/**
 * Folds `breadboard:subagent-event` window events (re-broadcast by the agent
 * session hook) into a live delegation tree for the "company" org-chart panel.
 * Auto-resets when a new delegation run begins after the previous one finished,
 * and enriches each node with roster metadata (division icon/color) from the
 * agency-agents catalog.
 */
export function useDelegationTree(): {
  nodes: DelegationNode[];
  personaMeta: Map<string, RosterPersonaMeta>;
  divisions: AgencyDivision[];
  rosterCount: number;
  catalogReady: boolean;
  activeCount: number;
  clear: () => void;
} {
  const [nodeMap, setNodeMap] = useState<Map<string, DelegationNode>>(
    () => new Map(),
  );
  const [personaMeta, setPersonaMeta] = useState<Map<string, RosterPersonaMeta>>(
    () => new Map(),
  );
  const [divisions, setDivisions] = useState<AgencyDivision[]>([]);
  const [rosterCount, setRosterCount] = useState(0);
  const [catalogReady, setCatalogReady] = useState(false);

  // Load the roster once so persona slugs can be mapped to division icon/color.
  useEffect(() => {
    let cancelled = false;
    loadAgencyAgentsClientCatalog()
      .then((data) => {
        if (cancelled || !data?.ok || !Array.isArray(data.agents)) return;
        const meta = new Map<string, RosterPersonaMeta>();
        for (const agent of data.agents) {
          const slug = agent.slug;
          meta.set(slug, {
            slug,
            name: String(agent.name ?? slug),
            divisionSlug: String(agent.division ?? ""),
            divisionLabel: String(agent.divisionLabel ?? ""),
            divisionIcon: String(agent.divisionIcon ?? "Bot"),
            divisionColor: String(agent.divisionColor ?? "#64748b"),
            emoji: typeof agent.emoji === "string" ? agent.emoji : undefined,
            color: typeof agent.color === "string" ? agent.color : undefined,
          });
        }
        setPersonaMeta(meta);
        setRosterCount(meta.size);
        setDivisions(Array.isArray(data.divisions) ? data.divisions : []);
        setCatalogReady(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SubagentEventDetail>).detail;
      const subagentId = detail?.subagentId;
      if (!subagentId) return;
      const status: DelegationStatus = detail.status ?? "running";
      const at = Date.now();
      setNodeMap((prev) => {
        const isNew = !prev.has(subagentId);
        const allTerminal =
          prev.size > 0 &&
          [...prev.values()].every((node) => isTerminal(node.status));
        // A fresh spawn after the previous run fully finished = a new run.
        const base =
          status === "running" && isNew && allTerminal
            ? new Map<string, DelegationNode>()
            : new Map(prev);
        const existing = base.get(subagentId);
        base.set(subagentId, {
          subagentId,
          parentId: detail.parentId ?? existing?.parentId,
          depth: detail.depth ?? existing?.depth,
          goal: detail.goal ?? existing?.goal,
          personaSlug: detail.personaSlug ?? existing?.personaSlug,
          status,
          summary: detail.summary ?? existing?.summary,
          model: detail.model ?? existing?.model,
          startedAt: existing?.startedAt ?? at,
          updatedAt: at,
        });
        return base;
      });
    };
    window.addEventListener(SUBAGENT_EVENT, handler);
    return () => window.removeEventListener(SUBAGENT_EVENT, handler);
  }, []);

  const clear = useCallback(() => setNodeMap(new Map()), []);

  const nodes = useMemo(
    () => [...nodeMap.values()].sort((a, b) => a.startedAt - b.startedAt),
    [nodeMap],
  );
  const activeCount = useMemo(
    () => nodes.filter((node) => !isTerminal(node.status)).length,
    [nodes],
  );

  return {
    nodes,
    personaMeta,
    divisions,
    rosterCount,
    catalogReady,
    activeCount,
    clear,
  };
}
