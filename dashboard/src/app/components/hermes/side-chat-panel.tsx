"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import AgentRuntimePanel from "./agent-runtime-panel";
import { useAgentSession } from "./use-agent-session";
import { useAssistantIntelligence } from "../use-assistant-intelligence";
import { useAssistantModels } from "../use-assistant-models";
import { useStarredMessages } from "../use-starred-messages";
import { useConfirmDialog } from "../confirm-dialog";
import type { SideChatRequest } from "../side-chat-context";
import { SIDE_CHAT_CONTEXT_SOURCE, wholeMessageReply, type ChatTextSelectionReference } from "@/lib/chat-text-selection";
import type { ComposerAttachment } from "../assistant-composer";
import { CHAT_ATTACHMENT_ACCEPT, extractChatAttachments, reusableChatAttachments } from "@/lib/chat-attachments";
import { useChatNotificationView } from "@/lib/use-chat-notification-view";

async function discardSideChat(id: string, keepalive = false) {
  const response = await fetch(`/api/hermes/sessions/${encodeURIComponent(id)}?discardSideChat=1`, {
    method: "DELETE", keepalive,
  });
  if (!response.ok && response.status !== 404) throw new Error("Could not close this side chat. Please try again.");
}

export default function SideChatPanel({ request, gardenSlug, index = 0, active = false, onTitle, onClose }: {
  request: SideChatRequest;
  gardenSlug?: string;
  /** Pane number in the tiled dock, tmux style. */
  index?: number;
  /** Highlight as the focused pane when several are open. */
  active?: boolean;
  onTitle?: (title: string) => void;
  onClose: () => void;
}) {
  const surface = gardenSlug ? "garden_chat" : "dashboard_terminal";
  const session = useAgentSession(surface, {
    gardenSlug, sideChat: true, temporary: true, restoreLastConversation: false,
    title: "Side chat",
  });
  useChatNotificationView(session.sessionId
    ? { surface: "dashboard_terminal", chatId: session.sessionId } : null);
  const intelligence = useAssistantIntelligence({ scope: `side-chat:${gardenSlug ?? "terminal"}`, persist: false, shared: true });
  const { models } = useAssistantModels();
  const { messages: stars, saving } = useStarredMessages();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState(request.quote ?? "");
  const [context, setContext] = useState(request.context ?? "");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [addingAttachments, setAddingAttachments] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activeId = useRef(request.conversationId);
  const disposed = useRef(false);
  const sending = useRef<Promise<void> | null>(null);
  const closePending = useRef(false);
  const { openSession } = session;
  const firstQuestion = session.messages.find(message => message.role === "user")?.content.trim().replace(/\s+/g, " ") ?? "";
  const title = firstQuestion ? firstQuestion.slice(0, 40) : "Side chat";
  useEffect(() => { onTitle?.(firstQuestion ? title : ""); }, [onTitle, firstQuestion, title]);
  const saved = stars.some((star) => star.conversationId === (session.sessionId ?? request.conversationId));

  useEffect(() => {
    if (request.conversationId) void openSession(request.conversationId);
  }, [openSession, request.conversationId]);

  useEffect(() => {
    if (!session.loadingSession) composerRef.current?.focus();
  }, [session.loadingSession]);

  useEffect(() => {
    disposed.current = false;
    const discard = () => {
      disposed.current = true;
      if (activeId.current) void discardSideChat(activeId.current, true).catch(() => undefined);
    };
    window.addEventListener("pagehide", discard);
    return () => {
      window.removeEventListener("pagehide", discard);
      discard();
    };
  }, []);

  const close = useCallback(async () => {
    if (closing || saving || closePending.current) return;
    closePending.current = true;
    try {
      if (!saved && !(await confirm({
        title: "Are you sure?",
        body: "This chat is temporary. You can star a message to keep it.",
        confirmLabel: "Close chat",
        cancelLabel: "Cancel",
        tone: "neutral",
      }))) return;
      setClosing(true);
      disposed.current = true;
      await session.abort();
      if (activeId.current) await discardSideChat(activeId.current);
      onClose();
    } catch (cause) {
      disposed.current = false;
      setError(cause instanceof Error ? cause.message : "Could not close this side chat.");
      setClosing(false);
    } finally {
      closePending.current = false;
    }
  }, [closing, saving, saved, confirm, session, onClose]);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setAttachmentError("");
    setAddingAttachments(count => count + 1);
    try {
      const result = await extractChatAttachments(files);
      if (disposed.current) return;
      setAttachments(current => [...current, ...result.attachments]);
      const problems = [...result.errors, ...result.warnings];
      if (problems.length) setAttachmentError(problems.join(" · "));
    } catch (cause) {
      if (!disposed.current) setAttachmentError(cause instanceof Error ? cause.message : "The files could not be attached. Try again.");
    } finally {
      setAddingAttachments(count => count - 1);
    }
  }, []);

  const send = useCallback(async (text: string, sentAttachments: readonly ComposerAttachment[] = [], textSelection?: ChatTextSelectionReference, voice?: import('@/lib/speech/voice-request').VoiceRequestOptions) => {
    if ((!text.trim() && !sentAttachments.length) || sending.current || disposed.current) return;
    setError(null);
    const task = (async () => {
      setCreating(true);
      try {
        const id = await session.ensureConversation();
        activeId.current = id;
        if (disposed.current) {
          await discardSideChat(id, true);
          return;
        }
        setCreating(false);
        // A selected quote is shown on the first message; the main-chat
        // snapshot travels as model context only.
        const selection = textSelection
          ?? (quote ? wholeMessageReply("side-chat-selection", quote) ?? undefined : undefined)
          ?? (context ? wholeMessageReply(SIDE_CHAT_CONTEXT_SOURCE, context) ?? undefined : undefined);
        await session.send(text, {
          model: intelligence.model, reasoningEffort: intelligence.reasoningEffort,
          ...voice,
          attachments: [...sentAttachments], textSelection: selection,
          onTurnStarted: () => {
            setInput(""); setQuote(""); setContext("");
            setAttachments(current => current.filter(item => !sentAttachments.includes(item)));
          },
        });
      } catch (cause) {
        if (!disposed.current) setError(cause instanceof Error ? cause.message : "Could not send this message.");
      } finally {
        setCreating(false);
      }
    })();
    sending.current = task;
    try { await task; } finally { sending.current = null; }
  }, [session, intelligence.model, intelligence.reasoningEffort, quote, context]);

  const askSelection = useCallback(async (question: string, selection: ChatTextSelectionReference, selectionAttachments?: readonly ComposerAttachment[], voice?: import("@/lib/speech/voice-request").VoiceRequestOptions) => {
    if (session.activeRunId) await session.abort();
    await session.send(question, {
      model: intelligence.model, reasoningEffort: intelligence.reasoningEffort, ...voice,
      textSelection: selection, attachments: [...(selectionAttachments ?? [])],
    });
  }, [session, intelligence.model, intelligence.reasoningEffort]);

  return <section role="dialog" aria-modal="false" aria-label="Side chat" data-side-chat
    className={`flex h-full min-h-0 flex-col overflow-hidden text-[var(--ink)] ${active ? "shadow-[inset_0_2px_0_var(--botanical)]" : ""}`}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="menu"]')) {
        event.stopPropagation();
        void close();
      }
    }}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] py-1.5 pl-3 pr-1.5">
      <h2 className="min-w-0 truncate font-mono text-xs" title={title}>
        <span className={active ? "text-[var(--botanical)]" : "text-[var(--ink-muted)]"}>{index}:</span> {title}
      </h2>
      <button type="button" aria-label="Close side chat" title="Close side chat" disabled={closing || saving}
        className="shrink-0 rounded-md p-1.5 hover:bg-[var(--paper-strong)] disabled:opacity-40" onClick={() => void close()}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    </header>
    {error ? <p role="alert" className="px-4 py-2 text-sm">{error}</p> : null}
    <input ref={fileInputRef} type="file" multiple accept={CHAT_ATTACHMENT_ACCEPT} className="hidden" aria-label="Attach files to side chat"
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        void addFiles(files);
      }} />
    <AgentRuntimePanel compact sideChat temporaryChat
      sessionId={session.sessionId} createdSessionId={session.createdSessionId} surface={surface} gardenSlug={gardenSlug}
      messages={session.messages} appendExternalAgentTurn={session.appendExternalAgentTurn} connection={session.connection} runState={session.runState}
      loadingTranscript={session.loadingSession} disabled={closing || creating || session.loadingSession}
      steerError={session.steerError} error={session.error} activities={session.activities}
      pendingPermission={session.pendingPermission} pendingClarification={session.pendingClarification}
      input={input} onInputChange={setInput} composerTextareaRef={composerRef}
      onSubmit={voice => void send(input, attachments, undefined, voice)} onSendQueued={send}
      onAskSelection={askSelection}
      onAddDocuments={() => fileInputRef.current?.click()} onPasteFiles={addFiles}
      isAddingDocuments={addingAttachments > 0} attachmentUploadError={attachmentError || undefined}
      attachments={attachments}
      onRemoveAttachment={position => setAttachments(current => current.filter((_, at) => at !== position))}
      onReplaceAttachment={(position, attachment) => setAttachments(current => current.map((item, at) => at === position ? attachment : item))}
      onRestoreQueuedAttachments={restored => setAttachments(restored)}
      onSelectBranch={session.setMessages}
      onEditMessage={(messageIndex, text, branchGroupId, detached = []) => void session.send(text, {
        model: intelligence.model, reasoningEffort: intelligence.reasoningEffort,
        historyOverride: session.messages.slice(0, messageIndex), branchGroupId,
        attachments: reusableChatAttachments(session.messages[messageIndex]?.attachments?.filter(item => !detached.includes(item.name))),
        textSelection: session.messages[messageIndex]?.textSelection,
      })}
      onSteer={async (text, attachments, textSelection) => session.steer(text, [...attachments], textSelection)}
      steerableRun={Boolean(session.activeRunId)}
      onAbort={() => void session.abort()} onPermissionDecision={(decision) => void session.respondToPermission(decision)}
      onClarificationAnswer={(answer) => void session.respondToClarification(answer)}
      onEditAssistantMessage={session.editAssistantMessage} onDeleteMessage={session.deleteMessage}
      onRetryMessage={(index, branchGroupId) => {
        const message = session.messages[index];
        if (message) void session.send(message.content, { model: intelligence.model, reasoningEffort: intelligence.reasoningEffort,
          historyOverride: session.messages.slice(0, index), branchGroupId, textSelection: message.textSelection });
      }}
      model={intelligence.model} models={models} onModelChange={intelligence.setModel}
      reasoningEffort={intelligence.reasoningEffort} onReasoningEffortChange={intelligence.setReasoningEffort}
      intelligenceModes={intelligence.intelligenceModes} placeholder="Ask a side question…"
      emptyState={<p className="py-8 text-center text-sm text-[var(--ink-muted)]">Ask here while keeping your workspace open.</p>}
      starredMessageTarget={request.messageId && session.sessionId ? { chatId: session.sessionId, messageId: request.messageId, requestId: 1 } : undefined}
    />
    {confirmDialog}
  </section>;
}
