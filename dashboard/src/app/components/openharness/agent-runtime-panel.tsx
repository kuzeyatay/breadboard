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
  onSendQueued: (text: string) => Promise<void>;
  onEditMessage?: (
    messageIndex: number,
    text: string,
    branchGroupId: string,
  ) => void;
  onSelectBranch?: (messages: AgentMessage[]) => void;
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

interface QueuedFollowUp {
  id: string;
  text: string;
}

function reorderQueuedFollowUps(
  items: QueuedFollowUp[],
  sourceId: string,
  targetId: string,
): QueuedFollowUp[] {
  if (sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

interface ConversationBranchGroup {
  id: string;
  activeIndex: number;
  variants: AgentMessage[][];
}

const BRANCH_STORAGE_PREFIX = "breadboard:conversation-branches:";

function messageBranchId(message: AgentMessage, index: number): string {
  return (
    message.branchGroupId ??
    message.clientMessageId ??
    message.id ??
    `message-${index}-${message.content.slice(0, 48)}`
  );
}

function cloneMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    ...message,
    sources: message.sources ? [...message.sources] : undefined,
  }));
}

function loadBranchGroups(sessionId: string): Record<string, ConversationBranchGroup> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${sessionId}`) ?? "{}",
    ) as Record<string, ConversationBranchGroup>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, group]) =>
        Boolean(
          group &&
            typeof group.id === "string" &&
            Number.isInteger(group.activeIndex) &&
            Array.isArray(group.variants) &&
            group.variants.length > 1,
        ),
      ),
    );
  } catch {
    return {};
  }
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
  onEditMessage,
  onSelectBranch,
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
  const copiedUserTimerRef = useRef<number | null>(null);
  const [queuedFollowUps, setQueuedFollowUps] = useState<QueuedFollowUp[]>([]);
  const [applyingSteerId, setApplyingSteerId] = useState<string | null>(null);
  const [sendingQueuedId, setSendingQueuedId] = useState<string | null>(null);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [queuedEditText, setQueuedEditText] = useState("");
  const [draggedQueuedId, setDraggedQueuedId] = useState<string | null>(null);
  const [dragOverQueuedId, setDragOverQueuedId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageEditText, setMessageEditText] = useState("");
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [branchGroups, setBranchGroups] = useState<
    Record<string, ConversationBranchGroup>
  >({});
  const [branchStorageSession, setBranchStorageSession] = useState<string | null>(null);
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
  }, [messages, connection]);

  useEffect(() => {
    if (
      queuedFollowUps.length === 0 ||
      activeRun ||
      applyingSteerId ||
      sendingQueuedId
    ) {
      return;
    }
    const next = queuedFollowUps[0];
    setQueuedFollowUps((current) => current.filter((item) => item.id !== next.id));
    setSendingQueuedId(next.id);
    void onSendQueued(next.text).finally(() => setSendingQueuedId(null));
  }, [
    activeRun,
    applyingSteerId,
    onSendQueued,
    queuedFollowUps,
    sendingQueuedId,
  ]);

  useEffect(
    () => () => {
      if (copiedUserTimerRef.current !== null) {
        window.clearTimeout(copiedUserTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) {
      setBranchGroups({});
      setBranchStorageSession(null);
      return;
    }
    setBranchGroups(loadBranchGroups(sessionId));
    setBranchStorageSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || branchStorageSession !== sessionId) return;
    try {
      window.localStorage.setItem(
        `${BRANCH_STORAGE_PREFIX}${sessionId}`,
        JSON.stringify(branchGroups),
      );
    } catch {
      // Branch switching remains available for this page even if storage is full.
    }
  }, [branchGroups, branchStorageSession, sessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    setBranchGroups((current) => {
      let changed = false;
      const next = { ...current };
      for (const [groupId, group] of Object.entries(current)) {
        const isVisible = messages.some(
          (message, index) =>
            message.role === "user" && messageBranchId(message, index) === groupId,
        );
        if (!isVisible || group.variants[group.activeIndex] === messages) continue;
        const variants = [...group.variants];
        variants[group.activeIndex] = messages;
        next[groupId] = { ...group, variants };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [messages]);

  function queueFollowUp(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQueuedFollowUps((current) => [
      ...current,
      { id: crypto.randomUUID(), text: trimmed },
    ]);
  }

  async function applyQueuedSteer(item: QueuedFollowUp) {
    if (!activeRun || applyingSteerId) return;
    setApplyingSteerId(item.id);
    try {
      if (await onSteer(item.text)) {
        setQueuedFollowUps((current) =>
          current.filter((candidate) => candidate.id !== item.id),
        );
      }
    } finally {
      setApplyingSteerId(null);
    }
  }

  function beginQueuedEdit(item: QueuedFollowUp) {
    setEditingQueuedId(item.id);
    setQueuedEditText(item.text);
  }

  function saveQueuedEdit(itemId: string) {
    const text = queuedEditText.trim();
    if (!text) return;
    setQueuedFollowUps((current) =>
      current.map((item) => (item.id === itemId ? { ...item, text } : item)),
    );
    setEditingQueuedId(null);
    setQueuedEditText("");
  }

  function moveQueuedFollowUp(itemId: string, offset: -1 | 1) {
    setQueuedFollowUps((current) => {
      const currentIndex = current.findIndex((item) => item.id === itemId);
      const target = current[currentIndex + offset];
      if (currentIndex < 0 || !target) return current;
      return reorderQueuedFollowUps(current, itemId, target.id);
    });
  }

  function finishQueuedDrop(targetId: string) {
    if (draggedQueuedId) {
      setQueuedFollowUps((current) =>
        reorderQueuedFollowUps(current, draggedQueuedId, targetId),
      );
    }
    setDraggedQueuedId(null);
    setDragOverQueuedId(null);
  }

  async function copyUserMessage(message: AgentMessage, messageId: string) {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      return;
    }
    setCopiedUserId(messageId);
    if (copiedUserTimerRef.current !== null) {
      window.clearTimeout(copiedUserTimerRef.current);
    }
    copiedUserTimerRef.current = window.setTimeout(
      () => setCopiedUserId(null),
      1_600,
    );
  }

  function beginMessageEdit(message: AgentMessage, messageId: string) {
    setEditingMessageId(messageId);
    setMessageEditText(message.content);
  }

  function saveMessageEdit(message: AgentMessage, messageIndex: number) {
    const text = messageEditText.trim();
    if (!text || text === message.content || !onEditMessage) {
      setEditingMessageId(null);
      return;
    }
    const groupId = messageBranchId(message, messageIndex);
    const currentSnapshot = cloneMessages(messages);
    const existing = branchGroups[groupId];
    const variants = existing
      ? existing.variants.map((variant) => cloneMessages(variant))
      : [currentSnapshot];
    if (existing) variants[existing.activeIndex] = currentSnapshot;
    const newIndex = variants.length;
    variants.push([
      ...cloneMessages(messages.slice(0, messageIndex)),
      {
        ...message,
        id: crypto.randomUUID(),
        content: text,
        branchGroupId: groupId,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        sources: [],
        tools: [],
        branchGroupId: groupId,
      },
    ]);
    setBranchGroups((current) => ({
      ...current,
      [groupId]: { id: groupId, activeIndex: newIndex, variants },
    }));
    setEditingMessageId(null);
    setMessageEditText("");
    onEditMessage(messageIndex, text, groupId);
  }

  function branchForAssistant(message: AgentMessage, messageIndex: number) {
    if (message.role !== "assistant") return null;
    let userIndex = messageIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== "user") userIndex -= 1;
    if (userIndex < 0) return null;
    const groupId =
      message.branchGroupId ?? messageBranchId(messages[userIndex], userIndex);
    const group = branchGroups[groupId];
    return group && group.variants.length > 1 ? group : null;
  }

  function switchBranch(group: ConversationBranchGroup, direction: -1 | 1) {
    if (activeRun || !onSelectBranch) return;
    const targetIndex = Math.min(
      group.variants.length - 1,
      Math.max(0, group.activeIndex + direction),
    );
    if (targetIndex === group.activeIndex) return;
    const variants = group.variants.map((variant) => cloneMessages(variant));
    variants[group.activeIndex] = cloneMessages(messages);
    setBranchGroups((current) => ({
      ...current,
      [group.id]: { ...group, activeIndex: targetIndex, variants },
    }));
    onSelectBranch(cloneMessages(variants[targetIndex]));
  }

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
                  className={message.role === "user" ? "group flex justify-end" : ""}
                >
                  <div className={message.role === "user" ? "max-w-[80%]" : "w-full"}>
                    {message.role === "user" ? (
                      editingMessageId === messageBranchId(message, index) ? (
                        <form
                          className="neu-chat-message neu-chat-message-user min-w-64 rounded-2xl rounded-br-sm p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveMessageEdit(message, index);
                          }}
                        >
                          <textarea
                            value={messageEditText}
                            onChange={(event) => setMessageEditText(event.target.value)}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                (event.ctrlKey || event.metaKey)
                              ) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                              }
                            }}
                            rows={Math.min(6, Math.max(2, messageEditText.split("\n").length))}
                            className="max-h-40 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-[var(--ink)] outline-none"
                            aria-label="Edit message"
                            autoFocus
                          />
                          <div className="mt-1 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingMessageId(null)}
                              className="rounded-full px-3 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={
                                activeRun ||
                                !messageEditText.trim() ||
                                messageEditText.trim() === message.content
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 text-xs font-medium text-[var(--paper-raised)] shadow-sm transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)] disabled:shadow-none"
                            >
                              <span>Save &amp; send</span>
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.2}
                                aria-hidden
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0-6 6m6-6 6 6" />
                              </svg>
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="neu-chat-message neu-chat-message-user rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-6">
                            <UserMessageText content={message.content} />
                          </div>
                          <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() =>
                                void copyUserMessage(
                                  message,
                                  messageBranchId(message, index),
                                )
                              }
                              className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                              title={copiedUserId === messageBranchId(message, index) ? "Copied" : "Copy message"}
                              aria-label={copiedUserId === messageBranchId(message, index) ? "Message copied" : "Copy message"}
                            >
                              {copiedUserId === messageBranchId(message, index) ? (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                                  <rect x="8" y="8" width="11" height="11" rx="2" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                                </svg>
                              )}
                            </button>
                            {onEditMessage ? (
                              <button
                                type="button"
                                onClick={() =>
                                  beginMessageEdit(
                                    message,
                                    messageBranchId(message, index),
                                  )
                                }
                                disabled={activeRun}
                                className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:cursor-not-allowed disabled:opacity-35"
                                title="Edit message"
                                aria-label="Edit message and create a branch"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </>
                      )
                    ) : (
                      <div className="text-sm leading-7 text-gray-200">
                        {message.usage ||
                        message.reasoning ||
                        message.responseDurationMs !== undefined ||
                        (index === lastAssistantIndex &&
                          (streaming || pendingPermission || activities.length > 0)) ? (
                          <ActivityPanel
                            activities={index === lastAssistantIndex ? activities : []}
                            connection={index === lastAssistantIndex ? connection : "idle"}
                            pendingPermission={index === lastAssistantIndex ? pendingPermission : null}
                            usage={message.usage}
                            reasoning={message.reasoning}
                            responseDurationMs={message.responseDurationMs}
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
                            branch={(() => {
                              const branch = branchForAssistant(message, index);
                              return branch
                                ? {
                                    current: branch.activeIndex + 1,
                                    total: branch.variants.length,
                                    onPrevious: () => switchBranch(branch, -1),
                                    onNext: () => switchBranch(branch, 1),
                                  }
                                : undefined;
                            })()}
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

          {error || steerError ? (
            <p
              className="mt-3 px-1 text-xs text-[var(--danger)]"
              role="alert"
            >
              {error || steerError}
            </p>
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
          headerContent={
            queuedFollowUps.length > 0 ? (
              <div className="space-y-0.5 py-0.5">
                {queuedFollowUps.map((item, index) => (
                  <div
                    key={item.id}
                    onDragOver={(event) => {
                      if (!draggedQueuedId || draggedQueuedId === item.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverQueuedId(item.id);
                    }}
                    onDragLeave={() =>
                      setDragOverQueuedId((current) =>
                        current === item.id ? null : current,
                      )
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      finishQueuedDrop(item.id);
                    }}
                    className={`flex min-h-9 items-center gap-2 rounded-xl px-2 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] ${
                      dragOverQueuedId === item.id
                        ? "bg-[var(--paper-strong)] ring-1 ring-inset ring-[var(--line-strong)]"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      draggable={editingQueuedId !== item.id}
                      onDragStart={(event) => {
                        setDraggedQueuedId(item.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        setDraggedQueuedId(null);
                        setDragOverQueuedId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" && index > 0) {
                          event.preventDefault();
                          moveQueuedFollowUp(item.id, -1);
                        } else if (
                          event.key === "ArrowDown" &&
                          index < queuedFollowUps.length - 1
                        ) {
                          event.preventDefault();
                          moveQueuedFollowUp(item.id, 1);
                        }
                      }}
                      className="grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-lg opacity-70 transition hover:bg-[var(--paper-surface)] hover:opacity-100 active:cursor-grabbing"
                      aria-label={`Reorder queued message ${index + 1} of ${queuedFollowUps.length}: ${item.text}. Drag, or use the Up and Down arrow keys.`}
                      title="Drag to change steering order"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h8.5a2 2 0 0 1 2 2v.75m0 0-2.25-2.25m2.25 2.25L15 12.5" />
                      </svg>
                    </button>
                    {editingQueuedId === item.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveQueuedEdit(item.id);
                        }}
                      >
                        <input
                          value={queuedEditText}
                          onChange={(event) => setQueuedEditText(event.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
                          aria-label="Edit queued message"
                          autoFocus
                        />
                        <button type="submit" className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)] hover:bg-[var(--paper-surface)]">
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingQueuedId(null)}
                          className="rounded-lg px-2 py-1 text-xs hover:bg-[var(--paper-surface)]"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate" title={item.text}>
                          {item.text}
                        </span>
                        <button
                          type="button"
                          onClick={() => void applyQueuedSteer(item)}
                          disabled={
                            Boolean(applyingSteerId) ||
                            !activeRun ||
                            runState === "stopping"
                          }
                          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Steer the active response with: ${item.text}`}
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.7}
                            aria-hidden
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 8.25H9.75a4.5 4.5 0 0 0-4.5 4.5v.75m0 0 3-3m-3 3 3 3"
                            />
                          </svg>
                          <span>
                            {applyingSteerId === item.id ? "Steering..." : "Steer"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQueuedFollowUps((current) =>
                              current.filter((candidate) => candidate.id !== item.id),
                            )
                          }
                          disabled={applyingSteerId === item.id}
                          className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                          aria-label={`Delete queued message: ${item.text}`}
                          title="Delete queued message"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.5h15m-9-3h3m-7.5 3 .75 12h10.5l.75-12M9.75 10.5v6m4.5-6v6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => beginQueuedEdit(item)}
                          disabled={applyingSteerId === item.id}
                          className="rounded-lg p-1.5 transition hover:bg-[var(--paper-surface)] hover:text-[var(--ink)] disabled:opacity-40"
                          aria-label={`Edit queued message: ${item.text}`}
                          title="Edit queued message"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : undefined
          }
          capabilitySessionId={sessionId}
          capabilitySurface={surface}
          runState={runState}
          onQueueSteer={queueFollowUp}
          onStop={onAbort}
          permissionPending={Boolean(pendingPermission)}
        />
      </div>
    </div>
  );
}
