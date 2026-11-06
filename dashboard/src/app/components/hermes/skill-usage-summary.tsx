"use client";

import type { CapabilitySummary } from "@/lib/hermes/capability-usage";
import { skillUseState } from "@/lib/hermes/skill-presentation";

const LABELS = { used: "Skills used", loaded: "Skill instructions loaded", failed: "Skill attempts failed", selected: "Selected · use not recorded" } as const;

export default function SkillUsageSummary({ capabilities, onInspect }: {
  capabilities?: CapabilitySummary;
  onInspect?: () => void;
}) {
  const skills = capabilities?.used.filter(use => use.kind === "skill") ?? [];
  if (!skills.length) return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-[var(--ink-muted)]" aria-label="Skills for this response" data-selection-exclude>
      {(["used", "loaded", "failed", "selected"] as const).map(state => {
        const group = skills.filter(use => skillUseState(use) === state);
        if (!group.length) return null;
        return <div key={state} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>{LABELS[state]}:</span>
          {group.map(use => {
            const origin = use.selection === "requested" ? "Selected by you" : use.selection === "automatic" ? "Selected automatically" : "Chosen by the assistant";
            const evidence = use.actions?.includes("opened") ? "Instructions opened for this response."
              : state === "loaded" ? "Instructions supplied to this response."
              : state === "selected" ? "No usage was recorded for this response."
              : state === "failed" ? "All recorded calls failed." : "Recorded tool use.";
            const title = `${origin}. ${evidence}${use.reason ? ` ${use.reason}` : ""}`;
            return onInspect ? <button key={use.id} type="button" title={title} onClick={event => { event.stopPropagation(); onInspect(); }}
              className="text-[var(--ink)] underline decoration-[var(--line)] underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">{use.label}</button>
              : <span key={use.id} title={title} className="text-[var(--ink)]">{use.label}</span>;
          })}
        </div>;
      })}
    </div>
  );
}
