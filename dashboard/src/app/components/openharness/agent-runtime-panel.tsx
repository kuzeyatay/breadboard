"use client";

// Shared conversation UI for OpenHarness-backed surfaces. Renders streaming
// assistant output, reasoning, tool activity, source citations, permission
// prompts, an abort control, and error/reconnect state — without ever exposing
// raw internal event JSON. The dashboard terminal, garden chat, and Quartz panel
// all embed this so the runtime experience stays consistent and the surface
// wrappers stay thin.

import { useEffect, useRef } from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import AssistantComposer from "@/app/components/assistant-composer";
import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import type {
  AgentMessage,
  ConnectionState,
  PermissionPrompt,
  ToolActivity,
} from "./use-agent-session";

interface Props {
  messages: AgentMessage[];
  connection: ConnectionState;
  error: string | null;
  pendingPermission: PermissionPrompt | null;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  placeholder?: string;
  emptyState?: React.ReactNode;
  model?: string;
  models?: string[];
  onModelChange?: (model: string) => void;
  reasoningEffort?: AssistantReasoningEffort;
  onReasoningEffortChange?: (effort: AssistantReasoningEffort) => void;
  compact?: boolean;
}

function ToolChip({ tool }: { tool: ToolActivity }) {
  const color =
    tool.status === "completed"
      ? "border-emerald-700 text-emerald-300"
      : tool.status === "failed"
        ? "border-red-700 text-red-300"
        : "border-amber-700 text-amber-300";
  const icon = tool.status === "running" ? "◐" : tool.status === "completed" ? "✓" : "✕";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border bg-gray-900/60 px-2 py-0.5 text-[10px] ${color}`}
      title={tool.summary ?? tool.toolName}
    >
      <span aria-hidden>{icon}</span>
      {tool.toolName}
    </span>
  );
}

export default function AgentRuntimePanel({
  messages,
  connection,
  error,
  pendingPermission,
  input,
  onInputChange,
  onSubmit,
  onAbort,
  onPermissionDecision,
  placeholder,
  emptyState,
  model,
  models,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  compact,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = connection === "streaming" || connection === "connecting" || connection === "waiting";

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
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    ) : (
                      <div className="text-sm leading-7 text-gray-200">
                        {message.reasoning ? (
                          <details className="mb-2 rounded-md border border-gray-800 bg-gray-900/50 px-3 py-2 text-xs text-gray-400">
                            <summary className="cursor-pointer text-gray-300">Thinking</summary>
                            <pre className="mt-2 whitespace-pre-wrap font-sans leading-5">{message.reasoning}</pre>
                          </details>
                        ) : null}
                        {message.tools && message.tools.length > 0 ? (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {message.tools.map((tool) => (
                              <ToolChip key={tool.toolCallId} tool={tool} />
                            ))}
                          </div>
                        ) : null}
                        {message.content ? (
                          <ChatMarkdown content={message.content} compact />
                        ) : streaming && index === messages.length - 1 ? (
                          <span className="text-gray-500">Working…</span>
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
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}

          {pendingPermission ? (
            <div className="mt-4 rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3">
              <p className="text-sm font-medium text-amber-200">Permission requested</p>
              <p className="mt-1 text-xs text-amber-100/80">{pendingPermission.description}</p>
              {pendingPermission.risk ? (
                <p className="mt-1 text-[11px] text-amber-300/70">Risk: {pendingPermission.risk}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onPermissionDecision("once")}
                  className="rounded-md border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/70"
                >
                  Allow once
                </button>
                <button
                  type="button"
                  onClick={() => onPermissionDecision("always")}
                  className="rounded-md border border-emerald-800 bg-emerald-900/20 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/50"
                >
                  Allow for session
                </button>
                <button
                  type="button"
                  onClick={() => onPermissionDecision("reject")}
                  className="rounded-md border border-red-800 bg-red-950/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/70"
                >
                  Deny
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-xs text-red-300">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3">
        {streaming ? (
          <div className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between text-xs text-gray-500">
            <span>
              {connection === "waiting"
                ? "Waiting for your permission decision…"
                : connection === "connecting"
                  ? "Connecting…"
                  : "Streaming…"}
            </span>
            <button
              type="button"
              onClick={onAbort}
              className="rounded-md border border-gray-700 px-2.5 py-1 text-gray-300 hover:border-gray-600 hover:text-white"
            >
              Stop
            </button>
          </div>
        ) : null}
        <AssistantComposer
          className="mx-auto w-full max-w-3xl"
          compact={compact}
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          placeholder={placeholder ?? "Ask the agent…"}
          isSending={streaming}
          canSubmit={Boolean(input.trim())}
          model={model ?? ""}
          models={models ?? []}
          onModelChange={onModelChange ?? (() => undefined)}
          reasoningEffort={reasoningEffort ?? DEFAULT_ASSISTANT_REASONING_EFFORT}
          onReasoningEffortChange={onReasoningEffortChange ?? (() => undefined)}
        />
      </div>
    </div>
  );
}
