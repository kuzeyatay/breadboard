"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import AssistantResponseMeta from "./assistant-response-meta";
import ChatMarkdown, {
  chatTextAnnotationsEqual,
  type ChatTextAnnotation,
} from "./chat-markdown";
import {
  chatTextSelectionDraft,
  type ChatTextSelectionReference,
} from "@/lib/chat-text-selection";
import {
  CHAT_HIGHLIGHT_COLORS,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";

export interface FloatingAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ChatTextSelectionCandidate {
  sourceMessageId: string;
  start: number;
  end: number;
  quote: string;
  prefix?: string;
  suffix?: string;
  anchor: FloatingAnchorRect;
}

function floatingRect(rect: DOMRect): FloatingAnchorRect {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function selectableTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-selection-exclude], .katex")) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node as Text).data
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function selectionCandidate(
  root: HTMLElement,
  sourceMessageId: string,
): ChatTextSelectionCandidate | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }

  const nodes = selectableTextNodes(root);
  const text = nodes.map((node) => node.data).join("");
  let start = -1;
  let end = -1;
  let offset = 0;
  for (const node of nodes) {
    if (node === range.startContainer) start = offset + range.startOffset;
    if (node === range.endContainer) end = offset + range.endOffset;
    offset += node.data.length;
  }
  if (start < 0 || end <= start) return null;

  const draft = chatTextSelectionDraft(text, start, end);
  if (!draft) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { sourceMessageId, ...draft, anchor: floatingRect(rect) };
}

// Memoized against everything but a real change: the virtual list re-invokes
// `renderItem` for every mounted row on every scroll frame, and an assistant
// row that re-renders here re-parses its whole markdown body. The annotation
// click handler is stabilized for the same reason — an inline arrow would
// defeat ChatMarkdown's own memo from the inside.
export const SelectableAssistantMarkdown = memo(
  function SelectableAssistantMarkdown({
    content,
    sourceMessageId,
    annotations,
    onSelection,
    onOpenAnnotation,
  }: {
    content: string;
    sourceMessageId: string;
    annotations: readonly ChatTextAnnotation[];
    onSelection: (selection: ChatTextSelectionCandidate) => void;
    onOpenAnnotation: (annotationId: string, anchor: FloatingAnchorRect) => void;
  }) {
    const rootRef = useRef<HTMLDivElement>(null);

    function readSelection() {
      window.requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        const candidate = selectionCandidate(root, sourceMessageId);
        if (candidate) onSelection(candidate);
      });
    }

    function handleKeyboardSelection(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (event.shiftKey || event.key.startsWith("Arrow")) readSelection();
    }

    const openAnnotation = useCallback(
      (annotationId: string, anchor: DOMRect) =>
        onOpenAnnotation(annotationId, floatingRect(anchor)),
      [onOpenAnnotation],
    );

    return (
      <div
        ref={rootRef}
        onPointerUp={readSelection}
        onKeyUp={handleKeyboardSelection}
        data-chat-selectable-message={sourceMessageId}
      >
        <ChatMarkdown
          content={content}
          compact
          textAnnotations={annotations}
          onTextAnnotationClick={openAnnotation}
        />
      </div>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.sourceMessageId === next.sourceMessageId &&
    prev.onSelection === next.onSelection &&
    prev.onOpenAnnotation === next.onOpenAnnotation &&
    chatTextAnnotationsEqual(prev.annotations, next.annotations),
);

export function ChatSelectionMenu({
  selection,
  highlighted,
  highlightColor,
  onHighlightColor,
  onRemoveHighlight,
  onAskInChat,
  onAskHere,
  onClose,
}: {
  selection: ChatTextSelectionCandidate;
  highlighted: boolean;
  highlightColor?: ChatHighlightColor;
  onHighlightColor: (color: ChatHighlightColor) => void;
  onRemoveHighlight: () => void;
  onAskInChat?: () => void;
  onAskHere?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  const width = Math.min(
    onAskInChat && onAskHere ? (highlighted ? 390 : 360) : highlighted ? 190 : 160,
    window.innerWidth - 20,
  );
  const left = Math.max(
    10,
    Math.min(window.innerWidth - width - 10, selection.anchor.left),
  );
  const top = Math.max(10, selection.anchor.top - 50);
  return createPortal(
    <div
      ref={menuRef}
      // Above the inline answer popover (z-[121]): the same menu serves text
      // selected inside an "Ask here" answer, and under it the menu is dead.
      className="bb-chat-selection-menu fixed z-[130] flex overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 shadow-[0_12px_34px_rgba(45,48,40,0.2)]"
      style={{ left, top, width }}
      role="toolbar"
      aria-label="Selected text actions"
      onPointerDown={(event: ReactPointerEvent) => event.preventDefault()}
    >
      <div
        className="flex shrink-0 items-center gap-0.5 px-1"
        role="group"
        aria-label="Highlight color"
      >
        <span className="px-1 text-[11px] font-medium text-[var(--ink-muted)]">
          Highlight
        </span>
        {CHAT_HIGHLIGHT_COLORS.map((color) => {
          const selected = highlighted && highlightColor === color.id;
          return (
            <button
              key={color.id}
              type="button"
              onClick={() => onHighlightColor(color.id)}
              aria-label={`Highlight ${color.label.toLowerCase()}`}
              aria-pressed={selected}
              title={color.label}
              className="bb-chat-highlight-color grid h-7 w-6 place-items-center rounded-md transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.94]"
            >
              <span
                className="bb-chat-highlight-swatch h-3.5 w-3.5 rounded-full"
                data-highlight-color={color.id}
                aria-hidden
              />
            </button>
          );
        })}
        {highlighted ? (
          <button
            type="button"
            onClick={onRemoveHighlight}
            aria-label="Remove highlight"
            title="Remove highlight"
            className="grid h-7 w-6 place-items-center rounded-md text-base leading-none text-[var(--ink-muted)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] active:scale-[0.94]"
          >
            <span aria-hidden>&times;</span>
          </button>
        ) : null}
      </div>
      {onAskInChat && onAskHere ? (
        <>
          <span className="my-1 w-px bg-[var(--line)]" aria-hidden />
          <button
            type="button"
            onClick={onAskInChat}
            className="flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97]"
          >
            Ask in chat
          </button>
          <span className="my-1 w-px bg-[var(--line)]" aria-hidden />
          <button
            type="button"
            onClick={onAskHere}
            className="flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--selection-yellow)] active:scale-[0.97]"
          >
            Ask here
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

export function SelectionComposerContext({
  selection,
  onCancel,
  widthClassName = "max-w-3xl",
}: {
  selection: ChatTextSelectionReference;
  onCancel: () => void;
  widthClassName?: string;
}) {
  return (
    <div
      className={`mx-auto mb-2 flex w-full ${widthClassName} items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm ${
        selection.mode === "inline"
          ? "border-[var(--selection-yellow-line)] bg-[var(--selection-yellow)]"
          : "border-[var(--line)] bg-[var(--paper-raised)]"
      }`}
    >
      <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--ink-heading)]">
          {selection.mode === "inline" ? "Ask here" : "Ask in chat"}
        </p>
        <p className="mt-0.5 line-clamp-2 leading-5 text-[var(--ink-muted)]">
          {selection.quote}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full p-1 text-[var(--ink-muted)] transition hover:bg-[color-mix(in_srgb,var(--paper-strong)_72%,transparent)] hover:text-[var(--ink-heading)]"
        aria-label="Cancel selected-text question"
        title="Cancel"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

export function QuotedChatSelection({
  selection,
}: {
  selection: ChatTextSelectionReference;
}) {
  return (
    <div className="mb-1 flex max-w-xl items-start gap-2 px-1 text-left text-xs leading-5 text-[var(--ink-muted)]">
      <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
      <span className="line-clamp-3">
        <span className="font-medium text-[var(--ink-heading)]">Selected text: </span>
        “{selection.quote}”
      </span>
    </div>
  );
}

const NO_ANSWER_ANNOTATIONS: readonly ChatTextAnnotation[] = [];

export function InlineSelectionAnswerPopover({
  anchor,
  question,
  answer,
  pending,
  usage,
  responseDurationMs,
  startedAt,
  answerMessageId,
  annotations,
  onSelection,
  onOpenAnnotation,
  onClose,
  onDelete,
  onStop,
  onAskAgain,
}: {
  anchor: FloatingAnchorRect;
  question?: string;
  answer?: string;
  pending: boolean;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  startedAt?: string;
  /**
   * The answer's own message id. When present (with the two handlers below)
   * the answer body is selectable like any transcript message, so a follow-up
   * can be highlighted or asked about inside an answer — recursively.
   */
  answerMessageId?: string;
  annotations?: readonly ChatTextAnnotation[];
  onSelection?: (selection: ChatTextSelectionCandidate) => void;
  onOpenAnnotation?: (annotationId: string, anchor: FloatingAnchorRect) => void;
  onClose: () => void;
  onDelete: () => void;
  onStop?: () => void;
  onAskAgain?: (question: string) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [stopRequested, setStopRequested] = useState(false);
  // `null` means "not editing". The question is copied into a draft only when
  // the person clicks it, so an arriving answer never overwrites their typing.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  // A retry opens a new run, and the square belongs to that run rather than to
  // the answer that was stopped before it. The reset is taken during render
  // rather than in an effect so the new run never paints a frame of a
  // spent, disabled Stop.
  const [runWasPending, setRunWasPending] = useState(pending);
  if (runWasPending !== pending) {
    setRunWasPending(pending);
    if (pending) setStopRequested(false);
  }

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      // The selection menu floats above this popover for text selected inside
      // the answer; choosing an action there must not tear down the popover it
      // is acting on.
      if (
        target instanceof Element &&
        target.closest(".bb-chat-selection-menu, .bb-inline-answer")
      ) {
        return;
      }
      onClose();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape belongs to an open editor first: closing the whole popover would
      // throw away a half-typed question without having been asked to.
      if (editing) {
        setDraft(null);
        return;
      }
      onClose();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editing, onClose]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  function submitEdit() {
    const next = (draft ?? "").trim();
    setDraft(null);
    // An unchanged question is a cancelled edit, not a reason to spend a turn.
    if (!next || next === question) return;
    onAskAgain?.(next);
  }

  if (typeof document === "undefined") return null;
  const width = Math.min(580, window.innerWidth - 32);
  const left = Math.max(
    16,
    Math.min(window.innerWidth - width - 16, anchor.left - 24),
  );
  const spaceBelow = window.innerHeight - anchor.bottom - 16;
  const openBelow = spaceBelow >= 260 || anchor.top < 300;
  const top = openBelow
    ? anchor.bottom + 14
    : Math.max(16, anchor.top - Math.min(420, window.innerHeight * 0.62));
  const maxHeight = Math.max(
    220,
    Math.min(520, openBelow ? window.innerHeight - top - 16 : anchor.top - top - 14),
  );
  return createPortal(
    <div
      ref={popoverRef}
      className="bb-inline-answer neu-popover fixed z-[121] overflow-y-auto rounded-[1.4rem] border p-5 text-sm text-[var(--ink)] sm:p-6"
      style={{ left, top, width, maxHeight }}
      role="dialog"
      aria-label="Answer about highlighted text"
    >
      <div className="flex items-start justify-between gap-4">
        {editing ? (
          <div className="bb-inline-answer-question neu-inset min-w-0 flex-1 rounded-2xl border px-4 py-3">
            <div className="flex items-start gap-2.5">
              <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
              <textarea
                ref={editorRef}
                value={draft ?? ""}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitEdit();
                  }
                }}
                rows={2}
                className="w-full resize-none bg-transparent text-sm leading-6 text-[var(--ink-heading)] outline-none"
                aria-label="Edit question about highlighted text"
              />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-full px-3 py-1 text-xs font-medium text-[var(--ink-muted)] transition hover:text-[var(--ink-heading)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={!onAskAgain || !(draft ?? "").trim()}
                className="rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 py-1 text-xs font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
              >
                Ask again
              </button>
            </div>
          </div>
        ) : question ? (
          // The question is the edit affordance: clicking it reopens the words
          // that were asked, and sending replaces the answer under them.
          <button
            type="button"
            onClick={() => setDraft(question)}
            disabled={!onAskAgain}
            className="bb-inline-answer-question neu-inset min-w-0 flex-1 rounded-2xl border px-4 py-3 text-left transition disabled:cursor-default"
            title={onAskAgain ? "Edit this question" : undefined}
            aria-label={onAskAgain ? "Edit this question" : undefined}
          >
            <div className="flex items-start gap-2.5">
              <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
              <p className="text-sm leading-6 text-[var(--ink-heading)]">{question}</p>
            </div>
          </button>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="neu-button-icon rounded-full border p-2 text-[var(--danger-hover)] hover:bg-[color-mix(in_srgb,var(--danger)_8%,var(--neu-surface-raised))]"
            aria-label="Delete highlight"
            title="Delete highlight"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 13H7L6 7" />
            </svg>
          </button>
          {/* One slot, two jobs. An "Ask here" turn is stopped from its own
              popover rather than from the composer - the chat below is not the
              thing that is working - and once the run is over the same corner
              becomes the retry for the answer that was stopped. */}
          {pending ? (
            <button
              type="button"
              onClick={() => {
                setStopRequested(true);
                onStop?.();
              }}
              disabled={!onStop || stopRequested}
              className="neu-button-accent flex h-9 w-9 items-center justify-center rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] text-[var(--paper-raised)] transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-wait disabled:opacity-55"
              aria-label={stopRequested ? "Stopping this answer" : "Stop this answer"}
              aria-busy={stopRequested}
              title={stopRequested ? "Stopping..." : "Stop"}
            >
              <span className="block h-3 w-3 rounded-[3px] bg-current" aria-hidden />
            </button>
          ) : question ? (
            <button
              type="button"
              onClick={() => onAskAgain?.(question)}
              disabled={!onAskAgain}
              className="neu-button-icon rounded-full border p-2 text-[var(--ink-muted)] hover:text-[var(--ink-heading)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Ask this question again"
              title="Retry"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 6v5h-5M4 18v-5h5m9.7-3A7 7 0 0 0 6.1 7.1L4 11m16 2-2.1 3.9A7 7 0 0 1 5.3 14" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      <div className={question ? "mt-4" : "mt-1"}>
        {pending || answer ? (
          <AssistantResponseMeta
            active={pending}
            shimmer={pending}
            usage={usage}
            responseDurationMs={responseDurationMs}
            startedAt={startedAt}
          />
        ) : null}
        {answer ? (
          <div className="mt-1">
            {answerMessageId && onSelection && onOpenAnnotation ? (
              // The answer is a message like any other: selecting text inside
              // it summons the same menu, so an answer can be highlighted and
              // asked about in place — "Ask here" all the way down.
              <SelectableAssistantMarkdown
                content={answer}
                sourceMessageId={answerMessageId}
                annotations={annotations ?? NO_ANSWER_ANNOTATIONS}
                onSelection={onSelection}
                onOpenAnnotation={onOpenAnnotation}
              />
            ) : (
              <ChatMarkdown content={answer} compact />
            )}
          </div>
        ) : pending ? null : (
          <p className="text-sm leading-6 text-[var(--ink-muted)]">
            {question
              ? "This highlight has no answer yet - retry to ask the question again."
              : "Ask a question in the chat field to attach an answer to this highlight."}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SelectionArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5v5a4 4 0 0 0 4 4h11m-3-3 3 3-3 3" />
    </svg>
  );
}
