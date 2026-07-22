"use client";

// Shared conversation UI for OpenHarness-backed surfaces. Renders streaming
// assistant output, reasoning, tool activity, source citations, permission
// prompts, an abort control, and error/reconnect state — without ever exposing
// raw internal event JSON. The dashboard terminal, garden chat, and Quartz panel
// all embed this so the runtime experience stays consistent and the surface
// wrappers stay thin.

import { useEffect, useRef, useState } from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import AssistantComposer, {
  type ComposerAttachment,
} from "@/app/components/assistant-composer";
import AssistantMessageActions from "@/app/components/assistant-message-actions";
import ActivityPanel from "./activity-panel";
import { UserMessageText } from "./command-text";
import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import type {
  AgentMessage,
  ActivityItem,
  AgentRunState,
  ConnectionState,
  PermissionPrompt,
} from "./use-agent-session";
import type { OpenHarnessSurface } from "@/lib/openharness/config.ts";

interface Props {
  messages: AgentMessage[];
  connection: ConnectionState;
  runState: AgentRunState;
  steerError: string | null;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activities: ActivityItem[];
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onSteer: (text: string) => Promise<boolean>;
  onSendQueued: (text: string) => void;
  onAbort: () => void;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  onRetryMessage?: (messageIndex: number) => void;
  placeholder?: string;
  emptyState?: React.ReactNode;
  model?: string;
  models?: string[];
  onModelChange?: (model: string) => void;
  reasoningEffort?: AssistantReasoningEffort;
  onReasoningEffortChange?: (effort: AssistantReasoningEffort) => void;
  disabled?: boolean;
  onAddDocuments?: () => void;
  isAddingDocuments?: boolean;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (index: number) => void;
  statusMessage?: string;
  compact?: boolean;
  sessionId?: string | null;
  surface?: OpenHarnessSurface;
}

export default function AgentRuntimePanel({
  messages,
  connection,
  runState,
  steerError,
  error,
  pendingPermission,
  activities,
  input,
  onInputChange,
  onSubmit,
  onSteer,
  onSendQueued,
  onAbort,
  onPermissionDecision,
  onRetryMessage,
  placeholder,
  emptyState,
  model,
  models,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  disabled,
  onAddDocuments,
  isAddingDocuments,
  attachments,
  onRemoveAttachment,
  statusMessage,
  compact,
  sessionId,
  surface = "dashboard_terminal",
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [queuedFollowUp, setQueuedFollowUp] = useState<string | null>(null);
  const [applyingSteer, setApplyingSteer] = useState(false);
  const streaming = connection === "streaming" || connection === "connecting" || connection === "waiting";
  const activeRun =
    runState === "submitting" ||
    runState === "connecting" ||
    runState === "running" ||
    runState === "waiting_for_permission" ||
    runState === "steering" ||
    runState === "stopping";
  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" ? index : lastIndex,
    -1,
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, connection, queuedFollowUp]);

  useEffect(() => {
    if (!queuedFollowUp || activeRun || applyingSteer) return;
    const text = queuedFollowUp;
    setQueuedFollowUp(null);
    onSendQueued(text);
  }, [activeRun, applyingSteer, onSendQueued, queuedFollowUp]);

  async function applyQueuedSteer() {
    if (!queuedFollowUp || !activeRun || applyingSteer) return;
    setApplyingSteer(true);
    try {
      if (await onSteer(queuedFollowUp)) setQueuedFollowUp(null);
    } finally {
      setApplyingSteer(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5">
          {messages.length === 0 && !queuedFollowUp ? (
            emptyState ?? (
              <p className="py-8 text-center text-sm text-gray-500">
                Ask the agent anything. It can use tools, and will ask before doing anything sensitive.
              </p>
            )
          ) : (
            <div className="space-y-5">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={message.role === "user" ? "flex justify-end" : ""}
                >
                  <div className={message.role === "user" ? "max-w-[80%]" : "w-full"}>
                    {message.role === "user" ? (
                      <div className="neu-chat-message neu-chat-message-user rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-6">
                        <UserMessageText content={message.content} />
                      </div>
                    ) : (
                      <div className="text-sm leading-7 text-gray-200">
                        {message.usage ||
                        message.reasoning ||
                        (index === lastAssistantIndex &&
                          (streaming || pendingPermission || activities.length > 0)) ? (
                          <ActivityPanel
                            activities={index === lastAssistantIndex ? activities : []}
                            connection={index === lastAssistantIndex ? connection : "idle"}
                            pendingPermission={index === lastAssistantIndex ? pendingPermission : null}
                            usage={message.usage}
                            reasoning={message.reasoning}
                            onAbort={onAbort}
                            showAbort={false}
                            onPermissionDecision={onPermissionDecision}
                          />
                        ) : null}
                        {message.content ? (
                          <ChatMarkdown content={message.content} compact />
                        ) : null}
                        {message.interrupted ? (
                          <p className="mt-2 text-[11px] text-[var(--ink-muted)]" role="status">
                            Interrupted
                          </p>
                        ) : null}
                        {message.sources && message.sources.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {message.sources.map((source) => (
                              <span
                                key={source}
                                className="rounded-full border border-gray-800 bg-gray-900/60 px-2 py-0.5 text-[10px] text-gray-500"
                              >
                                {source}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {message.content &&
                        !(streaming && index === lastAssistantIndex) ? (
                          <AssistantMessageActions
                            content={message.content}
                            verification={message.verification}
                            onRetry={
                              index === lastAssistantIndex && onRetryMessage
                                ? () => onRetryMessage(index)
                                : undefined
                            }
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {queuedFollowUp ? (
                <div className="flex justify-end">
                  <div className="neu-surface-subtle flex w-full max-w-[80%] items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)]">
                    <svg className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h8.5a2 2 0 0 1 2 2v.75m0 0-2.25-2.25m2.25 2.25L15 12.5" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate" title={queuedFollowUp}>{queuedFollowUp}</span>
                    <button
                      type="button"
                      onClick={() => void applyQueuedSteer()}
                      disabled={applyingSteer || !activeRun || runState === "stopping"}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Steer the active response with this message"
                    >
                      <span aria-hidden>→</span>
                      <span>{applyingSteer ? "Steering..." : "Steer"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setQueuedFollowUp(null)}
                      disabled={applyingSteer}
                      className="rounded-lg p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] disabled:opacity-45"
                      aria-label="Discard queued follow-up message"
                      title="Discard"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5h15m-9-3h3m-7.5 3 .75 12h10.5l.75-12M9.75 10.5v6m4.5-6v6" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}

          {error || steerError ? (
            <div className="mt-4 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-xs text-red-300">
              {error || steerError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3">
        <AssistantComposer
          className="mx-auto w-full max-w-3xl"
          compact={compact}
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={placeholder ?? "Ask the agent…"}
          disabled={disabled}
          isSending={streaming}
          canSubmit={Boolean(input.trim() || (!streaming && attachments?.length))}
          model={model ?? ""}
          models={models ?? []}
          onModelChange={onModelChange ?? (() => undefined)}
          reasoningEffort={reasoningEffort ?? DEFAULT_ASSISTANT_REASONING_EFFORT}
          onReasoningEffortChange={onReasoningEffortChange ?? (() => undefined)}
          onAddDocuments={onAddDocuments}
          isAddingDocuments={isAddingDocuments}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          statusMessage={statusMessage}
          capabilitySessionId={sessionId}
          capabilitySurface={surface}
          runState={runState}
          onQueueSteer={setQueuedFollowUp}
          steerQueued={Boolean(queuedFollowUp)}
          onStop={onAbort}
          permissionPending={Boolean(pendingPermission)}
        />
      </div>
    </div>
  );
}
