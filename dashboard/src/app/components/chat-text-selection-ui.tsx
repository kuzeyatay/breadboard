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
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import { registerInlineSelectionNotificationView } from "@/lib/notification-view-presence";
import { placeNestedInlineAnswer } from "@/lib/inline-answer-placement";
import AssistantResponseMeta from "./assistant-response-meta";
import MetalSendButton from "./effects/metal-send-button";
import AssistantMessageActions, { MessageActionsSlot } from "./assistant-message-actions";
import type { VerificationSummary } from "@/lib/hermes/evidence";
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
  MAX_CHAT_HIGHLIGHT_NOTE_LENGTH,
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
  selection,
  highlighted,
  highlightColor,
  note,
  onHighlightColor,
  onRemoveHighlight,
  onSaveNote,
  onAskInChat,
  onAskHere,
  onClose,
}: {
  selection: ChatTextSelectionCandidate;
  highlighted: boolean;
  highlightColor?: ChatHighlightColor;
  note?: string;
  onHighlightColor: (color: ChatHighlightColor) => void;
  onRemoveHighlight: () => void;
  onSaveNote?: (note: string | null) => void;
  onAskInChat?: () => void;
  onAskHere?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const [editingNote, setEditingNote] = useState(Boolean(note));
  const [noteDraft, setNoteDraft] = useState(note ?? "");

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
      style={{ left, top, width }}
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
      {editingNote && onSaveNote ? (
        <div className="border-t border-[var(--line)] px-2 pb-2 pt-2" role="group" aria-label="Note editor">
          <textarea
            ref={noteInputRef}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
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
            <button
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
  question,
  answer,
  pending,
  usage,
  responseDurationMs,
  responseCompletedAt,
  verification,
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
  /** Resolve the painted excerpt again after scrolling or transcript reflow. */
  selection?: Pick<ChatTextSelectionReference, "id" | "sourceMessageId">;
  notificationSelectionId?: string;
  question?: string;
  answer?: string;
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
  annotations?: readonly ChatTextAnnotation[];
  onSelection?: (selection: ChatTextSelectionCandidate) => void;
  onOpenAnnotation?: (annotationId: string, anchor: FloatingAnchorRect) => void;
  onClose: () => void;
  onDelete: () => void;
  onStop?: () => void;
  onAskAgain?: (question: string) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scheduleLayoutRef = useRef<() => void>(() => {});
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const manualPositionRef = useRef<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  // `null` means "not editing". The question is copied into a draft only when
  // the person clicks it, so an arriving answer never overwrites their typing.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    let frame = 0;
    let disposed = false;
    let releaseView: (() => void) | undefined;
    let lastGeometry = "";
    let parentAnchor: { card: HTMLElement; x: number; y: number; width: number; height: number } | undefined;
    const selector = selection
      ? `[data-chat-selectable-message="${CSS.escape(selection.sourceMessageId)}"] [data-chat-selection-id="${CSS.escape(selection.id)}"]`
      : null;
    const source = selector ? document.querySelector(selector) : null;
    // Body portals escape the terminal's stacking context. Keep its answers
    // above the dock (40), below response menus (50), and let nested cards
    // inherit that layer while other chat surfaces retain their own ordering.
    popover.dataset.inlineAnswerLayer = source?.closest("[data-terminal-dock]")
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
      // A clicked rect is only a snapshot. The actual mark can move when the
      // composer focuses, the chat scrolls, or an earlier answer grows.
      const marks = selector ? Array.from(document.querySelectorAll<HTMLElement>(selector)) : [];
      const rects = marks.flatMap(mark => Array.from(mark.getClientRects()))
        .filter(rect => rect.width > 0 && rect.height > 0);
      let rect = selector ? (rects.length ? {
        left: Math.min(...rects.map(rect => rect.left)),
        right: Math.max(...rects.map(rect => rect.right)),
        top: Math.min(...rects.map(rect => rect.top)),
        bottom: Math.max(...rects.map(rect => rect.bottom)),
      } : null) : anchor;
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
      for (let parent = parentAnchor ? null : marks[0]?.parentElement; visible && parent; parent = parent.parentElement) {
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
        const width = Math.min(580, window.innerWidth - 32);
        const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left - 24));
        const below = Math.max(0, maxBottom - rect.bottom - 14);
        const above = Math.max(0, rect.top - minTop - 14);
        const openBelow = below >= 260 || below >= above;
        const precedingCards = Array.from(document.querySelectorAll<HTMLElement>(".bb-inline-answer"));
        const occupied = precedingCards.slice(0, precedingCards.indexOf(popover))
          .filter(card => card.style.visibility !== "hidden")
          .map(card => card.getBoundingClientRect());
        if (manualPositionRef.current) {
          // Keep the chosen width when moving a narrow card; don't rewrap it on every pointer event.
          setStyle("maxHeight", `${Math.min(520, availableHeight)}px`);
          setStyle("left", `${Math.max(16, Math.min(window.innerWidth - popover.offsetWidth - 16, manualPositionRef.current.left))}px`);
          setStyle("top", `${Math.max(minTop, Math.min(maxBottom - popover.offsetHeight, manualPositionRef.current.top))}px`);
          if (popover.offsetWidth > width) setStyle("width", `${width}px`);
        } else if (occupied.length) {
          const placement = placeNestedInlineAnswer({ anchor: rect,
            bounds: { left: 16, top: minTop, right: window.innerWidth - 16, bottom: maxBottom },
            occupied, desiredHeight: popover.scrollHeight + 2 });
          setStyle("width", `${placement.width}px`);
          setStyle("maxHeight", `${placement.maxHeight}px`);
          setStyle("left", `${placement.left}px`);
          setStyle("top", `${Math.max(minTop, Math.min(maxBottom - popover.offsetHeight, placement.top))}px`);
        } else {
          setStyle("width", `${width}px`);
          setStyle("maxHeight", `${Math.min(520, availableHeight, openBelow ? below : above)}px`);
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
    }
    const transcript = source?.closest(".bb-chat-scroller") ?? source?.closest("[data-chat-selectable-message]")?.parentElement;
    const mutations = new MutationObserver(records => {
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
      window.removeEventListener(INLINE_ANSWER_LAYOUT_EVENT, onOtherLayout);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      releaseView?.();
      window.dispatchEvent(new Event(INLINE_ANSWER_LAYOUT_EVENT));
    };
  }, [anchor, selection?.id, selection?.sourceMessageId, notificationSelectionId]);

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
      if (target instanceof Element && target.closest("[data-assistant-response-overlay]")) return;
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
      if (event.key !== "Escape") return;
      // The action menu/evidence panel owns the first Escape, before its answer.
      if (document.querySelector("[data-assistant-response-overlay]") ||
          document.querySelector('.bb-inline-answer [aria-label="More response actions"][aria-expanded="true"]')) return;
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
  return createPortal(
    <div
      ref={popoverRef}
      className="bb-inline-answer neu-popover fixed z-[25] overflow-y-auto overscroll-contain rounded-[1.4rem] border p-5 text-sm text-[var(--ink)] sm:p-6"
      style={{ visibility: "hidden" }}
      role="dialog"
      aria-label="Answer about highlighted text"
      onPointerDownCapture={() => {
        if (popoverRef.current) raiseInlineAnswer(popoverRef.current);
      }}
    >
      <div ref={contentRef}>
      <button type="button" aria-label="Move answer" title="Drag to move this answer; use arrow keys to adjust"
        className="mb-2 flex h-5 w-full touch-none cursor-grab items-center justify-center rounded-md text-[var(--ink-muted)] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
        onPointerDown={event => {
          if (event.button !== 0 || dragRef.current) return;
          event.preventDefault();
          const rect = popoverRef.current!.getBoundingClientRect();
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
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
          manualPositionRef.current = { left: rect.left + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
            top: rect.top + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) };
          scheduleLayoutRef.current();
        }}>
        <span className="h-1 w-9 rounded-full bg-current opacity-35" aria-hidden />
      </button>
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
              <MetalSendButton
                variant="button"
                disabled={!onAskAgain || !(draft ?? "").trim()}
              >
              <button
                type="button"
                onClick={submitEdit}
                disabled={!onAskAgain || !(draft ?? "").trim()}
                className="rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 py-1 text-xs font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)]"
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
        ) : !pending && !answer && onAskAgain ? (
          <button
            type="button"
            onClick={() => setDraft("")}
            className="bb-inline-answer-question neu-inset min-w-0 flex-1 rounded-2xl border px-4 py-3 text-left text-[var(--ink-heading)]"
          >
            Ask a question
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
              : "No question has been sent for this highlight."}
          </p>
        )}
      </div>
      {!pending && answer?.trim() ? (
        <MessageActionsSlot>
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
