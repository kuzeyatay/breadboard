"use client";

// The Terminal's Intelligence menu, in the Organization composer: the same
// effort ladder and model list, and the same shared selection, so a model
// picked here is the model the Terminal opens with and the other way round.
// Agents in the room that have no model of their own answer with it.
//
// ponytail: effort and model only. The Terminal's usage and settings panels
// live inside its composer; lift them out if they are wanted here too.

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { useAssistantIntelligence, type AssistantIntelligenceScope } from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import { formatAssistantModelName, groupAssistantModels } from "@/lib/ai-models";

export const ORGANIZATION_INTELLIGENCE: AssistantIntelligenceScope = { scope: "organization", shared: true };

export function ComposerIntelligence({ disabled = false }: { disabled?: boolean }) {
  const { model, setModel, reasoningEffort, setReasoningEffort, intelligenceModes } = useAssistantIntelligence(ORGANIZATION_INTELLIGENCE);
  const { models, modelsLoading, loadModels } = useAssistantModels();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const effort = intelligenceModes.find((mode) => mode.value === reasoningEffort);
  const close = () => { setOpen(false); button.current?.focus(); };
  const row = "flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)]";

  return (
    <div className="relative shrink-0" onKeyDown={(event) => { if (open && event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        data-testid="composer-intelligence"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Model and reasoning for agents in this room"
        onClick={() => { if (!open) loadModels(); setOpen(!open); }}
        className="neu-button flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full bg-[var(--paper-strong)] px-3 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-bg)] disabled:opacity-50"
      >
        <span className="truncate font-medium">{model ? formatAssistantModelName(model) : "Model"}</span>
        {effort ? <span className="shrink-0 text-[var(--ink-muted)]">{effort.label}</span> : null}
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
      </button>

      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" aria-label="Close intelligence menu" onClick={close} />
          <div
            role="dialog"
            aria-label="Intelligence"
            className="neu-popover absolute bottom-full right-0 z-40 mb-2 flex max-h-[min(34rem,calc(100vh-10rem))] w-64 flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm text-[var(--ink)]"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="px-2.5 pb-1.5 pt-1 text-sm text-[var(--ink-muted)]">Intelligence</div>
              {intelligenceModes.map((mode) => (
                <button key={mode.value} type="button" aria-pressed={mode.value === reasoningEffort} onClick={() => setReasoningEffort(mode.value)} className={row}>
                  <span>
                    <span className="block">{mode.label}</span>
                    <span className="block text-[11px] text-[var(--ink-muted)]">{mode.detail}</span>
                  </span>
                  {mode.value === reasoningEffort ? <Check aria-hidden className="h-4 w-4 shrink-0" /> : null}
                </button>
              ))}
              <div className="my-1.5 border-t border-[var(--line)]" />
              <div className="flex items-center justify-between px-2.5 pb-1 pt-1 text-xs text-[var(--ink-muted)]">
                <span>Model</span>
                {modelsLoading ? <span>Loading</span> : null}
              </div>
              {groupAssistantModels(models).map((group) => (
                <div key={group.vendorId}>
                  <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-[var(--ink-muted)]">{group.vendorLabel}</div>
                  {group.models.map((item) => (
                    <button key={item} type="button" aria-pressed={item === model} onClick={() => setModel(item)} className={row}>
                      <span className="truncate">{formatAssistantModelName(item)}</span>
                      {item === model ? <Check aria-hidden className="h-4 w-4 shrink-0" /> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
