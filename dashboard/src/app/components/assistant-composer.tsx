'use client';

import type {
  ClipboardEvent,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  Ref,
} from 'react';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import UsageLimitsPopover from '@/app/components/usage-limits-popover';
import { CommandHub, type CommandHubHandle } from '@/app/components/openharness/command-hub';
import { splitLeadingCommandTokens } from '@/app/components/openharness/command-text';
import { useYoloMode } from '@/app/components/use-yolo-mode';
import type { CommandHubItem } from '@/lib/openharness/commands.ts';
import type { OpenHarnessSurface } from '@/lib/openharness/config.ts';
import { formatAssistantModelName } from '@/lib/ai-models';
import type { AssistantReasoningEffort } from '@/lib/assistant-reasoning';
import type { AgentRunState } from '@/app/components/openharness/use-agent-session';

export interface ComposerAttachment {
  name: string;
  type?: 'text' | 'image';
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaStyle?: CSSProperties;
  placeholder: string;
  disabled?: boolean;
  isSending?: boolean;
  canSubmit: boolean;
  model: string;
  models: string[];
  modelsLoading?: boolean;
  onLoadModels?: () => void;
  onModelChange: (model: string) => void;
  reasoningEffort: AssistantReasoningEffort;
  onReasoningEffortChange: (effort: AssistantReasoningEffort) => void;
  onAddDocuments?: () => void;
  isAddingDocuments?: boolean;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (index: number) => void;
  utilityActions?: ReactNode;
  statusMessage?: string;
  headerContent?: ReactNode;
  className?: string;
  compact?: boolean;
  capabilitySessionId?: string | number | null;
  capabilitySurface?: OpenHarnessSurface;
  runState?: AgentRunState;
  onQueueSteer?: (text: string) => void;
  onStop?: () => void;
  permissionPending?: boolean;
}

const EFFORT_OPTIONS: Array<{
  value: AssistantReasoningEffort;
  label: string;
  detail: string;
}> = [
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

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}

type ActiveAgencyAgent = {
  id: string;
  slug: string;
  name: string;
  divisionLabel: string;
  divisionColor?: string;
  emoji?: string;
};

export default function AssistantComposer({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  onPaste,
  textareaRef,
  textareaStyle,
  placeholder,
  disabled = false,
  isSending = false,
  canSubmit,
  model,
  models,
  modelsLoading = false,
  onLoadModels,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  onAddDocuments,
  isAddingDocuments = false,
  attachments = [],
  onRemoveAttachment,
  utilityActions,
  statusMessage,
  headerContent,
  className = '',
  compact = false,
  capabilitySessionId,
  capabilitySurface = 'dashboard_terminal',
  runState = 'idle',
  onQueueSteer,
  onStop,
  permissionPending = false,
}: Props) {
  const [showIntelligence, setShowIntelligence] = useState(false);
  const [showCommandHub, setShowCommandHub] = useState(false);
  const [activeAgencyAgent, setActiveAgencyAgent] = useState<ActiveAgencyAgent | null>(null);
  const [agencyAgentNotice, setAgencyAgentNotice] = useState<string | null>(null);
  const commandBackdropRef = useRef<HTMLDivElement | null>(null);
  const [yoloMode, setYoloMode] = useYoloMode();
  const commandHubRef = useRef<CommandHubHandle>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(textareaRef, () => internalTextareaRef.current as HTMLTextAreaElement);
  const selectedEffort =
    EFFORT_OPTIONS.find((option) => option.value === reasoningEffort) ??
    EFFORT_OPTIONS[2];
  const activeRun =
    runState === 'submitting' ||
    runState === 'connecting' ||
    runState === 'running' ||
    runState === 'waiting_for_permission' ||
    runState === 'steering' ||
    runState === 'stopping';
  const composerDisabled = disabled || runState === 'stopping';
  const canQueueSteer =
    activeRun &&
    canSubmit &&
    Boolean(onQueueSteer) &&
    runState !== 'steering' &&
    runState !== 'stopping';

  useEffect(() => {
    if (!capabilitySessionId || capabilitySurface === 'quartz_ai') {
      setActiveAgencyAgent(null);
      setAgencyAgentNotice(null);
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/openharness/sessions/${encodeURIComponent(String(capabilitySessionId))}/agency-agent`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as {
          activeAgent?: ActiveAgencyAgent | null;
          notice?: string | null;
        };
      })
      .then((payload) => {
        if (!payload) return;
        setActiveAgencyAgent(payload.activeAgent ?? null);
        setAgencyAgentNotice(payload.notice ?? null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAgencyAgentNotice('The active agent status could not be refreshed.');
        }
      });
    return () => controller.abort();
  }, [capabilitySessionId, capabilitySurface, runState]);

  async function clearAgencyAgent() {
    if (!capabilitySessionId) return;
    try {
      const response = await fetch(
        `/api/openharness/sessions/${encodeURIComponent(String(capabilitySessionId))}/agency-agent`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('clear_failed');
      setActiveAgencyAgent(null);
      setAgencyAgentNotice(null);
      window.setTimeout(() => internalTextareaRef.current?.focus(), 0);
    } catch {
      setAgencyAgentNotice('The active agent could not be cleared.');
    }
  }

  function toggleIntelligence() {
    const next = !showIntelligence;
    setShowIntelligence(next);
    if (next) onLoadModels?.();
  }

  function assignTextareaRef(node: HTMLTextAreaElement | null) {
    internalTextareaRef.current = node;
  }

  function queueSteer() {
    const text = value.trim();
    if (!text || !canQueueSteer) return;
    onQueueSteer?.(text);
    onChange('');
    window.setTimeout(() => internalTextareaRef.current?.focus(), 0);
  }

  function insertCommand(item: CommandHubItem) {
    // UI-TARS runtime agents live in the same Agents list as the Agency personas,
    // but they are executable runtimes rather than conversation personas: opening
    // one takes you to its browser workspace instead of inserting a persona token.
    if (item.id.startsWith('ui-tars:')) {
      const agentId = item.id.slice('ui-tars:'.length);
      window.location.assign(`/agents?agent=${encodeURIComponent(agentId)}`);
      return;
    }
    const node = internalTextareaRef.current;
    let start = 0;
    let end = 0;
    if (value === '/') {
      start = 0;
      end = 1;
    }
    const token = `/${item.token} `;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    window.setTimeout(() => {
      node?.focus();
      const cursor = value === '/' ? token.length : token.length + (node?.selectionStart ?? value.length);
      node?.setSelectionRange(cursor, cursor);
    }, 0);
  }

  return (
    <div className={className}>
      <div className="neu-composer relative rounded-[30px] p-2">
        {headerContent ? (
          <div className="mb-1 border-b border-[var(--line)] px-1 pb-1.5">
            {headerContent}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-2 pb-1.5 pt-1">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.name}-${index}`}
                className="neu-surface-subtle flex max-w-[220px] items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5 text-xs text-[var(--ink)]"
              >
                <svg className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                  {attachment.type === 'image' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 4.5h16.5v15H3.75z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 2.25H6.375A1.875 1.875 0 0 0 4.5 4.125v15.75c0 1.036.84 1.875 1.875 1.875h11.25c1.036 0 1.875-.84 1.875-1.875V7.5m-5.25-5.25L19.5 7.5m-5.25-5.25V7.5h5.25" />
                  )}
                </svg>
                <span className="truncate">{attachment.name}</span>
                {onRemoveAttachment ? (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(index)}
                    className="ml-0.5 shrink-0 rounded-full p-0.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {activeAgencyAgent ? (
          <div className="flex items-center px-2 pb-1.5 pt-0.5">
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--paper-surface)] px-2 py-1 text-[10px] text-[var(--ink-muted)]"
              title={`${activeAgencyAgent.name} · ${activeAgencyAgent.divisionLabel}`}
            >
              <span aria-hidden style={activeAgencyAgent.divisionColor ? { color: activeAgencyAgent.divisionColor } : undefined}>
                {activeAgencyAgent.emoji ?? '●'}
              </span>
              <span className="truncate">
                <span className="font-medium text-[var(--ink)]">{activeAgencyAgent.name}</span>
                <span className="hidden sm:inline"> · {activeAgencyAgent.divisionLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => void clearAgencyAgent()}
                className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                aria-label={`Clear ${activeAgencyAgent.name} agent`}
                title="Clear active agent"
              >
                <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" d="m3 3 6 6m0-6-6 6" />
                </svg>
              </button>
            </span>
          </div>
        ) : null}

        <div className="flex items-end gap-1.5">
          <CommandHub
            ref={commandHubRef}
            open={showCommandHub}
            onOpenChange={setShowCommandHub}
            onSelect={insertCommand}
            disabled={composerDisabled}
            compact={compact}
            sessionId={capabilitySessionId}
            surface={capabilitySurface}
            requestedOutcome={value}
          />

          {onAddDocuments ? (
            <button
              type="button"
              onClick={onAddDocuments}
              disabled={composerDisabled || isAddingDocuments}
              className={`neu-button-icon flex shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
              title="Add documents"
              aria-label="Add documents"
            >
              {isAddingDocuments ? (
                <Spinner />
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              )}
            </button>
          ) : null}

          {activeRun && permissionPending ? (
            <span
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#a86b3b] sm:flex"
              title="Permission decision required"
              aria-label="Permission decision required"
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75 5.25 6v5.25c0 4.14 2.83 7.98 6.75 9 3.92-1.02 6.75-4.86 6.75-9V6L12 3.75Z" />
                <path strokeLinecap="round" d="M12 8.25v4.5m0 3h.008" />
              </svg>
            </span>
          ) : null}

          {utilityActions ? <div className="flex shrink-0 items-center gap-1">{utilityActions}</div> : null}

          <div className={`relative flex min-w-0 flex-1 items-center ${compact ? 'min-h-9' : 'min-h-11'}`}>
            {(() => {
              const commandSplit = splitLeadingCommandTokens(value);
              return (
                <>
                  {/* The backdrop mirrors the textarea's metrics exactly (same
                      padding, size, leading, and weight) so the visible glyphs
                      line up with the transparent ones the caret is measured
                      against; it colors the command token blue and the
                      arguments in normal ink. */}
                  {commandSplit ? (
                    <div
                      ref={commandBackdropRef}
                      aria-hidden
                      className={`pointer-events-none absolute inset-x-0 top-1/2 max-h-40 -translate-y-1/2 select-none overflow-hidden whitespace-pre-wrap break-words px-1 py-0 ${compact ? 'min-h-5 text-sm leading-5' : 'min-h-6 text-[15px] leading-6'}`}
                    >
                      <span className="text-[#1e40af]">{commandSplit.command}</span>
                      <span className="text-[var(--ink)]">{commandSplit.rest}</span>
                      {'\u200b'}
                    </div>
                  ) : null}
                  <textarea
                    ref={assignTextareaRef}
                    value={value}
                    onChange={(event) => {
                      const next = event.target.value;
                      onChange(next);
                      if (next === '/') setShowCommandHub(true);
                    }}
                    onKeyDown={(event) => {
                      if (commandHubRef.current?.handleKeyDown(event)) return;
                      onKeyDown?.(event);
                      if (event.defaultPrevented) return;
                      if (
                        event.key !== 'Enter' ||
                        event.shiftKey ||
                        event.nativeEvent.isComposing
                      ) {
                        return;
                      }
                      event.preventDefault();
                      if (activeRun) {
                        queueSteer();
                        return;
                      }
                      if (!canSubmit || isSending || disabled) return;
                      onSubmit();
                    }}
                    onPaste={onPaste}
                    onScroll={(event) => {
                      if (commandBackdropRef.current) {
                        commandBackdropRef.current.scrollTop = event.currentTarget.scrollTop;
                      }
                    }}
                    rows={1}
                    placeholder={placeholder}
                    disabled={composerDisabled}
                    className={`block max-h-40 w-full resize-none overflow-y-auto bg-transparent px-1 py-0 outline-none placeholder:text-[var(--ink-muted)] disabled:opacity-50 ${commandSplit ? 'text-transparent caret-[var(--ink)]' : 'text-[var(--ink)]'} ${compact ? 'min-h-5 text-sm leading-5' : 'min-h-6 text-[15px] leading-6'}`}
                    style={textareaStyle}
                  />
                </>
              );
            })()}
          </div>

          <div className="relative shrink-0 self-end">
            <button
              type="button"
              onClick={() => {
                if (!activeRun) toggleIntelligence();
              }}
              className={`neu-button flex items-center gap-1.5 rounded-full bg-[var(--paper-strong)] text-[var(--ink)] transition hover:bg-[var(--paper-bg)] ${compact ? 'h-9 px-2.5 text-xs' : 'h-11 px-3.5 text-sm'}`}
              title={activeRun
                ? `${selectedEffort.label} reasoning (available when this response finishes)`
                : `${selectedEffort.label} reasoning · ${formatAssistantModelName(model)}`}
              aria-expanded={!activeRun && showIntelligence}
              aria-disabled={activeRun}
            >
              <span>{selectedEffort.label}</span>
              <svg className="h-3.5 w-3.5 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {showIntelligence && !activeRun ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setShowIntelligence(false)}
                  aria-label="Close intelligence menu"
                />
                <div className="neu-popover absolute bottom-full right-0 z-40 mb-2 w-64 rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm">
                  <div className="px-2.5 pb-1.5 pt-1 text-sm text-[var(--ink-muted)]">Intelligence</div>
                  {EFFORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onReasoningEffortChange(option.value);
                        setShowIntelligence(false);
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
                  <div className="max-h-48 overflow-y-auto">
                    {models.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          onModelChange(item);
                          setShowIntelligence(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${item === model ? 'neu-selected bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
                      >
                        <span className="truncate">{formatAssistantModelName(item)}</span>
                        {item === model ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>

                  <div className="my-1.5 border-t border-[var(--line)]" />
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
                        className={`neu-surface-raised absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${yoloMode ? 'translate-x-5' : 'translate-x-0'}`}
                      />
                    </span>
                  </button>

                  <div className="my-1.5 border-t border-[var(--line)]" />
                  <UsageLimitsPopover
                    buttonClassName="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition"
                    activeButtonClassName="bg-[var(--paper-surface)] text-[var(--botanical)]"
                    inactiveButtonClassName="text-[var(--ink)] hover:bg-[var(--paper-strong)]"
                    popoverClassName="absolute bottom-0 right-full z-50 mr-2 w-72 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-xs text-[var(--ink)] shadow-2xl"
                    light
                  />
                </div>
              </>
            ) : null}
          </div>

          {activeRun ? (
            <button
              type="button"
              onClick={onStop}
              disabled={runState === 'stopping'}
              className={`neu-button-accent flex shrink-0 items-center justify-center rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-wait disabled:opacity-55 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
              aria-label={runState === 'stopping' ? 'Stopping active run' : 'Stop active run'}
              title={runState === 'stopping' ? 'Stopping...' : 'Stop'}
            >
              {runState === 'stopping' ? <Spinner /> : <span className="h-3 w-3 rounded-[3px] bg-current" aria-hidden />}
            </button>
          ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || isSending || disabled}
            className={`neu-button-accent flex shrink-0 items-center justify-center rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)] ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
            aria-label="Send"
            title="Send"
          >
            {isSending ? (
              <Spinner />
            ) : (
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
              </svg>
            )}
          </button>
          )}
        </div>

        {statusMessage || agencyAgentNotice ? (
          <div className="flex min-h-7 items-center gap-3 px-3 pb-1 pt-1.5 text-[11px]">
            <p
              className="min-w-0 flex-1 text-[#8a6f00]"
              role="status"
              aria-live="polite"
            >
              {statusMessage ?? agencyAgentNotice}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
