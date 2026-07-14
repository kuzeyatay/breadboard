'use client';

import type {
  ClipboardEvent,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  Ref,
} from 'react';
import { useEffect, useState } from 'react';
import { formatAssistantModelName } from '@/lib/ai-models';
import type { AssistantReasoningEffort } from '@/lib/assistant-reasoning';
import { formatResponseDuration, formatTokenCount, type ChatTokenUsageSummary } from '@/lib/chat-token-usage';

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
  tokenUsage?: ChatTokenUsageSummary;
  tokenUsagePending?: boolean;
  className?: string;
  compact?: boolean;
}

const EFFORT_OPTIONS: Array<{
  value: AssistantReasoningEffort;
  label: string;
  detail: string;
}> = [
  { value: 'none', label: 'Instant', detail: 'Fastest response' },
  { value: 'medium', label: 'Medium', detail: 'Balanced reasoning' },
  { value: 'high', label: 'High', detail: 'Deeper thinking' },
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

function LiveTokenUsageStatus() {
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setDurationMs(performance.now() - startedAt);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return <>({formatResponseDuration(durationMs)} \u2022 \u2193 counting tokens...)</>;
}

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
  tokenUsage,
  tokenUsagePending = false,
  className = '',
  compact = false,
}: Props) {
  const [showIntelligence, setShowIntelligence] = useState(false);
  const selectedEffort = EFFORT_OPTIONS.find((option) => option.value === reasoningEffort)!;

  function toggleIntelligence() {
    const next = !showIntelligence;
    setShowIntelligence(next);
    if (next) onLoadModels?.();
  }

  return (
    <div className={className}>
      {tokenUsage ? (
        <p className="mb-2 px-3 font-mono text-[12px] leading-4 text-[var(--ink-muted)]">
          {tokenUsagePending
            ? <LiveTokenUsageStatus />
            : tokenUsage.latest
              ? `(${tokenUsage.latest.responseDurationMs !== undefined ? `${formatResponseDuration(tokenUsage.latest.responseDurationMs)} \u2022 ` : ''}\u2193 ${tokenUsage.latest.estimated ? '~' : ''}${formatTokenCount(tokenUsage.latest.totalTokens).toLowerCase()} tokens)`
              : tokenUsage.unreportedResponses > 0
                ? '(\u2193 tokens unavailable)'
                : '(\u2193 0 tokens)'}
        </p>
      ) : null}
      <div className="relative rounded-[30px] border border-[var(--line)] bg-[var(--paper-raised)] p-2 shadow-[0_14px_40px_rgba(15,32,27,0.10)] transition focus-within:border-[var(--line-strong)] focus-within:shadow-[0_16px_44px_rgba(15,32,27,0.14)]">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-2 pb-1.5 pt-1">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.name}-${index}`}
                className="flex max-w-[220px] items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5 text-xs text-[var(--ink)]"
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

        <div className="flex items-end gap-1.5">
          {onAddDocuments ? (
            <button
              type="button"
              onClick={onAddDocuments}
              disabled={disabled || isAddingDocuments}
              className={`flex shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
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

          {utilityActions ? <div className="flex shrink-0 items-center gap-1">{utilityActions}</div> : null}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            className={`max-h-40 min-h-[24px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] disabled:opacity-50 ${compact ? 'py-2 text-sm leading-5' : 'py-3 text-[15px] leading-6'}`}
            style={textareaStyle}
          />

          <div className="relative shrink-0 self-end">
            <button
              type="button"
              onClick={toggleIntelligence}
              className={`flex items-center gap-1.5 rounded-full bg-[var(--paper-strong)] text-[var(--ink)] transition hover:bg-[var(--paper-bg)] ${compact ? 'h-9 px-2.5 text-xs' : 'h-11 px-3.5 text-sm'}`}
              title={`${selectedEffort.label} reasoning · ${formatAssistantModelName(model)}`}
              aria-expanded={showIntelligence}
            >
              <span>{selectedEffort.label}</span>
              <svg className="h-3.5 w-3.5 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {showIntelligence ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setShowIntelligence(false)}
                  aria-label="Close intelligence menu"
                />
                <div className="absolute bottom-full right-0 z-40 mb-2 w-64 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm shadow-[0_22px_70px_rgba(15,32,27,0.18)]">
                  <div className="px-2.5 pb-1.5 pt-1 text-sm text-[var(--ink-muted)]">Intelligence</div>
                  {EFFORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onReasoningEffortChange(option.value);
                        setShowIntelligence(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${option.value === reasoningEffort ? 'bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
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
                        className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--paper-strong)] ${item === model ? 'bg-[var(--paper-surface)] text-[var(--ink-heading)]' : 'text-[var(--ink)]'}`}
                      >
                        <span className="truncate">{formatAssistantModelName(item)}</span>
                        {item === model ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || isSending || disabled}
            className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--botanical)] text-[var(--paper-raised)] transition hover:scale-[1.03] hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)] disabled:hover:scale-100 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
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
        </div>

        {statusMessage ? (
          <div className="flex min-h-7 items-center gap-3 px-3 pb-1 pt-1.5 text-[11px]">
            <p className="min-w-0 flex-1 text-[#8a6f00]">{statusMessage}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
