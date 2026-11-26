"use client";

// The Terminal's Intelligence menu, in the Organization composer: the same
// component, so it offers exactly the same choices — effort, every model with
// search, the composer switches, usage and Settings — and the same shared
// selection, so a model picked here is the model the Terminal opens with and
// the other way round. Agents in the room that have no model of their own
// answer with it.

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { SettingsTab } from "@/app/components/settings-dialog";
import {
  AssistantIntelligenceMenu,
  FALLBACK_EFFORT_OPTIONS,
  IntelligencePopover,
  type IntelligencePanel,
} from "@/app/components/assistant-intelligence-menu";
import { useAssistantIntelligence, type AssistantIntelligenceScope } from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import { formatAssistantModelName } from "@/lib/ai-models";

export const ORGANIZATION_INTELLIGENCE: AssistantIntelligenceScope = { scope: "organization", shared: true };

export function ComposerIntelligence({ disabled = false }: { disabled?: boolean }) {
  const { model, setModel, reasoningEffort, setReasoningEffort, intelligenceModes } = useAssistantIntelligence(ORGANIZATION_INTELLIGENCE);
  const { models, modelsLoading, loadModels } = useAssistantModels();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<IntelligencePanel>(null);
  const [settingsInitialTab] = useState<SettingsTab>("account");
  const button = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const effortOptions = intelligenceModes.length ? intelligenceModes : FALLBACK_EFFORT_OPTIONS;
  const effort = effortOptions.find((mode) => mode.value === reasoningEffort);
  const close = () => { setOpen(false); setPanel(null); button.current?.focus(); };

  return (
    <div className="relative shrink-0" onKeyDown={(event) => { if (open && event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        data-testid="composer-intelligence"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${effort?.label ?? "Reasoning"} reasoning · ${model ? formatAssistantModelName(model) : "Model"}`}
        onClick={() => { if (open) { close(); return; } loadModels(); setOpen(true); }}
        className="neu-button flex h-9 items-center gap-1.5 rounded-full bg-[var(--paper-strong)] px-2.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-bg)] disabled:opacity-50"
      >
        {/* Like the Terminal: the effort on the button, the model inside the menu. */}
        <span>{effort?.label ?? "Reasoning"}</span>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
      </button>

      {open ? (
        <IntelligencePopover viewportBounded={false} anchorRef={button} onClose={close} align="right">
          <AssistantIntelligenceMenu
            effortOptions={effortOptions}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={setReasoningEffort}
            model={model}
            onModelChange={setModel}
            models={models}
            modelsLoading={modelsLoading}
            viewportBounded={false}
            panel={panel}
            onPanelChange={setPanel}
            settingsInitialTab={settingsInitialTab}
            settingsButtonRef={settingsButton}
          />
        </IntelligencePopover>
      ) : null}
    </div>
  );
}
