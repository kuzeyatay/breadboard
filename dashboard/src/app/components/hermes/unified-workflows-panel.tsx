"use client";

import type { CommandHubItem } from "@/lib/hermes/commands.ts";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import { UNIFIED_WORKFLOWS, unifiedWorkflowAgents } from "@/lib/workflows/unified-catalog.ts";

export function UnifiedWorkflowsPanel({ query, surface, onSelect }: {
  query: string;
  surface: HermesSurface;
  onSelect: (item: CommandHubItem) => void;
}) {
  if (surface === "quartz_ai") return null;
  const search = query.trim().toLowerCase();
  const workflows = UNIFIED_WORKFLOWS.filter(workflow => [
    "Master Agents", workflow.name, workflow.description, ...workflow.modes.map(mode => mode.name),
    ...unifiedWorkflowAgents(workflow.id).map(agent => agent.name),
  ].some(value => value.toLowerCase().includes(search)));
  if (!workflows.length) return null;
  function choose(workflow: typeof UNIFIED_WORKFLOWS[number], modeId?: string) {
    const mode = workflow.modes.find(item => item.id === modeId);
    const token = `${workflow.command.slice(1)}${mode ? `:${mode.id}` : ""}`;
    onSelect({ id: `unified-workflow:${workflow.id}${mode ? `:${mode.id}` : ""}`,
      kind: "agent", slug: token, token, name: mode ? `${workflow.name}: ${mode.name}` : workflow.name,
      description: mode?.description ?? workflow.description, source: "Master Agents",
      installed: true, enabled: true, healthy: true });
  }
  return <section aria-label="Master Agents" className="mb-5">
    <h3 className="px-2 text-sm font-medium text-[var(--ink-heading)]">Master Agents</h3>
    <p className="mb-3 mt-1 px-2 text-xs text-[var(--ink-muted)]">Describe your task and let a Master Agent choose the specialists, or select a mode for more control.</p>
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
      {workflows.map(workflow => <div key={workflow.id} className="rounded-xl border border-[var(--line)] bg-[var(--paper-surface)]">
        <button type="button" onClick={() => choose(workflow)} aria-label={`Use ${workflow.name} Master Agent`}
          className="w-full rounded-xl p-3 text-left hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
          <span className="block text-sm font-semibold text-[var(--ink-heading)]">{workflow.name}</span>
          <span className="mt-1 block text-xs text-[var(--ink)]">{workflow.description}</span>
        </button>
        <details className="border-t border-[var(--line)] text-xs">
          <summary className="cursor-pointer px-3 py-2 text-[var(--ink-muted)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">Explore {workflow.name.toLowerCase()} modes</summary>
          <div className="px-1 pb-1">
            {workflow.modes.filter(mode => unifiedWorkflowAgents(workflow.id, { modeId: mode.id, surface }).length > 0).map(mode =>
              <button key={mode.id} type="button" onClick={() => choose(workflow, mode.id)}
                className="block w-full rounded-lg px-2 py-2 text-left hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
                <span className="block font-medium text-[var(--ink)]">{mode.name}</span>
                <span className="mt-0.5 block text-[var(--ink-muted)]">{mode.description}</span>
              </button>)}
          </div>
        </details>
      </div>)}
    </div>
  </section>;
}
