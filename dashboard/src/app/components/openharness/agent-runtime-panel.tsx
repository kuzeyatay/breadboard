"use client";

// Shared conversation UI for OpenHarness-backed surfaces. Renders streaming
// assistant output, reasoning, tool activity, source citations, permission
// prompts, an abort control, and error/reconnect state — without ever exposing
// raw internal event JSON. The dashboard terminal, garden chat, and Quartz panel
// all embed this so the runtime experience stays consistent and the surface
// wrappers stay thin.

import { useEffect, useRef } from "react";
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
  ConnectionState,
  PermissionPrompt,
} from "./use-agent-session";
import type { OpenHarnessSurface } from "@/lib/openharness/config.ts";

interface Props {
  messages: AgentMessage[];
  connection: ConnectionState;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  activities: ActivityItem[];
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
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
  sessionId?: number | null;
  surface?: OpenHarnessSurface;
}

export default function AgentRuntimePanel({
  messages,
  connection,
  error,
  pendingPermission,
  activities,
  input,
  onInputChange,
  onSubmit,
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
  const streaming = connection === "streaming" || connection === "connecting" || connection === "waiting";
  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" ? index : lastIndex,
    -1,
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, connection]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5">
          {messages.length === 0 ? (
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
                      <div className="rounded-2xl rounded-br-sm bg-gray-800 px-4 py-2.5 text-sm leading-6 text-gray-100">
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
                            onPermissionDecision={onPermissionDecision}
                          />
                        ) : null}
                        {message.content ? (
                          <ChatMarkdown content={message.content} compact />
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
              <div ref={endRef} />
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-xs text-red-300">
              {error}
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
          disabled={disabled || streaming}
          isSending={streaming}
          canSubmit={Boolean(input.trim() || attachments?.length)}
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
        />
      </div>
    </div>
  );
}
