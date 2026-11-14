"use client";

import { StarredPdfSourceContext } from "./use-starred-messages";

import type { StarredMessageTarget } from "./use-starred-message-jump";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SetStateAction,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { History, MessageCircle, Plus, X } from "lucide-react";
import AgentRuntimePanel from "./hermes/agent-runtime-panel";
import { useInlineAgentQuestions } from "./hermes/use-inline-agent-questions";
import {
  useAgentSession,
  type AgentSendOptions,
} from "./hermes/use-agent-session";
import { useAssistantIntelligence } from "./use-assistant-intelligence";
import { useAssistantModels } from "./use-assistant-models";
import { useChatDraft } from "./hermes/use-chat-draft";
import {
  ChatSelectionMenu,
  type FloatingAnchorRect,
} from "./chat-text-selection-ui";
import PdfSelectionLayer, {
  pdfHighlightAnchor,
  type PdfSelectionCandidate,
} from "./pdf-selection-layer";
import {
  attachDocumentFile,
  attachmentOnlyMessageText,
  CHAT_ATTACHMENT_ACCEPT,
  extractChatAttachments,
  reusableChatAttachments,
  visibleChatMessageAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { chatTextSelectionsOverlap, type ChatTextSelectionReference } from "@/lib/chat-text-selection";
import {
  DEFAULT_CHAT_HIGHLIGHT_COLOR,
  normalizeChatHighlightNote,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import {
  capturePdfViewport,
  normalizePdfHighlights,
  pdfPageText,
  pdfViewContext,
  type PdfHighlight,
  type PdfViewportSnapshot,
} from "@/lib/pdf-assistant";
import { runPdfPreparationStep } from "@/lib/pdf-preparation";
import { requestPdfViewDecision } from "@/lib/pdf-assistant-view-decision";
import {
  loadHermesSessionSummaries,
  type HermesSessionSnapshot,
} from "@/lib/hermes/session-client";
import { useChatNotificationView } from "@/lib/use-chat-notification-view";
import { useUnreadChats } from "@/lib/conversations/unread-client";
import { UnreadChatDot } from "./hermes/history-client";
import { useTextHighlights } from "./use-text-highlights";
import { ChatSuggestionCards } from "./hermes/chat-greeting-empty-state";
import { TextHighlightSaveStatus } from "./text-highlight-save-status";
import PdfAssistantResizeHandle from "./pdf-assistant-resize-handle";

interface Props {
  documentKey: string;
  sourceUrl?: string;
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

type SentPdfView = Promise<{ snapshot: PdfViewportSnapshot; error?: never } | { snapshot?: never; error: unknown }>;

export default function PdfAssistant({
  documentKey,
  sourceUrl,
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
  const [chatQuestionTarget, setChatQuestionTarget] = useState<StarredMessageTarget | null>(null);
  const [input, setInput] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [addingAttachments, setAddingAttachments] = useState(false);
  const [attachmentUploadError, setAttachmentUploadError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [preparationLabel, setPreparationLabel] = useState<string | undefined>();
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
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDraftGenerationRef = useRef(0);
  const pendingAttachmentsRef = useRef(0);
  const preparingRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const pageNumberRef = useRef(pageNumber);
  pageNumberRef.current = pageNumber;
  const sentViewsRef = useRef(new WeakMap<ChatAttachment, SentPdfView>());
  const documentAttachmentRef = useRef<{
    hash: string;
    attachment: ChatAttachment;
  } | null>(null);
  const session = useAgentSession("dashboard_terminal", {
    concurrentInline: true,
    pageSlug: documentKey,
    title: `PDF · ${title}`,
  });
  const inlineQuestions = useInlineAgentQuestions({
    sessionId: session.sessionId, messages: session.messages,
    ensureConversation: session.ensureConversation, pageSlug: documentKey,
  });
  const messages = inlineQuestions.messages;
  const intelligence = useAssistantIntelligence({ scope: `pdf:${documentKey}`, sessionId: session.sessionId, createdSessionId: session.createdSessionId, shared: true });
  const { models } = useAssistantModels({ eager: open });
  const busy =
    preparing ||
    ["connecting", "streaming", "waiting"].includes(session.connection);
  const disabled = loading || session.loadingSession;
  const [pageSuggestions, setPageSuggestions] = useState<{ key: string; items: string[] } | null>(null);
  const suggestionKey = `${documentKey}:${pageNumber}`;
  const showSuggestions = open && !loading && messages.length === 0 && Boolean(intelligence.model);

  // Questions grounded in the page being read, not generic openers. Waits for
  // page flicking to settle; a page with no text layer simply gets no cards.
  useEffect(() => {
    if (!showSuggestions || pageSuggestions?.key === suggestionKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const page = await pdfDocumentRef.current?.getPage(pageNumber);
        const content = await page?.getTextContent();
        const pageText = content?.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim() ?? "";
        if (!pageText || controller.signal.aborted) return;
        const response = await fetch("/api/pdf-suggestions", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: intelligence.model, title, pageNumber, pageText }),
        });
        const payload = response.ok ? await response.json() : null;
        if (!controller.signal.aborted && Array.isArray(payload?.suggestions)) {
          setPageSuggestions({ key: suggestionKey, items: payload.suggestions });
        }
      } catch {
        // No grounded questions is better than generic ones.
      }
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [showSuggestions, suggestionKey, pageSuggestions?.key, pageNumber, title, intelligence.model, pdfDocumentRef]);
  const viewingChatId = open || openAnswer ? session.sessionId : null;

  useChatNotificationView(viewingChatId
    ? { surface: "dashboard_terminal", chatId: viewingChatId }
    : null);

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
      attachmentDraftGenerationRef.current += 1;
    };
  }, [documentKey]);

  function resetAttachmentDraft() {
    attachmentDraftGenerationRef.current += 1;
    pendingAttachmentsRef.current = 0;
    setChatAttachments([]);
    setAddingAttachments(false);
    setAttachmentUploadError('');
  }

  async function addAttachmentFiles(files: File[]) {
    if (!files.length || loading || session.loadingSession) return;
    const generation = attachmentDraftGenerationRef.current;
    if (pendingAttachmentsRef.current === 0) setAttachmentUploadError('');
    pendingAttachmentsRef.current += 1;
    setAddingAttachments(true);
    setError(null);
    try {
      const result = await extractChatAttachments(files);
      if (!mountedRef.current || generation !== attachmentDraftGenerationRef.current) return;
      setChatAttachments(current => [...current, ...result.attachments]);
      if (result.errors.length) setAttachmentUploadError(current => [current, ...result.errors].filter(Boolean).join(' · '));
      setError(result.warnings.join(" · ") || null);
    } catch (failure) {
      if (!mountedRef.current || generation !== attachmentDraftGenerationRef.current) return;
      const message = failure instanceof Error ? failure.message : "The files could not be attached. Try again.";
      setAttachmentUploadError(current => [current, message].filter(Boolean).join(' · '));
    } finally {
      if (mountedRef.current && generation === attachmentDraftGenerationRef.current) {
        pendingAttachmentsRef.current -= 1;
        setAddingAttachments(pendingAttachmentsRef.current > 0);
      }
    }
  }

  // Answer cards resolve the live PDF marks through the shared selection UI.
  // Scrolling dismisses only the transient palette, so answers return with
  // their marks after scrolling, zooming or PDF.js page recycling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const closeMenu = () => setSelectionMenu(null);
    container.addEventListener("scroll", closeMenu, { passive: true });
    const observer = new ResizeObserver(closeMenu);
    observer.observe(container);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", closeMenu);
    };
  }, [containerRef]);

  const updateComposerSelection = useCallback((action: SetStateAction<ChatTextSelectionReference | null>) => {
    setComposerSelection(action);
    if (typeof action !== "function" && action) setOpen(true);
  }, []);

  const closeSelectionMenu = useCallback(() => setSelectionMenu(null), []);
  const activeHighlight = highlights.find(
    (item) =>
      item.selection.id === selectionMenu?.highlightId ||
      (selectionMenu && item.selection.sourceMessageId === selectionMenu.sourceMessageId &&
        chatTextSelectionsOverlap(item.selection, selectionMenu)),
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
      coordinateSpace: selectionMenu.coordinateSpace,
    };
    if (noteOverride !== undefined) {
      const note = normalizeChatHighlightNote(noteOverride);
      if (note) highlight.note = note;
      else delete highlight.note;
    }
    setHighlights((current) => [
      ...current.filter((item) => item.selection.id !== selection.id &&
        (item.selection.sourceMessageId !== selection.sourceMessageId ||
          !chatTextSelectionsOverlap(item.selection, selection))),
      highlight,
    ]);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    return highlight;
  }

  function beginQuestion(mode: "chat" | "inline") {
    const anchor = selectionMenu?.anchor;
    const highlight = saveHighlight(
      activeHighlight?.color ?? DEFAULT_CHAT_HIGHLIGHT_COLOR,
      mode,
    );
    if (!highlight) return;
    if (mode === "inline" && anchor) {
      setOpenAnswer({ id: highlight.selection.id, anchor });
      return;
    }
    if (mode === "chat") setHighlights(current => current.map(item =>
      item.selection.id === highlight.selection.id ? { ...item, chatQuestion: true } : item));
    setComposerSelection(highlight.selection);
    setHistoryOpen(false);
    setOpen(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const openHighlight = useCallback(
    (highlight: PdfHighlight, anchor: FloatingAnchorRect) => {
      setSelectionMenu(null);
      window.getSelection()?.removeAllRanges();
      if (highlight.selection.mode === "inline") {
        setOpenAnswer({ id: highlight.selection.id, anchor });
      } else if (highlight.chatQuestion || highlight.conversationId) {
        setOpenAnswer(null);
        setHistoryOpen(false);
        setOpen(true);
        if (highlight.conversationId) {
          setChatQuestionTarget({ chatId: highlight.conversationId, messageId: "", selectionId: highlight.selection.id, requestId: Date.now() });
          if (highlight.conversationId !== session.sessionId) void session.openSession(highlight.conversationId);
        } else {
          setComposerSelection(highlight.selection);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }
      } else {
        setSelectionMenu({
          ...highlight.selection,
          rects: highlight.rects,
          coordinateSpace: highlight.coordinateSpace,
          highlightId: highlight.selection.id,
          anchor,
        });
      }
    },
    [session.sessionId, session.openSession],
  );

  const readSelection = useCallback((candidate: PdfSelectionCandidate) => {
    const answer = highlights.find(item => item.selection.mode === "inline" &&
      item.selection.sourceMessageId === candidate.sourceMessageId &&
      chatTextSelectionsOverlap(item.selection, candidate));
    if (answer) {
      openHighlight(answer, candidate.anchor);
      return;
    }
    setSelectionMenu(candidate);
    setOpenAnswer(null);
  }, [highlights, openHighlight]);

  async function prepareContext(
    question: string,
    currentPage: number,
    viewAtSend: SentPdfView,
    signal: AbortSignal,
    reportProgress: (label: string) => void,
    selection?: ChatTextSelectionReference,
  ): Promise<ChatAttachment[]> {
    signal.throwIfAborted();
    const step = <T,>(label: string, run: (signal: AbortSignal) => Promise<T>, timeoutMs?: number) => {
      signal.throwIfAborted();
      reportProgress(label);
      return runPdfPreparationStep({ signal, label, run, timeoutMs });
    };
    const pdf = pdfDocumentRef.current;
    const container = containerRef.current;
    if (!pdf || !container)
      throw new Error("The PDF is still loading. Try again when it is ready.");
    const pageText = await step("Reading the current PDF page", () => pdfPageText(pdf, currentPage));
    const decision = await step("Choosing PDF context", (stepSignal) =>
      requestPdfViewDecision({
        signal: stepSignal,
        context: {
          question,
          title,
          pageNumber: currentPage,
          pageText: pageText.slice(0, 16_000),
          sourceUrl,
          selectedText: selection?.quote,
          model: intelligence.model,
          history: messages.slice(-6).map((message) => ({
            role: message.role,
            content: message.content.slice(0, 2_000),
          })),
        },
      }),
    );
    signal.throwIfAborted();
    // The decision can take time. Only attach the frozen send-time view if
    // requested; scrolling during preparation must not change this turn.
    const snapshot = decision.captureView
      ? await step("Preparing the sent PDF view", async () => {
          const result = await viewAtSend;
          if (!result.snapshot) throw result.error;
          return result.snapshot;
        })
      : null;
    const bytes = await step("Preparing the PDF file", () => getBytes());
    signal.throwIfAborted();
    const ownedBytes = new Uint8Array(bytes);
    const digest = await step("Checking the PDF file", () => crypto.subtle.digest("SHA-256", ownedBytes));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const readWholeDocument = decision.readWholeDocument === true;
    const ocrPages = readWholeDocument ? undefined : snapshot ? [] : [currentPage];
    const readingKey = `${hash}:${readWholeDocument ? "all" : snapshot ? "view" : currentPage}`;
    let documentAttachment = documentAttachmentRef.current?.hash === readingKey
      ? documentAttachmentRef.current.attachment : undefined;
    if (!documentAttachment) {
      // Keep every byte and all embedded text, but do not make a page question
      // wait for OCR of an entire scanned book. A requested screenshot supplies
      // the visible scan directly; whole-document requests still opt into OCR.
      const attachment = await step("Uploading and reading the PDF", (stepSignal) =>
        attachDocumentFile(
          new File(
            [ownedBytes],
            /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`,
            { type: "application/pdf" },
          ),
          "pdf",
          stepSignal,
          false,
          ocrPages,
          sourceUrl,
        ),
        readWholeDocument ? Math.max(180_000, pdf.numPages * 95_000) : 180_000,
      );
      signal.throwIfAborted();
      documentAttachmentRef.current = { hash: readingKey, attachment };
      documentAttachment = attachment;
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
      documentAttachment,
      ...(snapshot ? [snapshot.attachment] : []),
    ].map((attachment) => ({ ...attachment, context: "pdf" as const }));
  }

  function captureSentPage(selection?: ChatTextSelectionReference) {
    const attachment = pdfViewContext({
      title, pageCount, pageNumber: pageNumberRef.current,
      pages: [pageNumberRef.current], text: "", selection,
    });
    // Copy visible pixels before any await. Errors only matter if requested.
    const view: SentPdfView = containerRef.current
      ? capturePdfViewport(containerRef.current).then(
          snapshot => ({ snapshot }), error => ({ error }),
        )
      : Promise.resolve({ error: new Error("The PDF is still loading. Try again when it is ready.") });
    sentViewsRef.current.set(attachment, view);
    return attachment;
  }

  function sentContext(attachments: readonly ChatAttachment[] = [], selection?: ChatTextSelectionReference) {
    const attachment = attachments.find(item => sentViewsRef.current.has(item)) ?? captureSentPage(selection);
    return { attachment, page: attachment.pdfPage!.pageNumber, view: sentViewsRef.current.get(attachment)! };
  }

  async function steer(question: string, attachments: readonly ChatAttachment[], selection?: ChatTextSelectionReference) {
    question = question.trim() || attachmentOnlyMessageText(attachments.filter(item => item.context !== "pdf"));
    const sent = sentContext(attachments, selection);
    const context = await prepareContext(question, sent.page, sent.view, new AbortController().signal, () => {}, selection);
    return session.steer(question, [...context, ...attachments.filter(item => item.context !== "pdf")], selection);
  }

  async function send(
    question: string,
    selection?: ChatTextSelectionReference,
    options?: AgentSendOptions,
  ) {
    const inline = selection?.mode === "inline";
    const userAttachments = options?.attachments?.filter(item => item.context !== "pdf") ?? [];
    question = question.trim() || attachmentOnlyMessageText(userAttachments);
    // Clarification answers belong to the waiting turn and need no new attachments.
    if (!selection && !userAttachments.length && session.pendingClarification) {
      await session.respondToClarification(question);
      setInput("");
      return;
    }
    if (
      !question.trim() ||
      (!selection && (busy || preparingRef.current)) ||
      session.loadingSession ||
      pendingAttachmentsRef.current > 0 ||
      loading
    )
      return;
    const sent = sentContext(options?.attachments, selection);
    const draftAttachments = userAttachments.filter(item => chatAttachments.includes(item));
    if (!inline && selection && (busy || preparingRef.current)) await session.abort();
    const generation = inline ? sendGenerationRef.current : ++sendGenerationRef.current;
    if (!inline) {
      preparingRef.current = true;
      setPreparing(true);
      setPreparationLabel("Preparing PDF context");
      setError(null);
    }
    try {
      const sendOptions: AgentSendOptions = {
        model: intelligence.model,
        reasoningEffort: intelligence.reasoningEffort,
        ...options,
        attachments: [sent.attachment, ...userAttachments],
        prepareAttachments: async (signal) => {
          try {
            const context = await prepareContext(question, sent.page, sent.view, signal, (label) => {
              if (!inline && mountedRef.current && generation === sendGenerationRef.current) setPreparationLabel(label);
            }, selection);
            return [...context, ...userAttachments];
          } finally {
            if (!inline && mountedRef.current && generation === sendGenerationRef.current) {
              setPreparing(false);
              setPreparationLabel(undefined);
            }
          }
        },
        textSelection: selection,
        onTurnStarted: () => {
          setChatAttachments(current => current.filter(item => !draftAttachments.includes(item)));
          if (selection?.mode === "inline") {
            setComposerSelection(current => current?.id === selection.id ? null : current);
          } else {
            setInput("");
            setComposerSelection(null);
          }
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
      };
      if (inline && selection) await inlineQuestions.send(question, selection, sendOptions);
      else await session.send(question, sendOptions);
    } catch (failure) {
      if (!mountedRef.current || generation !== sendGenerationRef.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "The PDF context could not be prepared. Please try again.",
      );
      setInput((current) => current || question);
      setChatAttachments(current => [...draftAttachments, ...current.filter(item => !draftAttachments.includes(item))]);
      setComposerSelection(selection ?? null);
    } finally {
      if (!inline && generation === sendGenerationRef.current) {
        preparingRef.current = false;
        if (mountedRef.current) {
          setPreparing(false);
          setPreparationLabel(undefined);
        }
      }
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

  const answerHighlight = highlights.find(
    (item) => item.selection.id === openAnswer?.id,
  );
  const answerConversationId = answerHighlight?.conversationId;
  const openSession = session.openSession;
  useEffect(() => {
    if (!answerConversationId || answerConversationId === session.sessionId || busy) return;
    void openSession(answerConversationId);
  }, [answerConversationId, busy, openSession, session.sessionId]);

  return (
    <>
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        accept={CHAT_ATTACHMENT_ACCEPT}
        className="hidden"
        aria-label="Attach files to PDF chat"
        onChange={event => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addAttachmentFiles(files);
        }}
      />
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
        data-pdf-assistant-panel
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
        {open && <PdfAssistantResizeHandle width={panelWidth} onResize={setPanelWidth} />}
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--ink-heading)]">
              Assistant
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              session.reset();
              setInput("");
              resetAttachmentDraft();
              setComposerSelection(null);
              setOpenAnswer(null);
              setError(null);
              setHistoryOpen(false);
            }}
            disabled={busy || inlineQuestions.busy}
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
                  disabled={busy || inlineQuestions.busy}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-[var(--selection-highlight-blue)] disabled:opacity-40"
                  onClick={() => {
                    void session.openSession(String(item.id));
                    resetAttachmentDraft();
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
        <StarredPdfSourceContext.Provider value={sourceUrl}>
        <AgentRuntimePanel
          compact
          surface="dashboard_terminal"
          sessionId={session.sessionId}
          starredMessageTarget={chatQuestionTarget}
          createdSessionId={session.createdSessionId}
          messages={messages}
          appendExternalAgentTurn={session.appendExternalAgentTurn}
          connection={session.connection}
          preparationLabel={preparationLabel}
          runState={session.runState}
          steerError={session.steerError}
          error={session.error}
          pendingPermission={session.pendingPermission}
          pendingClarification={session.pendingClarification}
          activities={session.activities}
          input={input}
          onInputChange={setInput}
          onAddDocuments={() => attachmentInputRef.current?.click()}
          onPasteFiles={addAttachmentFiles}
          isAddingDocuments={addingAttachments}
          attachmentUploadError={attachmentUploadError}
          attachments={chatAttachments}
          onRemoveAttachment={index => setChatAttachments(current => current.filter((_, position) => position !== index))}
          onReplaceAttachment={(index, attachment) => setChatAttachments(current => current.map((item, position) => position === index ? attachment : item))}
          onRestoreQueuedAttachments={attachments => setChatAttachments(attachments.filter(item => item.context !== "pdf"))}
          composerTextareaRef={textareaRef}
          selectionDraft={{
            value: composerSelection,
            onChange: updateComposerSelection,
            onCancel: selection => {
              setHighlights(current => current.filter(item =>
                item.selection.id !== selection.id || item.conversationId ||
                messages.some(message => message.textSelection?.id === selection.id)));
            },
          }}
          sourceAnswer={openAnswer && answerHighlight ? {
            selection: answerHighlight.selection,
            anchor: openAnswer.anchor,
            loading: session.loadingSession || Boolean(answerConversationId && answerConversationId !== session.sessionId),
            error: answerConversationId === session.sessionId &&
              !messages.some(message => message.textSelection?.id === openAnswer.id)
              ? session.error : null,
            onClose: () => setOpenAnswer(null),
            onDelete: () => {
              setHighlights(current => current.filter(item => item.selection.id !== openAnswer.id));
              setComposerSelection(current => current?.id === openAnswer.id ? null : current);
              setOpenAnswer(null);
            },
          } : undefined}
          onSubmit={voice => void send(input, composerSelection ?? undefined, { ...voice, attachments: [...chatAttachments] })}
          onAskSelection={(question, selection, attachments, voice) => send(question, selection, { ...voice, attachments: [...(attachments ?? chatAttachments)] })}
          onSteer={steer}
          captureQueuedAttachments={() => [captureSentPage(composerSelection ?? undefined)]}
          steerableRun={Boolean(session.activeRunId)}
          onSendQueued={(question, attachments, selection) =>
            send(question, selection, { attachments: [...attachments] })
          }
          onAbort={() => void session.abort()}
          onAbortInline={inlineQuestions.stop}
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
                  {(input.trim() || chatAttachments.length > 0) && (
                    <button
                      type="button"
                      disabled={busy || disabled}
                      onClick={() =>
                        void send(input, composerSelection ?? undefined, { attachments: [...chatAttachments] })
                      }
                      className="neu-button mt-2 rounded-md border border-[var(--line)] px-2 py-1 font-medium disabled:opacity-40"
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {!loading && pageCount > 0 ? (
                <div
                  className="mb-1 flex min-w-0 items-center gap-1 px-3 text-[11px] leading-5 text-[#6B7971]"
                  title={`${title} — Page ${pageNumber} of ${pageCount}`}
                >
                  <span className="shrink-0">Viewing</span>
                  <span>page {pageNumber}</span>
                </div>
              ) : null}
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
              {pageSuggestions?.items.length ? (
                <div className="mt-5 flex justify-center">
                  <ChatSuggestionCards
                    suggestions={pageSuggestions.items}
                    suggestionScopeKey={pageSuggestions.key}
                    disabled={disabled || busy}
                    onSelectSuggestion={(question) => {
                      setInput(question);
                      textareaRef.current?.focus();
                    }}
                  />
                </div>
              ) : null}
            </div>
          }
        />
        </StarredPdfSourceContext.Provider>
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
    </>
  );
}
