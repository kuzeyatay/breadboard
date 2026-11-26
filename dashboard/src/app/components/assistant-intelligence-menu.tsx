"use client";

// The Intelligence menu: reasoning effort, the model list, the composer
// switches, usage and Settings. One component, so the Terminal and the
// Organization composer offer exactly the same choices; the switches and the
// model are shared stores, so a choice made in one is the choice in the other.

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import SettingsDialog, { type SettingsTab } from '@/app/components/settings-dialog';
import UsageLimitsPopover from '@/app/components/usage-limits-popover';
import ViewportPopover from '@/app/components/viewport-popover';
import { useDirectMode } from '@/app/components/use-direct-mode';
import { usePersonalize } from '@/app/components/use-personalize';
import { useHumanizerMode } from '@/app/components/use-humanizer-mode';
import { useYoloMode } from '@/app/components/use-yolo-mode';
import { useAgentMode, useSuperAgent } from '@/app/components/use-agent-mode';
import { formatAssistantModelName, groupAssistantModels } from '@/lib/ai-models';
import type { IntelligenceMode } from '@/lib/intelligence-modes';
import type { AssistantReasoningEffort } from '@/lib/assistant-reasoning';
import { preloadSettingsOverview } from '@/lib/settings-client-cache';

export const FALLBACK_EFFORT_OPTIONS: IntelligenceMode[] = [
  { value: 'low', label: 'Light', detail: 'Quick, light reasoning' },
  { value: 'medium', label: 'Medium', detail: 'Balanced reasoning' },
  { value: 'high', label: 'High', detail: 'Deeper thinking' },
  { value: 'xhigh', label: 'Extra high', detail: 'Extended thinking' },
  { value: 'max', label: 'Ultra', detail: 'Maximum reasoning depth' },
];

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

export type IntelligencePanel = 'usage' | 'settings' | null;

export function IntelligencePopover({
  viewportBounded,
  anchorRef,
  onClose,
  children,
  align = 'left',
}: {
  viewportBounded: boolean;
  /** Which edge of the button the menu lines up with: the Terminal's sits at the left, the Organization's at the right. */
  align?: 'left' | 'right';
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  if (viewportBounded) return (
    <ViewportPopover
      anchorRef={anchorRef}
      ariaLabel="Intelligence"
      role="dialog"
      onClose={onClose}
      maxHeight={640}
      className="neu-popover fixed z-[100] flex w-64 flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm"
    >
      {children}
    </ViewportPopover>
  );

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 cursor-default"
        onClick={onClose}
        aria-label="Close intelligence menu"
      />
      <div
        role="dialog"
        aria-label="Intelligence"
        className={`neu-popover absolute bottom-full ${align === 'right' ? 'right-0' : 'left-0'} z-40 mb-2 flex max-h-[min(40rem,calc(100vh-6rem))] w-64 flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm`}
      >
        {children}
      </div>
    </>
  );
}

/** Everything inside the Intelligence popover. */
export function AssistantIntelligenceMenu({
  effortOptions,
  reasoningEffort,
  onReasoningEffortChange,
  model,
  onModelChange,
  models,
  modelsLoading,
  viewportBounded,
  panel,
  onPanelChange,
  settingsInitialTab,
  settingsButtonRef,
}: {
  effortOptions: IntelligenceMode[];
  reasoningEffort: AssistantReasoningEffort;
  onReasoningEffortChange: (value: AssistantReasoningEffort) => void;
  model: string;
  onModelChange: (model: string) => void;
  models: readonly string[];
  modelsLoading: boolean;
  viewportBounded: boolean;
  /** Which side panel is open; the owner controls it so Settings can be opened from elsewhere. */
  panel: IntelligencePanel;
  onPanelChange: (panel: IntelligencePanel) => void;
  settingsInitialTab: SettingsTab;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const [modelSearch, setModelSearch] = useState('');
  const modelListRef = useRef<HTMLDivElement>(null);
  const filteredModelGroups = useMemo(() => {
    const terms = modelSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return groupAssistantModels([...models])
      .map((group) => ({
        ...group,
        models: group.models.filter((id) => {
          const text = `${group.vendorLabel} ${formatAssistantModelName(id)} ${id}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        }),
      }))
      .filter((group) => group.models.length > 0);
  }, [models, modelSearch]);
  // Settings mounts on first use and then stays, so reopening it is instant.
  const [settingsMounted, setSettingsMounted] = useState(panel === 'settings');
  if (panel === 'settings' && !settingsMounted) setSettingsMounted(true);
  const [personalize, setPersonalize] = usePersonalize();
  const [humanizerEnabled, setHumanizerEnabled] = useHumanizerMode();
  const [directMode, setDirectMode] = useDirectMode();
  const [yoloMode, setYoloMode] = useYoloMode();
  const [agentMode, setAgentMode] = useAgentMode();
  const [superAgent, setSuperAgent] = useSuperAgent();

  return (
    <>
      <div className={`min-h-0 flex-1 overflow-y-auto${viewportBounded ? ' overscroll-contain' : ''}`}>
        <div className="px-2.5 pb-1.5 pt-1 text-sm text-[var(--ink-muted)]">Intelligence</div>
        {effortOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onReasoningEffortChange(option.value);
            }}
            className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${option.value === reasoningEffort ? 'neu-selected bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
          >
            <span>
              <span className="block">{option.label}</span>
              <span className="block text-[11px] text-[var(--ink-muted)]">{option.detail}</span>
            </span>
            {option.value === reasoningEffort ? <CheckIcon /> : null}
          </button>
        ))}

        <div className="my-1.5 border-t border-[var(--line)]" />
        <div className="flex items-center justify-between px-2.5 pb-1 pt-1 text-xs text-[var(--ink-muted)]">
          <span>Model</span>
          {modelsLoading ? <span>Loading…</span> : null}
        </div>
        <div className="relative mx-2.5 mb-2 mt-1">
          <svg aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path strokeLinecap="round" d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="search"
            aria-label="Search models"
            placeholder="Search models…"
            value={modelSearch}
            onChange={(event) => {
              setModelSearch(event.target.value);
              if (modelListRef.current) modelListRef.current.scrollTop = 0;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] py-1.5 pl-8 pr-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink-muted)]"
          />
        </div>
        <div ref={modelListRef} role="group" aria-label="Models" className="max-h-48 overflow-y-auto overscroll-contain">
          {filteredModelGroups.map((group) => (
            <div key={group.vendorId}>
              <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                <span className="underline decoration-[var(--line-strong)] underline-offset-4">
                  {group.vendorLabel}
                </span>
              </div>
              {group.models.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    onModelChange(item);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${item === model ? 'neu-selected bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
                >
                  <span className="truncate">{formatAssistantModelName(item)}</span>
                  {item === model ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
          ))}
          {filteredModelGroups.length === 0 && !modelsLoading ? (
            <p role="status" className="px-2.5 py-2 text-xs text-[var(--ink-muted)]">No models found.</p>
          ) : null}
        </div>

        <div className="my-1.5 border-t border-[var(--line)]" />
        {/*
          Above Personalize. Turned on, this is a standing
          instruction rather than a per-message choice: every
          finished answer, every Markdown artifact and every garden
          note is offered to the local rewriter, and takes the
          rewrite when the preservation gates pass it. The model's
          own words are always kept as the first version, so the
          arrows under an answer switch back to them, and the
          per-answer "Rewrite naturally" action retries the turn as
          a new branch and humanizes that new answer.
        */}
        <button
          type="button"
          role="switch"
          aria-checked={humanizerEnabled}
          onClick={() => setHumanizerEnabled(!humanizerEnabled)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
        >
          <span className="min-w-0">
            <span className="block">Rewrite naturally</span>
            <span className="block text-[11px] text-[var(--ink-muted)]">
              {humanizerEnabled
                ? 'Answers, artifacts and notes are rewritten locally'
                : "Off; answers are left as written"}
            </span>
          </span>
          <span
            aria-hidden
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${humanizerEnabled ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform duration-200 ${humanizerEnabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={personalize}
          onClick={() => setPersonalize(!personalize)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
        >
          <span className="min-w-0">
            <span className="block">Personalize</span>
            <span className="block text-[11px] text-[var(--ink-muted)]">
              {personalize
                ? 'Answers use what Breadboard knows about you'
                : 'General answers, written for anyone'}
            </span>
          </span>
          <span
            aria-hidden
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${personalize ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform duration-200 ${personalize ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={directMode}
          onClick={() => setDirectMode(!directMode)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
        >
          <span className="min-w-0">
            <span className="block">Concise</span>
            <span className="block text-[11px] text-[var(--ink-muted)]">
              Concise answers; next actions only when useful
            </span>
          </span>
          <span
            aria-hidden
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${directMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform duration-200 ${directMode ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={yoloMode}
          onClick={() => setYoloMode(!yoloMode)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
        >
          <span className="min-w-0">
            <span className="block">YOLO mode</span>
            <span className="block text-[11px] text-[var(--ink-muted)]">
              Bypass permission prompts
            </span>
          </span>
          <span
            aria-hidden
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${yoloMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform duration-200 ${yoloMode ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={agentMode}
          onClick={() => setAgentMode(!agentMode)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
        >
          <span className="min-w-0">
            <span className="block">Agent mode</span>
            <span className="block text-[11px] text-[var(--ink-muted)]">
              {agentMode
                ? "Use tools to complete tasks"
                : "Reply without using tools"}
            </span>
          </span>
          <span
            aria-hidden
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${agentMode ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform duration-200 ${agentMode ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={superAgent}
          onClick={() => setSuperAgent(!superAgent)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
        >
          <span className="min-w-0">
            <span className="block">Super agent</span>
            <span className="block text-[11px] text-[var(--ink-muted)]">
              Every skill, workflow, connection and specialist
            </span>
          </span>
          <span
            aria-hidden
            className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${superAgent ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform duration-200 ${superAgent ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </button>
      </div>

      <div className="shrink-0">
        <div className="my-1.5 border-t border-[var(--line)]" />
        <UsageLimitsPopover
          open={panel === 'usage'}
          onOpenChange={(open) => onPanelChange(open ? 'usage' : null)}
          showBackdrop={false}
          viewportBounded={viewportBounded}
          activeModel={model}
          buttonClassName="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition"
          activeButtonClassName="bg-[var(--paper-surface)] text-[var(--botanical)]"
          inactiveButtonClassName="text-[var(--ink)] hover:bg-[var(--paper-strong)]"
          popoverClassName={viewportBounded
            ? "neu-popover fixed z-[110] w-72 overflow-y-auto overscroll-contain rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-xs text-[var(--ink)] shadow-2xl"
            : "absolute bottom-0 right-full z-50 mr-2 w-72 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-xs text-[var(--ink)] shadow-2xl"}
          light
        />

        <button
          type="button"
          ref={settingsButtonRef}
          onPointerEnter={() => void preloadSettingsOverview()}
          onClick={() => {
                                    onPanelChange(panel === 'settings' ? null : 'settings');
          }}
          aria-expanded={panel === 'settings'}
          className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${panel === 'settings' ? 'bg-[var(--paper-surface)] text-[var(--botanical)]' : 'text-[var(--ink)] hover:bg-[var(--paper-strong)]'}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.375.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247c.275.476.17 1.081-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.752.43.992l1.004.827c.43.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a7.03 7.03 0 0 1 0-.255c.007-.379-.138-.752-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Settings
        </button>
        {settingsMounted ? (
          <SettingsDialog
            key={settingsInitialTab}
            presentation="popover"
            anchorRef={viewportBounded ? settingsButtonRef : undefined}
            open={panel === 'settings'}
            initialTab={settingsInitialTab}
            onClose={() => onPanelChange(null)}
          />
        ) : null}
      </div>
    </>
  );
}
