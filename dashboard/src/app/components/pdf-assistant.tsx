"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { History, MessageCircle, Plus, X } from "lucide-react";
import AgentRuntimePanel from "./hermes/agent-runtime-panel";
import {
  useAgentSession,
  type AgentSendOptions,
} from "./hermes/use-agent-session";
import { useAssistantIntelligence } from "./use-assistant-intelligence";
import { useAssistantModels } from "./use-assistant-models";
import { useChatDraft } from "./hermes/use-chat-draft";
import {
  ChatSelectionMenu,
  InlineSelectionAnswerPopover,
  SelectionComposerContext,
  type FloatingAnchorRect,
} from "./chat-text-selection-ui";
import PdfSelectionLayer, {
  pdfHighlightAnchor,
  type PdfSelectionCandidate,
} from "./pdf-selection-layer";
import {
  attachDocumentFile,
  reusableChatAttachments,
  visibleChatMessageAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import type { ChatTextSelectionReference } from "@/lib/chat-text-selection";
import {
  DEFAULT_CHAT_HIGHLIGHT_COLOR,
  normalizeChatHighlightNote,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import {
  capturePdfViewport,
  normalizePdfHighlights,
  pdfDocumentExcerpt,
  pdfPageText,
  pdfViewContext,
  type PdfHighlight,
} from "@/lib/pdf-assistant";
import {
  loadHermesSessionSummaries,
  type HermesSessionSnapshot,
} from "@/lib/hermes/session-client";
import { setActiveChatNotificationTarget } from "@/lib/chat-notification-inbox";
import { useUnreadChats } from "@/lib/conversations/unread-client";
import { UnreadChatDot } from "./hermes/history-client";
import { useTextHighlights } from "./use-text-highlights";
import { TextHighlightSaveStatus } from "./text-highlight-save-status";

interface Props {
  documentKey: string;
  title: string;
  fileName: string;
  pageNumber: number;
  pageCount: number;
  loading: boolean;
  selectionEnabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  pdfDocumentRef: RefObject<PDFDocumentProxy | null>;
  getBytes: () => Promise<Uint8Array>;
}

export default function PdfAssistant({
  documentKey,
  title,
  fileName,
  pageNumber,
  pageCount,
  loading,
  selectionEnabled,
  containerRef,
  pdfDocumentRef,
  getBytes,
}: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] =
    useState<PdfSelectionCandidate | null>(null);
  const [composerSelection, setComposerSelection] =
    useState<ChatTextSelectionReference | null>(null);
  const [highlights, setHighlights, highlightSaveError] = useTextHighlights<PdfHighlight>(
    `breadboard:pdf-highlights:${documentKey}`, normalizePdfHighlights,
  );
  const [openAnswer, setOpenAnswer] = useState<{
    id: string;
    anchor: FloatingAnchorRect;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HermesSessionSnapshot[]>([]);
  const { unreadChats } = useUnreadChats();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preparingRef = useRef(false);
  const mountedRef = useRef(true);
  const pageNumberRef = useRef(pageNumber);
  pageNumberRef.current = pageNumber;
  const documentAttachmentRef = useRef<{
    hash: string;
    attachment: ChatAttachment;
  } | null>(null);
  const documentTextRef = useRef<{
    pdf: PDFDocumentProxy;
    text: Promise<string>;
  } | null>(null);
  const resizeRef = useRef<{ x: number; width: number } | null>(null);
  const session = useAgentSession("dashboard_terminal", {
    pageSlug: documentKey,
    title: `PDF · ${title}`,
  });
  const intelligence = useAssistantIntelligence({ scope: `pdf:${documentKey}`, sessionId: session.sessionId, createdSessionId: session.createdSessionId, shared: true });
  const { models } = useAssistantModels({ eager: open });
  const busy =
    preparing ||
    ["connecting", "streaming", "waiting"].includes(session.connection);
  const disabled = loading || session.loadingSession;
  const viewingChatId = open || openAnswer ? session.sessionId : null;

  useEffect(() => {
    setActiveChatNotificationTarget(viewingChatId
      ? { surface: "dashboard_terminal", chatId: viewingChatId }
      : null);
    return () => setActiveChatNotificationTarget(null);
  }, [viewingChatId]);

  useChatDraft({
    surface: documentKey,
    sessionId: session.sessionId,
    createdSessionId: session.createdSessionId,
    value: input,
    onRestore: setInput,
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [documentKey]);

  // Re-anchor open answers after scroll/zoom, and dismiss them when their mark leaves the view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSelectionMenu(null);
        setOpenAnswer((current) => {
          if (!current) return null;
          const highlight = highlights.find(
            (item) => item.selection.id === current.id,
          );
          const anchor = highlight && pdfHighlightAnchor(container, highlight);
          return anchor ? { id: current.id, anchor } : null;
        });
      });
    };
    container.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener("scroll", update);
    };
  }, [containerRef, highlights]);

  const closeSelectionMenu = useCallback(() => setSelectionMenu(null), []);
  const readSelection = useCallback((candidate: PdfSelectionCandidate) => {
    setSelectionMenu(candidate);
    setOpenAnswer(null);
  }, []);
  const activeHighlight = highlights.find(
    (item) =>
      item.selection.id === selectionMenu?.highlightId ||
      (item.selection.sourceMessageId === selectionMenu?.sourceMessageId &&
        item.selection.quote === selectionMenu?.quote),
  );

  function saveHighlight(
    color: ChatHighlightColor,
    mode: "chat" | "inline" = "chat",
    noteOverride?: string | null,
  ): PdfHighlight | null {
    if (!selectionMenu) return null;
    const selection: ChatTextSelectionReference = {
      id: activeHighlight?.selection.id ?? crypto.randomUUID(),
      mode,
      sourceMessageId: selectionMenu.sourceMessageId,
      start: selectionMenu.start,
      end: selectionMenu.end,
      quote: selectionMenu.quote,
      prefix: selectionMenu.prefix,
      suffix: selectionMenu.suffix,
    };
    const highlight: PdfHighlight = {
      ...activeHighlight,
      selection,
      color,
      rects: selectionMenu.rects,
    };
    if (noteOverride !== undefined) {
      const note = normalizeChatHighlightNote(noteOverride);
      if (note) highlight.note = note;
      else delete highlight.note;
    }
    setHighlights((current) => [
      ...current.filter((item) => item.selection.id !== selection.id),
      highlight,
    ]);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    return highlight;
  }

  function beginQuestion(mode: "chat" | "inline") {
    const highlight = saveHighlight(
      activeHighlight?.color ?? DEFAULT_CHAT_HIGHLIGHT_COLOR,
      mode,
    );
    if (!highlight) return;
    setComposerSelection(highlight.selection);
    setHistoryOpen(false);
    setOpen(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const openHighlight = useCallback(
    (highlight: PdfHighlight, anchor: FloatingAnchorRect) => {
      if (highlight.selection.mode === "inline" && highlight.conversationId) {
        setOpenAnswer({ id: highlight.selection.id, anchor });
        if (highlight.conversationId !== session.sessionId && !busy)
          void session.openSession(highlight.conversationId);
      } else {
        setSelectionMenu({
          ...highlight.selection,
          rects: highlight.rects,
          highlightId: highlight.selection.id,
          anchor,
        });
      }
    },
    [busy, session],
  );

  async function prepareContext(
    question: string,
    signal: AbortSignal,
    selection?: ChatTextSelectionReference,
  ): Promise<ChatAttachment[]> {
    signal.throwIfAborted();
    const pdf = pdfDocumentRef.current;
    const container = containerRef.current;
    if (!pdf || !container)
      throw new Error("The PDF is still loading. Try again when it is ready.");
    let currentPage = pageNumberRef.current;
    let pageText = await pdfPageText(pdf, currentPage);
    const response = await fetch("/api/pdf-assistant/view-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
      body: JSON.stringify({
        question,
        title,
        pageNumber: currentPage,
        pageText: pageText.slice(0, 16_000),
        selectedText: selection?.quote,
        model: intelligence.model,
        history: session.messages.slice(-6).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 2_000),
        })),
      }),
    });
    const decision = await response.json();
    if (!response.ok || typeof decision?.captureView !== "boolean")
      throw new Error(
        decision?.error ||
          "The assistant could not prepare the PDF context. Try again.",
      );
    signal.throwIfAborted();
    // Only take pixels when the assistant requests them. Read the page again if
    // the user navigated while the assistant was choosing its context.
    currentPage = pageNumberRef.current;
    const snapshot = decision.captureView
      ? await capturePdfViewport(container)
      : null;
    pageText = await pdfPageText(pdf, currentPage);
    const bytes = await getBytes();
    signal.throwIfAborted();
    const ownedBytes = new Uint8Array(bytes);
    const digest = await crypto.subtle.digest("SHA-256", ownedBytes);
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (documentAttachmentRef.current?.hash !== hash) {
      if (documentTextRef.current?.pdf !== pdf)
        documentTextRef.current = { pdf, text: pdfDocumentExcerpt(pdf) };
      const [attachment, text] = await Promise.all([
        attachDocumentFile(
          new File(
            [ownedBytes],
            /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`,
            { type: "application/pdf" },
          ),
          "pdf",
          signal,
        ),
        documentTextRef.current.text,
      ]);
      if (attachment.type === "document" && !attachment.text.trim()) attachment.text = text;
      documentAttachmentRef.current = { hash, attachment };
    }
    signal.throwIfAborted();
    return [
      pdfViewContext({
        title,
        pageCount: pdf.numPages,
        pageNumber: currentPage,
        pages: snapshot?.pages ?? [currentPage],
        capturedAt: snapshot?.capturedAt,
        text: pageText,
        selection,
      }),
      documentAttachmentRef.current.attachment,
      ...(snapshot ? [snapshot.attachment] : []),
    ].map((attachment) => ({ ...attachment, context: "pdf" as const }));
  }

  async function send(
    question: string,
    selection?: ChatTextSelectionReference,
    options?: AgentSendOptions,
  ) {
    // Clarification answers belong to the waiting turn and need no new attachments.
    if (session.pendingClarification) {
      await session.respondToClarification(question);
      setInput("");
      return;
    }
    if (
      !question.trim() ||
      busy ||
      preparingRef.current ||
      session.loadingSession ||
      loading
    )
      return;
    preparingRef.current = true;
    setPreparing(true);
    setError(null);
    try {
      await session.send(question, {
        model: intelligence.model,
        reasoningEffort: intelligence.reasoningEffort,
        ...options,
        prepareAttachments: async (signal) => {
          try {
            const context = await prepareContext(question, signal, selection);
            return [...context, ...(options?.attachments ?? [])];
          } catch (failure) {
            documentTextRef.current = null;
            throw failure;
          } finally {
            if (mountedRef.current) setPreparing(false);
          }
        },
        textSelection: selection,
        onTurnStarted: () => {
          setInput("");
          setComposerSelection(null);
          if (
            selection?.mode === "inline" &&
            selection.sourceMessageId.startsWith(`${documentKey}:`)
          ) {
            const highlight = highlights.find(
              (item) => item.selection.id === selection.id,
            );
            const anchor =
              highlight &&
              containerRef.current &&
              pdfHighlightAnchor(containerRef.current, highlight);
            if (anchor) setOpenAnswer({ id: selection.id, anchor });
          }
        },
        onTurnPersisted: (conversationId) => {
          if (selection)
            setHighlights((current) =>
              current.map((item) =>
                item.selection.id === selection.id
                  ? { ...item, conversationId }
                  : item,
              ),
            );
        },
      });
    } catch (failure) {
      if (!mountedRef.current) return;
      documentTextRef.current = null;
      setError(
        failure instanceof Error
          ? failure.message
          : "The PDF context could not be prepared. Please try again.",
      );
      setInput((current) => current || question);
      setComposerSelection(selection ?? null);
    } finally {
      preparingRef.current = false;
      if (mountedRef.current) setPreparing(false);
    }
  }

  async function showHistory() {
    setHistoryOpen((current) => !current);
    setHistoryLoading(true);
    try {
      setHistory(
        (
          await loadHermesSessionSummaries("dashboard_terminal", {
            force: true,
          })
        ).filter((item) => item.pageSlug === documentKey),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "History could not be loaded. Try again.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  const inlineThread = useMemo(() => {
    if (!openAnswer) return null;
    const messages = session.messages.filter(
      (message) => message.textSelection?.id === openAnswer.id,
    );
    const question = messages
      .filter((message) => message.role === "user")
      .at(-1);
    const answer = messages
      .filter((message) => message.role === "assistant")
      .at(-1);
    return {
      question,
      answer,
      pending:
        busy &&
        Boolean(messages.length) &&
        session.messages.at(-1)?.textSelection?.id === openAnswer.id,
    };
  }, [busy, openAnswer, session.messages]);
  const answerHighlight = highlights.find(
    (item) => item.selection.id === openAnswer?.id,
  );

  return (
    <>
      <TextHighlightSaveStatus error={highlightSaveError} className="absolute bottom-20 left-5 z-30 max-w-md rounded-md bg-gray-950 p-3 text-sm text-gray-300" />
      <PdfSelectionLayer
        containerRef={containerRef}
        documentKey={documentKey}
        enabled={selectionEnabled && !loading}
        highlights={highlights}
        onSelection={readSelection}
        onOpenHighlight={openHighlight}
      />
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          className="neu-button absolute bottom-5 right-5 z-30 rounded-md border border-gray-700 bg-gray-950 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
          aria-label="Open PDF assistant"
          aria-expanded={false}
          aria-controls="pdf-assistant-panel"
        >
          Assistant
        </button>
      )}
      <aside
        id="pdf-assistant-panel"
        aria-label="PDF assistant"
        style={
          open
            ? { width: `min(${panelWidth}px, calc(100vw - 24px))` }
            : undefined
        }
        className={
          open
            ? "neu-surface-raised fixed bottom-3 right-3 top-20 z-40 flex max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] text-[var(--ink)] lg:relative lg:inset-auto lg:overflow-visible lg:rounded-none lg:border-y-0 lg:border-r-0"
            : "hidden"
        }
      >
        <button
          type="button"
          aria-label="Resize PDF assistant"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={panelWidth}
          aria-valuemin={340}
          aria-valuemax={720}
          className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--selection-highlight-blue)] focus-visible:bg-[var(--selection-highlight-blue)] lg:block"
          onPointerDown={(event) => {
            resizeRef.current = { x: event.clientX, width: panelWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (resizeRef.current)
              setPanelWidth(
                Math.max(
                  340,
                  Math.min(
                    720,
                    window.innerWidth * 0.65,
                    resizeRef.current.width +
                      resizeRef.current.x -
                      event.clientX,
                  ),
                ),
              );
          }}
          onPointerUp={(event) => {
            resizeRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            resizeRef.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setPanelWidth((width) =>
                Math.max(
                  340,
                  Math.min(720, width + (event.key === "ArrowLeft" ? 20 : -20)),
                ),
              );
            }
          }}
        />
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              Assistant
            </p>
            <p
              className="truncate text-xs text-[var(--ink-muted)]"
              title={title}
            >
              {title} ·{" "}
              {pageCount ? `Page ${pageNumber} of ${pageCount}` : "PDF"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              session.reset();
              setInput("");
              setComposerSelection(null);
              setOpenAnswer(null);
              setError(null);
              setHistoryOpen(false);
            }}
            disabled={busy}
            className="neu-button rounded-md border border-[var(--line)] p-1.5 disabled:opacity-40"
            title="New chat"
            aria-label="New PDF chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void showHistory()}
            className="neu-button rounded-md border border-[var(--line)] p-1.5"
            title="Chat history"
            aria-label="PDF chat history"
            aria-expanded={historyOpen}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="neu-button rounded-md border border-[var(--line)] p-1.5"
            title="Close assistant"
            aria-label="Close PDF assistant"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {historyOpen && (
          <div
            className="max-h-56 shrink-0 overflow-auto border-b border-[var(--line)] p-2"
            aria-label="PDF conversations"
          >
            {historyLoading ? (
              <p className="p-2 text-xs text-[var(--ink-muted)]">
                Loading history…
              </p>
            ) : !history.length ? (
              <p className="p-2 text-xs text-[var(--ink-muted)]">
                No conversations for this PDF yet.
              </p>
            ) : (
              history.map((item) => (
                <button
                  key={String(item.id)}
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-[var(--selection-highlight-blue)] disabled:opacity-40"
                  onClick={() => {
                    void session.openSession(String(item.id));
                    setHistoryOpen(false);
                    setComposerSelection(null);
                    setOpenAnswer(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{String(item.title || "PDF chat")}</span>
                  {!item.active && unreadChats.has(String(item.id)) ? <UnreadChatDot label={`${item.title || "PDF chat"} — unread`} /> : null}
                </button>
              ))
            )}
          </div>
        )}
        <AgentRuntimePanel
          compact
          surface="dashboard_terminal"
          sessionId={session.sessionId}
          createdSessionId={session.createdSessionId}
          messages={session.messages}
          connection={session.connection}
          runState={session.runState}
          steerError={session.steerError}
          error={session.error}
          pendingPermission={session.pendingPermission}
          pendingClarification={session.pendingClarification}
          activities={session.activities}
          input={input}
          onInputChange={setInput}
          composerTextareaRef={textareaRef}
          onSubmit={() => void send(input, composerSelection ?? undefined)}
          onAskSelection={(question, selection) => send(question, selection)}
          onSteer={(text, attachments, selection) => session.steer(text, attachments, selection)}
          steerableRun={Boolean(session.activeRunId)}
          onSendQueued={(question, attachments, selection) =>
            send(question, selection, { attachments: [...attachments] })
          }
          onAbort={() => void session.abort()}
          onPermissionDecision={(decision) =>
            void session.respondToPermission(decision)
          }
          onClarificationAnswer={(answer) =>
            void session.respondToClarification(answer)
          }
          onEditAssistantMessage={session.editAssistantMessage}
          onDeleteMessage={session.deleteMessage}
          onRetryMessage={(index, branchGroupId) => {
            const message = session.messages[index];
            if (message?.role === "user")
              void send(message.content, message.textSelection, {
                historyOverride: session.messages.slice(0, index),
                branchGroupId,
                attachments: reusableChatAttachments(
                  visibleChatMessageAttachments(message.attachments).attachments,
                ),
              });
          }}
          model={intelligence.model}
          models={models}
          onModelChange={(model) => {
            if (model === intelligence.model) return;
            void session.queueModelChange(model).catch(() => undefined);
            intelligence.setModel(model);
          }}
          reasoningEffort={intelligence.reasoningEffort}
          onReasoningEffortChange={intelligence.setReasoningEffort}
          intelligenceModes={intelligence.intelligenceModes}
          disabled={disabled}
          loadingTranscript={session.loadingSession}
          placeholder="Ask about this PDF…"
          beforeComposer={
            <>
              {error && (
                <div
                  role="alert"
                  className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-xs text-[var(--ink)]"
                >
                  <p>{error}</p>
                  {input.trim() && (
                    <button
                      type="button"
                      disabled={busy || loading}
                      onClick={() =>
                        void send(input, composerSelection ?? undefined)
                      }
                      className="neu-button mt-2 rounded-md border border-[var(--line)] px-2 py-1 font-medium disabled:opacity-40"
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {composerSelection && (
                <SelectionComposerContext
                  selection={composerSelection}
                  onCancel={() => setComposerSelection(null)}
                />
              )}
            </>
          }
          emptyState={
            <div className="px-3 py-8 text-center">
              <MessageCircle className="mx-auto mb-3 h-6 w-6 text-[var(--botanical)]" />
              <p className="text-sm font-medium text-[var(--ink-heading)]">
                Read with Breadboard
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
                Ask about the document, a figure, or what’s on this page.
                Highlight text to ask in chat or keep an answer beside it.
              </p>
              <div className="mt-5 grid gap-2">
                {[
                  "Explain what’s on this page.",
                  "Summarize the main ideas in this document.",
                  "Help me understand the figure on this page.",
                ].map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => {
                      setInput(question);
                      textareaRef.current?.focus();
                    }}
                    className="neu-button rounded-lg border border-[var(--line)] px-3 py-2.5 text-left text-xs disabled:opacity-40"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      </aside>
      {selectionMenu && (
        <ChatSelectionMenu
          selection={selectionMenu}
          highlighted={Boolean(activeHighlight)}
          highlightColor={activeHighlight?.color}
          note={activeHighlight?.note}
          onHighlightColor={(color) => {
            saveHighlight(color, activeHighlight?.selection.mode ?? "chat");
          }}
          onRemoveHighlight={() => {
            setHighlights((current) =>
              current.filter(
                (item) => item.selection.id !== activeHighlight?.selection.id,
              ),
            );
            setSelectionMenu(null);
          }}
          onSaveNote={(note) => {
            saveHighlight(
              activeHighlight?.color ?? DEFAULT_CHAT_HIGHLIGHT_COLOR,
              activeHighlight?.selection.mode ?? "chat",
              note,
            );
          }}
          onAskInChat={() => beginQuestion("chat")}
          onAskHere={() => beginQuestion("inline")}
          onClose={closeSelectionMenu}
        />
      )}
      {openAnswer && answerHighlight && (
        <InlineSelectionAnswerPopover
          anchor={openAnswer.anchor}
          notificationSelectionId={answerHighlight.selection.id}
          question={inlineThread?.question?.content}
          answer={
            inlineThread?.answer?.content ||
            (session.loadingSession ? "Loading saved answer…" : undefined)
          }
          pending={inlineThread?.pending ?? false}
          usage={inlineThread?.answer?.usage}
          responseDurationMs={inlineThread?.answer?.responseDurationMs}
          responseCompletedAt={inlineThread?.answer?.responseCompletedAt}
          verification={inlineThread?.answer?.verification}
          startedAt={inlineThread?.answer?.createdAt}
          onClose={() => setOpenAnswer(null)}
          onDelete={() => {
            setHighlights((current) =>
              current.filter((item) => item.selection.id !== openAnswer.id),
            );
            setOpenAnswer(null);
          }}
          onStop={busy ? () => void session.abort() : undefined}
          onAskAgain={
            !busy
              ? (question) => void send(question, answerHighlight.selection)
              : undefined
          }
        />
      )}
    </>
  );
}
