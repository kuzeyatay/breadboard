"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import { registerInlineSelectionNotificationView } from "@/lib/notification-view-presence";
import { placeNestedInlineAnswer } from "@/lib/inline-answer-placement";
import { useInlineQuestionDraft } from "./use-inline-question-draft";
import ActivityPanel from "./hermes/activity-panel";
import MetalSendButton from "./effects/metal-send-button";
import InlineQuestionAttachments from "./inline-question-attachments";
import ViewportPopover from "./viewport-popover";
import { Ellipsis, X } from "lucide-react";
import AssistantMessageActions, { MessageActionsSlot } from "./assistant-message-actions";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import ChatMarkdown, {
  chatTextAnnotationsEqual,
  type ChatTextAnnotation,
} from "./chat-markdown";
import {
  chatTextSelectionDraft,
  wholeMessageReply,
  type ChatTextSelectionReference,
} from "@/lib/chat-text-selection";
import {
  CHAT_HIGHLIGHT_COLORS,
  MAX_CHAT_HIGHLIGHT_NOTE_LENGTH,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { attachmentOnlyMessageText, extractChatAttachments, imageFilesFromClipboard, type ChatAttachment } from "@/lib/chat-attachments";

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

const MATH_WIDGET_SELECTOR = ".katex-display, .katex";
const OPAQUE_SELECTOR = "[data-selection-exclude], " + MATH_WIDGET_SELECTOR;

/**
 * Rendered KaTeX has no usable text offsets (its MathML and HTML layers repeat
 * the formula), so a whole widget maps to one atomic run of its TeX source,
 * written the way the Markdown spelled it. `chat-markdown` produces the same
 * run from the pre-render tree, which is what lets a saved anchor land again.
 */
function mathWidgetText(element: HTMLElement): string {
  const tex =
    element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
    element.textContent ??
    "";
  return element.classList.contains("katex-display") ? `$$${tex}$$` : `$${tex}$`;
}

type SelectableSegment = { node: Text | HTMLElement; text: string };

function selectableSegments(root: HTMLElement): SelectableSegment[] {
  const segments: SelectableSegment[] = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(OPAQUE_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return (node as Text).data
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
        const element = node as HTMLElement;
        if (element.hasAttribute("data-selection-exclude")) {
          return NodeFilter.FILTER_REJECT;
        }
        return element.matches(MATH_WIDGET_SELECTOR)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    segments.push(
      node.nodeType === Node.TEXT_NODE
        ? { node: node as Text, text: (node as Text).data }
        : { node: node as HTMLElement, text: mathWidgetText(node as HTMLElement) },
    );
  }
  return segments;
}

export function chatSelectableText(root: HTMLElement): string {
  return selectableSegments(root).map((segment) => segment.text).join("");
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

  const segments = selectableSegments(root);
  const text = segments.map((segment) => segment.text).join("");
  let start = -1;
  let end = -1;
  let offset = 0;
  for (const { node, text: part } of segments) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === range.startContainer) start = offset + range.startOffset;
      if (node === range.endContainer) end = offset + range.endOffset;
    } else {
      // A drag that begins or ends inside a formula takes the whole formula.
      if (node.contains(range.startContainer)) start = offset;
      if (node.contains(range.endContainer)) end = offset + part.length;
    }
    offset += part.length;
  }
  if (start < 0 || end < 0) {
    // Element-anchored ranges (triple-click, shift+click across blocks) name a
    // child index rather than a text node; fall back to what the range covers.
    const fillStart = start < 0;
    const fillEnd = end < 0;
    offset = 0;
    for (const { node, text: part } of segments) {
      if (range.intersectsNode(node)) {
        if (fillStart && start < 0) start = offset;
        if (fillEnd) end = offset + part.length;
      }
      offset += part.length;
    }
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
    selectionScopeRef,
  }: {
    content: string;
    sourceMessageId: string;
    annotations: readonly ChatTextAnnotation[];
    onSelection: (selection: ChatTextSelectionCandidate) => void;
    onOpenAnnotation: (annotationId: string, anchor: FloatingAnchorRect) => void;
    /** Segments of a steered response share one message-relative text map. */
    selectionScopeRef?: RefObject<HTMLDivElement | null>;
  }) {
    const rootRef = useRef<HTMLDivElement>(null);

    function readSelection() {
      window.requestAnimationFrame(() => {
        const root = selectionScopeRef?.current ?? rootRef.current;
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
        className="select-text [-webkit-app-region:no-drag]"
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
    prev.selectionScopeRef === next.selectionScopeRef &&
    chatTextAnnotationsEqual(prev.annotations, next.annotations),
);

export function ChatSelectionMenu({
  embedded = false,
  onSizeChange,
  selection,
  highlighted,
  highlightColor,
  note,
  onHighlightColor,
  onRemoveHighlight,
  onSaveNote,
  onAskInChat,
  onAskHere,
  onComment,
  onClose,
}: {
  /** A native browser overlay owns placement; keep the same shared controls. */
  embedded?: boolean;
  onSizeChange?: (height: number) => void;
  selection: ChatTextSelectionCandidate;
  highlighted: boolean;
  highlightColor?: ChatHighlightColor;
  note?: string;
  onHighlightColor: (color: ChatHighlightColor) => void;
  onRemoveHighlight: () => void;
  onSaveNote?: (note: string | null) => void;
  onAskInChat?: () => void;
  onAskHere?: () => void;
  onComment?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const [editingNote, setEditingNote] = useState(Boolean(note));
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  useEffect(() => {
    if (!embedded || !onSizeChange || !menuRef.current) return;
    const observer = new ResizeObserver(() => onSizeChange(menuRef.current!.getBoundingClientRect().height));
    observer.observe(menuRef.current);
    return () => observer.disconnect();
  }, [embedded, onSizeChange]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (editingNote) {
        setEditingNote(false);
        setNoteDraft(note ?? "");
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
  }, [editingNote, note, onClose]);

  useEffect(() => {
    if (editingNote) noteInputRef.current?.focus();
  }, [editingNote]);

  function submitNote() {
    const next = noteDraft.trim();
    if (!next) return;
    onSaveNote?.(next);
  }

  if (typeof document === "undefined") return null;
  const width = Math.min(
    editingNote
      ? 470
      : onAskInChat && onAskHere
          ? highlighted
            ? 420
            : 390
          : highlighted
            ? 250
            : 220,
    window.innerWidth - 20,
  );
  const left = Math.max(
    10,
    Math.min(window.innerWidth - width - 10, selection.anchor.left),
  );
  const top = Math.max(10, selection.anchor.top - (editingNote ? 166 : 50));
  return createPortal(
    <div
      ref={menuRef}
      // Above the inline answer popovers: the same menu serves text
      // selected inside an "Ask here" answer, and under it the menu is dead.
      className="bb-chat-selection-menu fixed z-[130] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 shadow-[0_12px_34px_rgba(45,48,40,0.2)]"
      style={embedded ? { position: "relative", left: 0, top: 0, width } : { left, top, width }}
      role="toolbar"
      aria-label="Selected text actions"
      onPointerDown={(event: ReactPointerEvent) => event.preventDefault()}
    >
      <div className="flex items-center">
        <div
          className="flex shrink-0 items-center gap-0.5 px-1"
          role="group"
          aria-label="Highlight color"
        >
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
        {onSaveNote ? (
          <>
            <span className="my-1 h-5 w-px bg-[var(--line)]" aria-hidden />
            <button
              type="button"
              onClick={() => {
                setNoteDraft(note ?? "");
                setEditingNote(true);
              }}
              aria-label={note ? "Edit note" : "Add note"}
              title={note ? "Edit note" : "Add a note to selected text"}
              className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--ink-heading)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97]"
            >
              {note ? "Edit note" : "Add note"}
            </button>
          </>
        ) : null}
        {onAskInChat && onAskHere ? (
          <>
            <span className="my-1 h-5 w-px bg-[var(--line)]" aria-hidden />
            <button
              type="button"
              onClick={onAskInChat}
              className="flex-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--ink-heading)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--paper-strong)] active:scale-[0.97]"
            >
              Ask in chat
            </button>
            <span className="my-1 h-5 w-px bg-[var(--line)]" aria-hidden />
            <button
              type="button"
              onClick={onAskHere}
              className="flex-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--ink-heading)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--selection-yellow)] active:scale-[0.97]"
            >
              Ask here
            </button>
          </>
        ) : null}
      </div>
      {onComment && <button type="button" onClick={onComment} className="w-full border-t border-[var(--line)] px-3 py-2 text-left text-xs font-medium text-[var(--ink-heading)] hover:bg-[var(--paper-strong)]">Comment in Organization</button>}
      {editingNote && onSaveNote ? (
        <div data-enter-submit-scope className="border-t border-[var(--line)] px-2 pb-2 pt-2" role="group" aria-label="Note editor">
          <textarea
            ref={noteInputRef}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.repeat && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitNote();
              }
            }}
            maxLength={MAX_CHAT_HIGHLIGHT_NOTE_LENGTH}
            rows={3}
            placeholder="Write a note about this text…"
            aria-label="Note about selected text"
            className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm leading-5 text-[var(--ink-heading)] outline-none focus:border-[var(--botanical)]"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            {note ? (
              <button
                type="button"
                onClick={() => onSaveNote(null)}
                className="mr-auto rounded-md px-2 py-1 text-xs font-medium text-[var(--danger-hover)] hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]"
              >
                Remove note
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setEditingNote(false);
                setNoteDraft(note ?? "");
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
            >
              Cancel
            </button>
            <button data-enter-submit
              type="button"
              onClick={submitNote}
              disabled={!noteDraft.trim()}
              className="rounded-md bg-[var(--botanical)] px-3 py-1 text-xs font-medium text-[var(--paper-raised)] hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
            >
              Save note
            </button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

// Mirrors the delimiters a captured selection carries for formulas (see
// mathWidgetText) with Pandoc's rules for a text dollar: no space just inside
// either delimiter and no digit after the closing one, so "$5 and $10" stays prose.
const QUOTE_MATH_PATTERN =
  /\$\$((?:\\.|[^$\\])+?)\$\$|\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$(?!\d)/gs;

type QuotePart = string | { html: string };

function quoteParts(quote: string): QuotePart[] {
  const parts: QuotePart[] = [];
  let cursor = 0;
  for (const match of quote.matchAll(QUOTE_MATH_PATTERN)) {
    const display = match[1] !== undefined;
    const tex = display ? match[1] : match[2];
    if (match.index > cursor) parts.push(quote.slice(cursor, match.index));
    // Display formulas stay in the text line (previews are one or two lines)
    // but keep display-style sizing so fractions and sums remain legible.
    parts.push({
      html: katex.renderToString(display ? `\\displaystyle ${tex}` : tex, {
        displayMode: false,
        throwOnError: false,
      }),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < quote.length) parts.push(quote.slice(cursor));
  return parts;
}

/** A selection excerpt with the formulas it captured rendered, not as raw TeX. */
export function SelectionQuoteText({ quote }: { quote: string }) {
  const parts = useMemo(() => quoteParts(quote), [quote]);
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <span
            key={index}
            className="bb-selection-quote-math"
            // KaTeX output is its own escaped markup for the TeX it was given.
            dangerouslySetInnerHTML={{ __html: part.html }}
          />
        ),
      )}
    </>
  );
}

export function SelectionComposerContext({
  selection,
  onCancel,
  widthClassName = "max-w-3xl",
  attached = false,
}: {
  selection: Pick<ChatTextSelectionReference, "mode" | "quote">;
  onCancel: () => void;
  widthClassName?: string;
  attached?: boolean;
}) {
  return (
    <div
      data-composer-selection=""
      data-composer-selection-attached={attached ? "" : undefined}
      role="group"
      aria-label={selection.mode === "inline" ? "Ask here context" : "Ask in chat context"}
      className={`mx-auto flex w-full ${attached ? "max-w-none" : widthClassName} items-start gap-2 px-3 py-2 text-xs ${attached ? "bb-composer-selection-attached" : "mb-2 rounded-xl border shadow-sm"} ${
        selection.mode === "inline"
          ? "border-[var(--selection-yellow-line)] bg-[var(--selection-yellow)]"
          : "border-[var(--line)] bg-[var(--paper-raised)]"
      }`}
    >
      <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
      <p className="min-w-0 flex-1 line-clamp-2 break-words leading-5 text-[var(--ink-muted)]">
        <SelectionQuoteText quote={selection.quote} />
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="-my-0.5 shrink-0 rounded-full p-1 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--paper-strong)_72%,transparent)] hover:text-[var(--ink-heading)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
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
  selection: Pick<ChatTextSelectionReference, "quote">;
}) {
  return (
    <div className="mb-1 flex max-w-xl items-start gap-2 px-1 text-left text-xs leading-5 text-[var(--ink-muted)]">
      <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
      <span className="line-clamp-3">
        <span className="font-medium text-[var(--ink-heading)]">Selected text: </span>
        “<SelectionQuoteText quote={selection.quote} />”
      </span>
    </div>
  );
}

const NO_ANSWER_ANNOTATIONS: readonly ChatTextAnnotation[] = [];
const INLINE_ANSWER_LAYOUT_EVENT = "breadboard:inline-answer-layout";

function raiseInlineAnswer(popover: HTMLElement) {
  document.querySelectorAll<HTMLElement>(".bb-inline-answer").forEach(card => {
    card.style.zIndex = card.dataset.inlineAnswerLayer ?? "25";
  });
  popover.style.zIndex = String(Number(popover.dataset.inlineAnswerLayer ?? 25) + 1);
}

export function InlineSelectionAnswerPopover({
  anchor,
  selection,
  notificationSelectionId = selection?.id,
  draftId = selection?.id ?? notificationSelectionId,
  persistDraft = true,
  question,
  questionAttachments,
  answer,
  reasoning,
  progressNotes,
  artifacts,
  pending,
  usage,
  responseDurationMs,
  responseCompletedAt,
  verification,
  startedAt,
  answerMessageId,
  starMessageId = answerMessageId,
  conversationId,
  canStar = true,
  onReply,
  annotations,
  onSelection,
  onOpenAnnotation,
  onClose,
  onDelete,
  onStop,
  onAskAgain,
  embedded,
  questionDisabled = false,
  deleteDisabled = false,
  initialEditing = true,
  note,
}: {
  anchor: FloatingAnchorRect;
  /** Resolve the painted excerpt again after scrolling or transcript reflow. */
  selection?: Pick<ChatTextSelectionReference, "id" | "sourceMessageId" | "wholeMessage">;
  notificationSelectionId?: string;
  /** Stable highlight identity, even when a retry replaces the request id. */
  draftId?: string;
  /** Temporary chats keep drafts only in memory. */
  persistDraft?: boolean;
  question?: string;
  questionAttachments?: readonly ChatAttachment[];
  answer?: string;
  reasoning?: string;
  progressNotes?: string[];
  pending: boolean;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  responseCompletedAt?: string;
  verification?: VerificationSummary;
  startedAt?: string;
  /**
   * The answer's own message id. When present (with the two handlers below)
   * the answer body is selectable like any transcript message, so a follow-up
   * can be highlighted or asked about inside an answer — recursively.
   */
  answerMessageId?: string;
  /** Durable/client turn identity; selection IDs can be presentation-only. */
  starMessageId?: string;
  conversationId?: string | null;
  /** Response-owned artifacts, resolved by the host's conversation scope. */
  artifacts?: ReactNode;
  canStar?: boolean;
  onReply?: (selection: ChatTextSelectionReference, anchor: FloatingAnchorRect) => void;
  annotations?: readonly ChatTextAnnotation[];
  onSelection?: (selection: ChatTextSelectionCandidate) => void;
  onOpenAnnotation?: (annotationId: string, anchor: FloatingAnchorRect) => void;
  onClose: () => void;
  onDelete: () => void;
  onStop?: () => void;
  onAskAgain?: (question: string, attachments: readonly ChatAttachment[]) => void;
  /** The native host supplies the webpage's available size and moves the card. */
  embedded?: { width: number; height: number; onSize: (width: number, height: number) => void; onMove: (dx: number, dy: number) => void };
  questionDisabled?: boolean;
  deleteDisabled?: boolean;
  initialEditing?: boolean;
  note?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scheduleLayoutRef = useRef<() => void>(() => {});
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  useEffect(() => {
    if (!actionsOpen) return;
    const frame = requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLButtonElement>('.bb-inline-answer-menu [role="menuitem"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [actionsOpen]);
  const manualPositionRef = useRef<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  // New questions open ready to type. Existing questions become drafts only
  // on edit, so an arriving answer never overwrites the person's typing.
  const { draft, setDraft, draftAttachments, setDraftAttachments, clearDraft } = useInlineQuestionDraft(
    draftId,
    initialEditing && !question && !answer && !pending && onAskAgain ? "" : null,
    persistDraft,
  );
  const editing = draft !== null;
  const [submittedAttachments, setSubmittedAttachments] = useState<readonly ChatAttachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [uploadingImages, setUploadingImages] = useState(0);
  const pasteSessionRef = useRef({ generation: 0, pending: 0 });
  const savedAttachments = questionAttachments ?? submittedAttachments;
  const attachedFiles = draftAttachments ?? savedAttachments;
  const canSendQuestion = !questionDisabled && !pending && Boolean(onAskAgain) && uploadingImages === 0 &&
    Boolean((draft ?? "").trim() || attachedFiles.length);
  useEffect(() => {
    const session = pasteSessionRef.current;
    return () => { session.generation++; };
  }, []);

  function endQuestionEdit() {
    pasteSessionRef.current.generation++;
    pasteSessionRef.current.pending = 0;
    setUploadingImages(0);
    setAttachmentStatus("");
    clearDraft();
  }

  async function pasteQuestionImages(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = imageFilesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    if (pending || !onAskAgain) return;
    const session = pasteSessionRef.current;
    const generation = session.generation;
    session.pending++;
    setUploadingImages(session.pending);
    setAttachmentStatus("");
    try {
      const result = await extractChatAttachments(files);
      if (pasteSessionRef.current.generation !== generation) return;
      setDraftAttachments(current => [...(current ?? savedAttachments), ...result.attachments]);
      setAttachmentStatus([...result.errors, ...result.warnings].join(" "));
    } finally {
      if (pasteSessionRef.current.generation === generation) {
        session.pending--;
        setUploadingImages(session.pending);
      }
    }
  }

  function attachmentPreviews(files: readonly ChatAttachment[], editable: boolean) {
    return <InlineQuestionAttachments files={files} onRemove={editable
      ? index => setDraftAttachments(current => (current ?? savedAttachments).filter((_, item) => item !== index))
      : undefined} />;
  }
  const selectionId = selection?.id;
  const sourceMessageId = selection?.sourceMessageId;

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (embedded) {
      let frame = 0; let lastSize = "";
      const measure = () => {
        frame = 0;
        const expanded = Boolean(popover.querySelector(".bb-inline-artifact-list, .bb-viz-renderer, .bb-viz-placeholder"));
        const width = Math.max(1, Math.min(expanded ? 960 : 400, embedded.width - 32));
        const maxHeight = Math.max(1, Math.min(expanded ? embedded.height - 32 : 520, embedded.height - 32));
        // The native view already positions the card over the website. Keep
        // its local geometry independent of the application document's flow.
        Object.assign(popover.style, { position: "fixed", left: "16px", top: "16px", width: `${width}px`, maxHeight: `${maxHeight}px`, visibility: "visible" });
        const height = Math.ceil(popover.getBoundingClientRect().height);
        const size = `${width}:${height}`;
        if (size !== lastSize) { lastSize = size; embedded.onSize(width + 32, height + 32); }
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
      const observer = new ResizeObserver(schedule);
      observer.observe(popover); if (contentRef.current) observer.observe(contentRef.current);
      scheduleLayoutRef.current = schedule; measure();
      return () => { cancelAnimationFrame(frame); observer.disconnect(); scheduleLayoutRef.current = () => {}; };
    }
    let frame = 0;
    let disposed = false;
    let releaseView: (() => void) | undefined;
    let lastGeometry = "";
    let lastSourceRect = { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom };
    let parentAnchor: { card: HTMLElement; x: number; y: number; width: number; height: number } | undefined;
    const selector = selectionId && sourceMessageId
      ? `[data-chat-selectable-message="${CSS.escape(sourceMessageId)}"] [data-chat-selection-id="${CSS.escape(selectionId)}"], [data-chat-selection-source="${CSS.escape(sourceMessageId)}"][data-chat-selection-id="${CSS.escape(selectionId)}"]`
      : null;
    const source = selector ? document.querySelector(selector) ?? document.querySelector(
      `[data-chat-selectable-message="${CSS.escape(sourceMessageId!)}"]`,
    ) : null;
    let marks = selector ? Array.from(document.querySelectorAll<HTMLElement>(selector)) : [];
    let marksDirty = false;
    const markSource = () => marks[0]?.closest("[data-chat-selectable-message], [data-pdf-highlight-host]") ?? source;
    // Body portals escape the terminal, PDF, and Quartz assistant stacking contexts.
    // PDF page highlights also need to clear the assistant beside the page.
    // Keep answers above those panels (40), below response menus (50), and let nested cards
    // inherit that layer while other chat surfaces retain their own ordering.
    popover.dataset.inlineAnswerLayer = source?.closest("[data-terminal-dock], [data-garden-assistant-panel], [data-pdf-assistant-panel], [data-pdf-highlight-host]")
      ? "45"
      : source?.closest<HTMLElement>(".bb-inline-answer")?.dataset.inlineAnswerLayer ?? "25";
    raiseInlineAnswer(popover);
    const setStyle = (property: "width" | "maxHeight" | "left" | "top" | "visibility", value: string) => {
      if (popover.style[property] !== value) popover.style[property] = value;
    };
    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(place);
    };
    const place = () => {
      frame = 0;
      // Artifacts may arrive after the answer. ResizeObserver schedules this
      // again when their renderer mounts or the preview reports a new height.
      const expanded = Boolean(popover.querySelector("[data-inline-visualizer]"));
      // A clicked rect is only a snapshot. The actual mark can move when the
      // composer focuses, the chat scrolls, or an earlier answer grows.
      // Scrolling changes rectangles, not the identity of the marked spans.
      // Searching a math-heavy transcript on every frame dominated popup layout.
      if (selector && (marksDirty || marks.length === 0 || marks.some(mark => !mark.isConnected))) {
        marks = Array.from(document.querySelectorAll<HTMLElement>(selector));
        marksDirty = false;
      }
      const rects = marks.flatMap(mark => Array.from(mark.getClientRects()))
        .filter(rect => rect.width > 0 && rect.height > 0);
      const currentRect = selector ? (rects.length ? {
        left: Math.min(...rects.map(rect => rect.left)),
        right: Math.max(...rects.map(rect => rect.right)),
        top: Math.min(...rects.map(rect => rect.top)),
        bottom: Math.max(...rects.map(rect => rect.bottom)),
      } : null) : anchor;
      // A transcript refresh or virtualizer can briefly remove the source
      // mark. The question still owns its popup: retain its last anchor and
      // reattach when the mark returns, rather than hiding a running answer.
      if (currentRect) lastSourceRect = currentRect;
      let rect = currentRect ?? lastSourceRect;
      const sourceCard = marks[0]?.closest<HTMLElement>(".bb-inline-answer");
      if (sourceCard && rect && parentAnchor?.card !== sourceCard) {
        const parentRect = sourceCard.getBoundingClientRect();
        parentAnchor = { card: sourceCard, x: rect.left - parentRect.left, y: rect.top - parentRect.top,
          width: rect.right - rect.left, height: rect.bottom - rect.top };
      }
      // A nested card follows its parent's window, not text moving inside it.
      // Reading an earlier answer must not move or hide another open answer.
      if (parentAnchor?.card.isConnected) {
        const parentRect = parentAnchor.card.getBoundingClientRect();
        const left = parentRect.left + Math.min(parentAnchor.x, Math.max(0, parentRect.width - 24));
        const top = parentRect.top + Math.min(parentAnchor.y, Math.max(0, parentRect.height - 24));
        rect = { left, top, right: left + parentAnchor.width, bottom: top + parentAnchor.height };
      }
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const navBottom = Array.from(document.querySelectorAll<HTMLElement>(".breadboard-flower-navbar"))
        .map(nav => nav.getBoundingClientRect())
        .filter(nav => nav.width > 0 && nav.height > 0 && nav.bottom > viewportTop && nav.top <= viewportTop + 80)
        .reduce((bottom, nav) => Math.max(bottom, nav.bottom), viewportTop);
      const minTop = Math.max(viewportTop + 16, navBottom + 14);
      const composerTop = Array.from(document.querySelectorAll<HTMLElement>(".bb-composer-overlay"))
        .map(composer => composer.getBoundingClientRect())
        .filter(composer => composer.width > 0 && composer.height > 0 && composer.top > viewportTop)
        .reduce((top, composer) => Math.min(top, composer.top), viewportBottom);
      const maxBottom = Math.max(minTop, composerTop - 16);
      const availableHeight = Math.max(0, maxBottom - minTop);
      let visible = Boolean(rect && rect.bottom > viewportTop && rect.top < viewportBottom && availableHeight >= 120);
      if (parentAnchor) visible = visible && parentAnchor.card.isConnected && parentAnchor.card.style.visibility !== "hidden";
      // A virtualized/overflowing transcript may clip a mark while it still
      // has viewport coordinates. Hide its card until the excerpt returns.
      for (let parent = parentAnchor || !currentRect ? null : marks[0]?.parentElement; visible && parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const clip = parent.getBoundingClientRect();
          visible = rect!.bottom > clip.top && rect!.top < clip.bottom;
        }
      }
      setStyle("visibility", visible ? "visible" : "hidden");
      if (visible && notificationSelectionId && !releaseView) {
        releaseView = registerInlineSelectionNotificationView(notificationSelectionId);
      } else if (!visible && releaseView) {
        releaseView();
        releaseView = undefined;
      }
      if (rect && visible) {
        // Chat-owned cards stay within a visible browser drawer; webpage cards use their native host.
        const drawer = document.querySelector<HTMLElement>(".browser-terminal-drawer[data-open='true']")?.getBoundingClientRect();
        const boundaryLeft = Math.max(0, drawer?.left ?? 0);
        const boundaryRight = drawer ? boundaryLeft + drawer.width : window.innerWidth;
        const width = Math.min(Math.min(expanded ? 960 : 400, window.innerWidth - 32), boundaryRight - boundaryLeft - 32);
        const maxHeight = Math.min(expanded ? availableHeight : 520, availableHeight);
        const left = Math.max(boundaryLeft + 16, Math.min(boundaryRight - width - 16, rect.left - 24));
        const below = Math.max(0, maxBottom - rect.bottom - 14);
        const above = Math.max(0, rect.top - minTop - 14);
        const openBelow = below >= 260 || below >= above;
        const precedingCards = Array.from(document.querySelectorAll<HTMLElement>(".bb-inline-answer"));
        const occupied = precedingCards.slice(0, precedingCards.indexOf(popover))
          .filter(card => card.style.visibility !== "hidden")
          .map(card => card.getBoundingClientRect());
        if (manualPositionRef.current) {
          // Keep the chosen width when moving a narrow card; don't rewrap it on every pointer event.
          setStyle("maxHeight", `${maxHeight}px`);
          if (expanded) setStyle("width", `${width}px`);
          setStyle("left", `${Math.max(boundaryLeft + 16, Math.min(boundaryRight - popover.offsetWidth - 16, manualPositionRef.current.left))}px`);
          setStyle("top", `${Math.max(minTop, Math.min(maxBottom - popover.offsetHeight, manualPositionRef.current.top))}px`);
          if (popover.offsetWidth > width) setStyle("width", `${width}px`);
        } else if (occupied.length) {
          const placement = placeNestedInlineAnswer({ anchor: rect,
            bounds: { left: boundaryLeft + 16, top: minTop, right: boundaryRight - 16, bottom: maxBottom },
            occupied, desiredHeight: popover.scrollHeight + 2,
            desiredWidth: width, maxHeight, minimumWidth: expanded ? 640 : 340 });
          setStyle("width", `${placement.width}px`);
          setStyle("maxHeight", `${placement.maxHeight}px`);
          setStyle("left", `${placement.left}px`);
          setStyle("top", `${Math.max(minTop, Math.min(maxBottom - popover.offsetHeight, placement.top))}px`);
        } else {
          setStyle("width", `${width}px`);
          // A visualizer can use the full height; shift it above the anchor
          // when necessary instead of squeezing its controls below the text.
          setStyle("maxHeight", `${expanded ? maxHeight : Math.min(maxHeight, openBelow ? below : above)}px`);
          setStyle("left", `${left}px`);
          setStyle("top", `${Math.max(minTop, Math.min(maxBottom - popover.offsetHeight,
            openBelow ? rect.bottom + 14 : rect.top - popover.offsetHeight - 14))}px`);
        }
      }
      const geometry = [popover.style.visibility, popover.style.left, popover.style.top,
        popover.offsetWidth, popover.offsetHeight].join(":");
      if (geometry !== lastGeometry) {
        lastGeometry = geometry;
        window.dispatchEvent(new CustomEvent(INLINE_ANSWER_LAYOUT_EVENT, { detail: popover }));
      }
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".bb-inline-answer")) return;
      schedule();
    };
    const onOtherLayout = (event: Event) => {
      const changed = (event as CustomEvent<HTMLElement>).detail;
      if (!changed || (changed !== popover &&
          changed.compareDocumentPosition(popover) & Node.DOCUMENT_POSITION_FOLLOWING)) schedule();
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(popover);
    if (contentRef.current) resizeObserver.observe(contentRef.current);
    document.querySelectorAll(".bb-composer-overlay, .breadboard-flower-navbar").forEach(element => resizeObserver.observe(element));
    // Observe the transcript's content as well as its viewport: an earlier
    // streaming answer can move this mark without resizing the mark itself.
    for (let parent = source?.parentElement; parent && parent !== document.body && !parent.closest(".bb-inline-answer"); parent = parent.parentElement) {
      resizeObserver.observe(parent);
      // Content before the source can move its mark while a fixed-height
      // scroller and the source's own dimensions remain unchanged.
      for (let sibling = parent.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        resizeObserver.observe(sibling);
      }
    }
    const transcript = source?.closest(".bb-chat-scroller") ?? source?.closest("[data-chat-selectable-message]")?.parentElement ??
      source?.closest("[data-pdf-highlight-host]")?.parentElement?.parentElement;
    const mutations = new MutationObserver(records => {
      const owner = markSource();
      if (records.some(record => record.type === "childList" && owner?.contains(record.target))) marksDirty = true;
      if (records.some(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return !element?.closest(".bb-inline-answer");
      })) schedule();
    });
    if (transcript && !transcript.closest(".bb-inline-answer")) {
      mutations.observe(transcript, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const drawer = document.querySelector<HTMLElement>(".browser-terminal-drawer[data-open='true']");
    if (drawer) { resizeObserver.observe(drawer); drawer.addEventListener("transitionend", schedule); }
    window.addEventListener(INLINE_ANSWER_LAYOUT_EVENT, onOtherLayout);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    scheduleLayoutRef.current = schedule;
    place();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      scheduleLayoutRef.current = () => {};
      resizeObserver.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
      drawer?.removeEventListener("transitionend", schedule);
      window.removeEventListener(INLINE_ANSWER_LAYOUT_EVENT, onOtherLayout);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      releaseView?.();
      window.dispatchEvent(new Event(INLINE_ANSWER_LAYOUT_EVENT));
    };
  }, [anchor, selectionId, sourceMessageId, notificationSelectionId, embedded]);

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
      // Its click handler toggles the answer. Closing on pointerdown first
      // would make that same click immediately reopen it.
      if (target instanceof Element && target.closest('[data-chat-selection-kind="answer"]')) return;
      if (target instanceof Element && target.closest("[data-assistant-response-overlay]")) return;
      if (target instanceof Element && target.closest(".bb-artifact-dock, .bb-viewer-overlay")) return;
      // The selection menu floats above this popover for text selected inside
      // the answer; choosing an action there must not tear down the popover it
      // is acting on.
      if (
        target instanceof Element &&
        target.closest(".bb-chat-selection-menu, .bb-inline-answer, .bb-composer-overlay")
      ) {
        return;
      }
      onClose();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // The action menu/evidence panel owns the first Escape, before its answer.
      if (document.querySelector("[data-assistant-response-overlay]") ||
          document.querySelector(".bb-artifact-dock, .bb-viewer-overlay") ||
          document.querySelector('.bb-inline-answer [aria-label="More response actions"][aria-expanded="true"]')) return;
      // Dismissal keeps the draft; only Cancel, Delete, or sending discards it.
      onClose();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editing || !editor) return;
    editor.style.height = "auto";
    editor.style.height = `${Math.min(160, Math.max(66, editor.scrollHeight))}px`;
  }, [draft, editing]);

  function submitEdit() {
    const next = (draft ?? "").trim() || attachmentOnlyMessageText(attachedFiles);
    if (!next || !onAskAgain || questionDisabled || pending || pasteSessionRef.current.pending) return;
    const attachments = [...attachedFiles];
    const attachmentsChanged = draftAttachments !== null &&
      (draftAttachments.length !== savedAttachments.length || draftAttachments.some((file, index) => file !== savedAttachments[index]));
    endQuestionEdit();
    // An unchanged question is a cancelled edit, not a reason to spend a turn.
    if (next === question && !attachmentsChanged) return;
    setSubmittedAttachments(attachments);
    onAskAgain(next, attachments);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popoverRef}
      className="bb-inline-answer fixed z-[25] overflow-y-auto overscroll-contain rounded-2xl border p-4 text-sm text-[var(--ink)]"
      style={{ visibility: "hidden" }}
      role="dialog"
      aria-label="Answer about highlighted text"
      onPointerDownCapture={() => {
        if (popoverRef.current) raiseInlineAnswer(popoverRef.current);
      }}
    >
      <div ref={contentRef}>
      <div className="bb-inline-answer-toolbar -mx-2 -mt-2 mb-1 grid grid-cols-[28px_minmax(0,1fr)_28px] items-center">
      <button ref={actionsRef} type="button" aria-label="More highlight actions" aria-haspopup="menu" aria-expanded={actionsOpen}
        title="More highlight actions" onClick={() => setActionsOpen(open => !open)}
        className="bb-inline-answer-control grid h-7 w-7 place-items-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
        <Ellipsis className="h-4 w-4" aria-hidden />
      </button>
      {actionsOpen && <ViewportPopover anchorRef={actionsRef} ariaLabel="Highlight actions" portal={false}
        className="bb-inline-answer-menu fixed z-[140] w-44 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 text-xs text-[var(--ink)] shadow-lg"
        onClose={() => setActionsOpen(false)}>
        <button type="button" role="menuitem" aria-label="Delete highlight" disabled={deleteDisabled}
          onClick={() => { setActionsOpen(false); endQuestionEdit(); onDelete(); }}
          className="w-full rounded-lg px-3 py-2 text-left text-[var(--danger-hover)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)] disabled:opacity-45">
          Delete highlight
        </button>
      </ViewportPopover>}
      <button type="button" aria-label="Move answer" title="Drag to move this answer; use arrow keys to adjust"
        className="bb-inline-answer-control flex h-7 w-full touch-none cursor-grab items-center justify-center rounded-md text-[var(--ink-muted)] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
        onPointerDown={event => {
          if (event.button !== 0 || dragRef.current) return;
          event.preventDefault();
          const rect = popoverRef.current!.getBoundingClientRect();
          dragRef.current = { pointerId: event.pointerId, x: embedded ? event.screenX : event.clientX, y: embedded ? event.screenY : event.clientY, left: rect.left, top: rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (embedded) { embedded.onMove(event.screenX - drag.x, event.screenY - drag.y); drag.x = event.screenX; drag.y = event.screenY; return; }
          manualPositionRef.current = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
          scheduleLayoutRef.current();
        }}
        onPointerUp={event => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => { dragRef.current = null; }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const rect = popoverRef.current!.getBoundingClientRect();
          const step = event.shiftKey ? 40 : 10;
          if (embedded) { embedded.onMove(event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0,
            event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0); return; }
          manualPositionRef.current = { left: rect.left + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
            top: rect.top + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) };
          scheduleLayoutRef.current();
        }}>
        <span className="h-[3px] w-7 rounded-full bg-current opacity-30" aria-hidden />
      </button>
      <button type="button" aria-label="Close answer" title="Close answer" onClick={onClose}
        className="bb-inline-answer-control grid h-7 w-7 place-items-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
        <X className="h-4 w-4" aria-hidden />
      </button>
      </div>
      {note && <details aria-label="Saved highlight note" className="mb-2 border-b border-[var(--line)] pb-2 text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">Saved note</summary><p className="mt-2 whitespace-pre-wrap">{note}</p></details>}
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="bb-inline-answer-question min-w-0 flex-1">
            {attachmentPreviews(attachedFiles, true)}
              <textarea
                ref={editorRef}
                value={draft ?? ""}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={event => { void pasteQuestionImages(event); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitEdit();
                  }
                }}
                rows={2}
                placeholder="Ask a question…"
                className="w-full resize-none rounded-sm bg-transparent py-1 text-sm leading-[22px] text-[var(--ink-heading)] placeholder:text-[var(--ink-muted)] outline-none"
                aria-label="Edit question about highlighted text"
              />
            {uploadingImages > 0 || attachmentStatus ? <p role="status" className="mt-2 text-xs text-[var(--ink-muted)]">
              {uploadingImages > 0 ? "Adding image…" : attachmentStatus}
            </p> : null}
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { endQuestionEdit(); if (!question && !answer) onDelete(); }}
                disabled={deleteDisabled && !question && !answer}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3 text-sm font-medium text-[var(--ink-muted)] transition hover:text-[var(--ink-heading)]"
              >
                Cancel
              </button>
              <MetalSendButton
                variant="button"
                className="shrink-0"
                disabled={!canSendQuestion}
              >
              <button
                type="button"
                onClick={submitEdit}
                disabled={!canSendQuestion}
                className="inline-flex h-9 min-w-16 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-4 text-sm font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
              >
                {question ? "Ask again" : "Ask"}
              </button>
              </MetalSendButton>
            </div>
          </div>
        ) : question ? (
          // The question is the edit affordance: clicking it reopens the words
          // that were asked, and sending replaces the answer under them.
          <button
            type="button"
            onClick={() => setDraft(question)}
            disabled={!onAskAgain || questionDisabled}
            className="bb-inline-answer-question min-w-0 flex-1 py-1 text-left font-medium transition disabled:cursor-default"
            title={onAskAgain ? "Edit this question" : undefined}
            aria-label={onAskAgain ? "Edit this question" : undefined}
          >
            <p className="text-sm leading-[22px] text-[var(--ink-heading)]">{question}</p>
          </button>
        ) : !pending && !answer && onAskAgain ? (
          <button
            type="button"
            onClick={() => setDraft("")}
            disabled={questionDisabled}
            className="bb-inline-answer-question min-w-0 flex-1 py-1 text-left text-[var(--ink-heading)]"
          >
            Ask a question
          </button>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {!editing && <div className="flex shrink-0 items-center gap-1">
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
              onClick={() => onAskAgain?.(question, savedAttachments)}
              disabled={!onAskAgain || questionDisabled}
              className="bb-inline-answer-control grid h-7 w-7 place-items-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Ask this question again"
              title="Retry"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 6v5h-5M4 18v-5h5m9.7-3A7 7 0 0 0 6.1 7.1L4 11m16 2-2.1 3.9A7 7 0 0 1 5.3 14" />
              </svg>
            </button>
          ) : null}
        </div>}
      </div>
      {!editing ? attachmentPreviews(savedAttachments, false) : null}
      <div className={`[&:has(.bb-inline-artifact-list)_.bb-inline-answer-empty]:hidden ${question ? "mt-4" : "mt-1"}`}>
        {pending || answer || reasoning || progressNotes?.length ? (
          <ActivityPanel
            activities={[]}
            reasoning={reasoning}
            progressNotes={progressNotes}
            answerContent={answer}
            connection={pending ? "streaming" : "idle"}
            pendingPermission={null}
            onPermissionDecision={() => {}}
            usage={usage}
            responseDurationMs={responseDurationMs}
            responseStartedAt={startedAt}
            responseCompletedAt={responseCompletedAt}
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
        ) : pending || editing ? null : (
          <p className="bb-inline-answer-empty text-sm leading-6 text-[var(--ink-muted)]">
            {question
              ? "This highlight has no answer yet - retry to ask the question again."
              : "No question has been sent for this highlight."}
          </p>
        )}
        {!pending ? artifacts : null}
      </div>
      {!pending && answer?.trim() ? (
        <MessageActionsSlot
          conversationId={conversationId}
          messageId={starMessageId}
          canStar={canStar}
          onReply={answerMessageId && onReply ? () => {
            const body = popoverRef.current?.querySelector<HTMLElement>("[data-chat-selectable-message]");
            if (!body) return;
            const reply = wholeMessageReply(answerMessageId, answer, "inline");
            if (reply) onReply(reply, floatingRect(body.getBoundingClientRect()));
          } : undefined}
        >
          <AssistantMessageActions
            content={answer}
            responseStartedAt={startedAt}
            responseDurationMs={responseDurationMs}
            responseCompletedAt={responseCompletedAt}
            verification={verification}
          />
        </MessageActionsSlot>
      ) : null}
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
