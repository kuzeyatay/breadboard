"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import AssistantResponseMeta from "./assistant-response-meta";
import ChatMarkdown, { type ChatTextAnnotation } from "./chat-markdown";
import {
  chatTextSelectionDraft,
  type ChatTextSelectionReference,
} from "@/lib/chat-text-selection";
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

export function SelectableAssistantMarkdown({
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
        onTextAnnotationClick={(annotationId, anchor) =>
          onOpenAnnotation(annotationId, floatingRect(anchor))
        }
      />
    </div>
  );
}

export function ChatSelectionMenu({
  selection,
  onAskInChat,
  onAskHere,
  onClose,
}: {
  selection: ChatTextSelectionCandidate;
  onAskInChat: () => void;
  onAskHere: () => void;
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
  const width = 222;
  const left = Math.max(
    10,
    Math.min(window.innerWidth - width - 10, selection.anchor.left),
  );
  const top = Math.max(10, selection.anchor.top - 50);
  return createPortal(
    <div
      ref={menuRef}
      className="bb-chat-selection-menu fixed z-[120] flex overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1 shadow-[0_12px_34px_rgba(45,48,40,0.2)]"
      style={{ left, top, width }}
      role="toolbar"
      aria-label="Ask about selected text"
      onPointerDown={(event: ReactPointerEvent) => event.preventDefault()}
    >
      <button
        type="button"
        onClick={onAskInChat}
        className="flex-1 rounded-lg px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition hover:bg-[var(--paper-strong)]"
      >
        Ask in chat
      </button>
      <span className="my-1 w-px bg-[var(--line)]" aria-hidden />
      <button
        type="button"
        onClick={onAskHere}
        className="flex-1 rounded-lg px-3 py-2 text-xs font-medium text-[var(--ink-heading)] transition hover:bg-[var(--selection-yellow)]"
      >
        Ask here
      </button>
    </div>,
    document.body,
  );
}

export function SelectionComposerContext({
  selection,
  onCancel,
}: {
  selection: ChatTextSelectionReference;
  onCancel: () => void;
}) {
  return (
    <div
      className={`mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm ${
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

export function InlineSelectionAnswerPopover({
  anchor,
  question,
  answer,
  pending,
  usage,
  responseDurationMs,
  startedAt,
  onClose,
  onDelete,
}: {
  anchor: FloatingAnchorRect;
  question?: string;
  answer?: string;
  pending: boolean;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  startedAt?: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
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
        {question ? (
          <div className="bb-inline-answer-question neu-inset min-w-0 flex-1 rounded-2xl border px-4 py-3">
            <div className="flex items-start gap-2.5">
              <SelectionArrowIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--botanical)]" />
              <p className="text-sm leading-6 text-[var(--ink-heading)]">{question}</p>
            </div>
          </div>
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
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon rounded-full border p-2 text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
            aria-label="Close answer"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
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
            <ChatMarkdown content={answer} compact />
          </div>
        ) : pending ? null : (
          <p className="text-sm leading-6 text-[var(--ink-muted)]">
            Ask a question in the chat field to attach an answer to this highlight.
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
