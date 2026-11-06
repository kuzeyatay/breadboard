"use client";

import { useEffect, useState } from "react";
import type { CommandHubItem } from "@/lib/hermes/commands";
import type { HermesSurface } from "@/lib/hermes/config";
import { commandResponseUrl, loadCachedCommandResponse, peekCachedCommandResponse } from "@/lib/hermes/command-client-cache";
import { removeSkillFromDraft, selectedSkillsInDraft } from "@/lib/hermes/skill-presentation";

type SkillHint = Pick<CommandHubItem, "id" | "token" | "name" | "slug">;
type Catalog = { groups?: { skills?: SkillHint[] } };

export default function SelectedSkills({ value, onChange, sessionId, surface, hints = [], disabled = false, onRemove }: {
  value: string;
  onChange: (value: string) => void;
  sessionId?: string | number | null;
  surface: HermesSurface;
  hints?: SkillHint[];
  disabled?: boolean;
  onRemove?: () => void;
}) {
  const url = commandResponseUrl({ surface, sessionId });
  const [catalog, setCatalog] = useState<{ url: string; skills: SkillHint[] } | null>(null);
  const hasSelectors = /^\s*\/[a-z0-9]/i.test(value);
  useEffect(() => {
    if (!hasSelectors || surface === "quartz_ai") return;
    let cancelled = false;
    void loadCachedCommandResponse<Catalog>(url).then(result => {
      if (!cancelled) setCatalog({ url, skills: result.groups?.skills ?? [] });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [hasSelectors, url, surface]);
  const skills = catalog?.url === url ? catalog.skills : peekCachedCommandResponse<Catalog>(url)?.groups?.skills ?? [];
  const selected = selectedSkillsInDraft(value, [...skills, ...hints]);
  if (!selected.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1 pt-2 text-xs" aria-label="Selected skills">
      <span className="text-[var(--ink-muted)]">Selected for this message</span>
      {selected.map(skill => (
        <button key={skill.id} type="button" disabled={disabled}
          onClick={() => { onChange(removeSkillFromDraft(value, skill)); onRemove?.(); }}
          title={`${skill.command} · Remove from this message`}
          aria-label={`Remove ${skill.name} skill`}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1 text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-50">
          <span className="truncate">{skill.name}</span><span aria-hidden>×</span>
        </button>
      ))}
    </div>
  );
}
