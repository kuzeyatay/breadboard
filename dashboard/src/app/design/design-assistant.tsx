"use client";

import { useRef, useState } from "react";
import { History, PanelLeftClose, Plus } from "lucide-react";
import AgentRuntimePanel from "@/app/components/hermes/agent-runtime-panel";
import { useAgentSession, type AgentSendOptions } from "@/app/components/hermes/use-agent-session";
import { useInlineAgentQuestions } from "@/app/components/hermes/use-inline-agent-questions";
import { useChatDraft } from "@/app/components/hermes/use-chat-draft";
import { UnreadChatDot } from "@/app/components/hermes/history-client";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import {
  attachmentOnlyMessageText,
  CHAT_ATTACHMENT_ACCEPT,
  extractChatAttachments,
  reusableChatAttachments,
  visibleChatMessageAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { loadHermesSessionSummaries, type HermesSessionSnapshot } from "@/lib/hermes/session-client";
import { useUnreadChats } from "@/lib/conversations/unread-client";
import styles from "./design.module.css";

/** Every Design chat shares this page slug, so history lists only design conversations. */
const DESIGN_CHATS = "design";

/** Bread for the Design page: its own chats, scoped like the PDF assistant, that edit the open design over `doory`. */
export default function DesignAssistant({ designTitle, editing, onHide }: {
  designTitle: string | null;
  editing: boolean;
  onHide: () => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [adding, setAdding] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HermesSessionSnapshot[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { unreadChats } = useUnreadChats();

  const session = useAgentSession("dashboard_terminal", {
    concurrentInline: true,
    pageSlug: DESIGN_CHATS,
    pageTitle: designTitle ?? "Design",
    title: `Design · ${designTitle ?? "new design"}`,
  });
  const inline = useInlineAgentQuestions({
    sessionId: session.sessionId, messages: session.messages,
    ensureConversation: session.ensureConversation, pageSlug: DESIGN_CHATS,
  });
  const intelligence = useAssistantIntelligence({ scope: "design", sessionId: session.sessionId, createdSessionId: session.createdSessionId, shared: true });
  const { models } = useAssistantModels({ eager: true });
  useChatDraft({ surface: DESIGN_CHATS, sessionId: session.sessionId, createdSessionId: session.createdSessionId, value: input, onRestore: setInput });
  const busy = ["connecting", "streaming", "waiting"].includes(session.connection);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setAdding(true);
    setUploadError("");
    try {
      const result = await extractChatAttachments(files);
      setAttachments(current => [...current, ...result.attachments]);
      if (result.errors.length) setUploadError(result.errors.join(" · "));
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : "The files could not be attached. Try again.");
    } finally {
      setAdding(false);
    }
  }

  async function send(text: string, options: AgentSendOptions = {}) {
    const files = options.attachments ?? [];
    text = text.trim() || attachmentOnlyMessageText(files);
    if (!files.length && session.pendingClarification) {
      await session.respondToClarification(text);
      setInput("");
      return;
    }
    if (!text || busy || session.loadingSession || adding) return;
    const sent = attachments.filter(item => files.includes(item));
    await session.send(text, {
      model: intelligence.model,
      reasoningEffort: intelligence.reasoningEffort,
      ...options,
      onTurnStarted: () => {
        setInput("");
        setAttachments(current => current.filter(item => !sent.includes(item)));
      },
    });
  }

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    setHistoryError(null);
    try {
      setHistory((await loadHermesSessionSummaries("dashboard_terminal", { force: true })).filter(item => item.pageSlug === DESIGN_CHATS));
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "History could not be loaded.");
    }
  }

  return (
    <div className={styles.assistant}>
      <input ref={fileInput} type="file" multiple accept={CHAT_ATTACHMENT_ACCEPT} className="hidden" aria-label="Attach files to the design chat"
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addFiles(files); }} />
      <div className={styles.assistantHead}>
        <p className={styles.assistantTitle}>Design assistant</p>
        <button type="button" className={styles.iconButton} disabled={busy || inline.busy} title="New chat" aria-label="New design chat"
          onClick={() => { session.reset(); setInput(""); setAttachments([]); setHistoryOpen(false); }}>
          <Plus size={16} />
        </button>
        <button type="button" className={styles.iconButton} title="Chat history" aria-label="Design chat history" aria-expanded={historyOpen}
          onClick={() => void toggleHistory()}>
          <History size={16} />
        </button>
        <button type="button" className={styles.iconButton} title="Hide assistant" aria-label="Hide design assistant" onClick={onHide}>
          <PanelLeftClose size={16} />
        </button>
      </div>
      {historyOpen && (
        <div className={styles.history} aria-label="Design conversations">
          {historyError ? <p role="alert">{historyError} <button type="button" onClick={() => { setHistoryOpen(false); void toggleHistory(); }}>Try again</button></p>
            : history === null ? null
            : !history.length ? <p>No design chats yet.</p>
            : history.map(item => (
              <button key={String(item.id)} type="button" disabled={busy || inline.busy}
                onClick={() => { void session.openSession(String(item.id)); setAttachments([]); setHistoryOpen(false); }}>
                <span>{String(item.title || "Design chat")}</span>
                {!item.active && unreadChats.has(String(item.id)) ? <UnreadChatDot label={`${item.title || "Design chat"} — unread`} /> : null}
              </button>
            ))}
        </div>
      )}
      <AgentRuntimePanel
        compact
        surface="dashboard_terminal"
        suggestionPageTitle={designTitle}
        sessionId={session.sessionId}
        createdSessionId={session.createdSessionId}
        messages={inline.messages}
        appendExternalAgentTurn={session.appendExternalAgentTurn}
        connection={session.connection}
        runState={session.runState}
        steerError={session.steerError}
        error={session.error}
        pendingPermission={session.pendingPermission}
        pendingClarification={session.pendingClarification}
        activities={session.activities}
        input={input}
        onInputChange={setInput}
        composerTextareaRef={textarea}
        onAddDocuments={() => fileInput.current?.click()}
        onPasteFiles={addFiles}
        isAddingDocuments={adding}
        attachmentUploadError={uploadError}
        attachments={attachments}
        onRemoveAttachment={index => setAttachments(current => current.filter((_, position) => position !== index))}
        onReplaceAttachment={(index, attachment) => setAttachments(current => current.map((item, position) => position === index ? attachment : item))}
        onRestoreQueuedAttachments={setAttachments}
        onSubmit={voice => void send(input, { ...voice, attachments: [...attachments] })}
        onSteer={(text, files, selection) => session.steer(text, [...files], selection)}
        steerableRun={Boolean(session.activeRunId)}
        onSendQueued={(text, files) => send(text, { attachments: [...files] })}
        onAbort={() => void session.abort()}
        onAbortInline={inline.stop}
        onPermissionDecision={decision => void session.respondToPermission(decision)}
        onClarificationAnswer={answer => void session.respondToClarification(answer)}
        onEditAssistantMessage={session.editAssistantMessage}
        onDeleteMessage={session.deleteMessage}
        onRetryMessage={(index, branchGroupId) => {
          const message = session.messages[index];
          if (message?.role === "user") void send(message.content, {
            historyOverride: session.messages.slice(0, index),
            branchGroupId,
            attachments: reusableChatAttachments(visibleChatMessageAttachments(message.attachments).attachments),
          });
        }}
        model={intelligence.model}
        models={models}
        onModelChange={model => {
          if (model === intelligence.model) return;
          void session.queueModelChange(model).catch(() => undefined);
          intelligence.setModel(model);
        }}
        reasoningEffort={intelligence.reasoningEffort}
        onReasoningEffortChange={intelligence.setReasoningEffort}
        intelligenceModes={intelligence.intelligenceModes}
        disabled={session.loadingSession}
        loadingTranscript={session.loadingSession}
        placeholder={editing ? "Describe a change to this design…" : "Describe a design to make…"}
        emptyState={
          <p className={styles.assistantEmpty}>
            {editing
              ? "Bread edits the design you have open: text, colours, layout, images. Every change shows up live and can be undone."
              : "Open a design, or ask Bread to make a new one: a poster, a social post, a slide."}
          </p>
        }
        beforeComposer={designTitle ? (
          <p className={styles.assistantContext} title={designTitle}><span>Editing</span> <strong>{designTitle}</strong></p>
        ) : undefined}
      />
    </div>
  );
}
