"use client";

import { useCallback, useMemo, useState, type RefObject } from "react";
import {
  isChatHighlightColor,
  normalizeChatHighlightNote,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import { chatTextSelectionsOverlap, normalizeChatTextSelectionReference, type ChatTextSelectionReference } from "@/lib/chat-text-selection";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import type { ChatTextAnnotation } from "./chat-markdown";
import { ChatSelectionMenu, InlineSelectionAnswerPopover, type ChatTextSelectionCandidate, type FloatingAnchorRect } from "./chat-text-selection-ui";
import { TextHighlightSaveStatus } from "./text-highlight-save-status";
import { useTextHighlights } from "./use-text-highlights";

export interface SelectableChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  textSelection?: ChatTextSelectionReference;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  responseCompletedAt?: string;
  verification?: VerificationSummary;
  createdAt?: string;
}

type Highlight = ChatTextSelectionReference & { color?: ChatHighlightColor; note?: string };
type OpenAnswer = { id: string; anchor: FloatingAnchorRect };
const EMPTY_ANNOTATIONS: readonly ChatTextAnnotation[] = [];

function normalizeSelections(value: unknown): ChatTextSelectionReference[] {
  return Array.isArray(value) ? value.flatMap(item => {
    const selection = normalizeChatTextSelectionReference(item);
    return selection ? [selection] : [];
  }) : [];
}

function normalizeHighlights(value: unknown): Highlight[] {
  return Array.isArray(value) ? value.flatMap(item => {
    const selection = normalizeChatTextSelectionReference(item);
    if (!selection || !item || typeof item !== "object") return [];
    const note = normalizeChatHighlightNote("note" in item ? item.note : undefined);
    const color = "color" in item && isChatHighlightColor(item.color) ? item.color : undefined;
    if (!color && !note) return [];
    return [{ ...selection, ...(color ? { color } : {}), ...(note ? { note } : {}) }];
  }) : [];
}

function normalizeDeleted(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function selectionReference(candidate: ChatTextSelectionCandidate, mode: "chat" | "inline"): ChatTextSelectionReference {
  return { id: crypto.randomUUID(), mode, sourceMessageId: candidate.sourceMessageId,
    start: candidate.start, end: candidate.end, quote: candidate.quote, prefix: candidate.prefix, suffix: candidate.suffix };
}

/** Shared selection controls for assistant surfaces; the host owns turn dispatch. */
export function useTextSelectionController({ scope, messages, busy, composerRef, onAsk, onStop, onBeginQuestion }: {
  scope: string | null;
  messages: readonly SelectableChatMessage[];
  busy: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onAsk: (question: string, selection: ChatTextSelectionReference) => void;
  onStop: () => void;
  onBeginQuestion: () => void;
}) {
  const [highlights, setHighlights, highlightError] = useTextHighlights(scope ? `breadboard:chat-highlights:${scope}` : null, normalizeHighlights);
  const [savedSelections, setSavedSelections, selectionError] = useTextHighlights(scope ? `breadboard:inline-selections:${scope}` : null, normalizeSelections);
  const [deleted, setDeleted, deletedError] = useTextHighlights(scope ? `breadboard:deleted-inline-selections:${scope}` : null, normalizeDeleted);
  const [menu, setMenu] = useState<ChatTextSelectionCandidate | null>(null);
  const [composerSelection, setComposerSelection] = useState<ChatTextSelectionReference | null>(null);
  const [openAnswers, setOpenAnswers] = useState<OpenAnswer[]>([]);
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setMenu(null);
    setComposerSelection(null);
    setOpenAnswers([]);
  }

  const threads = useMemo(() => {
    const result = new Map<string, { selection: ChatTextSelectionReference; question?: string; answer?: SelectableChatMessage }>();
    for (const selection of savedSelections) {
      if (!deleted.includes(selection.id)) result.set(selection.id, { selection });
    }
    let pending: string | undefined;
    for (const message of messages) {
      const selection = message.textSelection;
      if (message.role === "user") {
        pending = selection?.mode === "inline" ? selection.id : undefined;
        if (pending && selection && !deleted.includes(pending)) result.set(pending, { selection, question: message.content });
      } else {
        const id = selection?.mode === "inline" ? selection.id : pending;
        const thread = id ? result.get(id) : undefined;
        if (thread) thread.answer = message;
        pending = undefined;
      }
    }
    return result;
  }, [deleted, messages, savedSelections]);

  const annotations = useMemo(() => {
    const result = new Map<string, ChatTextAnnotation[]>();
    const add = (selection: ChatTextSelectionReference, annotation: ChatTextAnnotation) => {
      const list = result.get(selection.sourceMessageId) ?? [];
      list.push(annotation);
      result.set(selection.sourceMessageId, list);
    };
    for (const highlight of highlights) add(highlight, { ...highlight, kind: "highlight" });
    for (const { selection } of threads.values()) add(selection, { ...selection, kind: "answer" });
    return result;
  }, [highlights, threads]);

  const retainParents = useCallback((current: OpenAnswer[], sourceId: string) => {
    const parent = current.findIndex(open => threads.get(open.id)?.answer?.id === sourceId);
    return parent < 0 ? [] : current.slice(0, parent + 1);
  }, [threads]);

  const openAnnotation = useCallback((id: string, anchor: FloatingAnchorRect) => {
    const highlight = highlights.find(item => item.id === id);
    const thread = threads.get(id);
    if (highlight) {
      setOpenAnswers(current => retainParents(current, highlight.sourceMessageId));
      setMenu({ ...highlight, anchor });
    } else if (thread) {
      setMenu(null);
      setOpenAnswers(current => [...retainParents(current, thread.selection.sourceMessageId), { id, anchor }]);
      if (!thread.question) {
        setComposerSelection(thread.selection);
        onBeginQuestion();
        window.setTimeout(() => composerRef.current?.focus(), 0);
      }
    }
    window.getSelection()?.removeAllRanges();
  }, [composerRef, highlights, onBeginQuestion, retainParents, threads]);

  const receiveSelection = useCallback((selection: ChatTextSelectionCandidate) => {
    if (!scope) return;
    const answer = annotations.get(selection.sourceMessageId)?.find(item => item.kind === "answer" && chatTextSelectionsOverlap(item, selection));
    if (answer) { openAnnotation(answer.id, selection.anchor); return; }
    setOpenAnswers(current => retainParents(current, selection.sourceMessageId));
    setMenu(selection);
  }, [annotations, openAnnotation, retainParents, scope]);

  const closeMenu = useCallback(() => setMenu(null), []);
  function clearMenu() {
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }
  function removeOverlapping(selection: ChatTextSelectionCandidate | ChatTextSelectionReference) {
    setHighlights(current => current.filter(item => item.sourceMessageId !== selection.sourceMessageId || !chatTextSelectionsOverlap(item, selection)));
  }
  function highlight(color: ChatHighlightColor) {
    if (!menu) return;
    setHighlights(current => {
      const existing = current.find(item => item.sourceMessageId === menu.sourceMessageId && chatTextSelectionsOverlap(item, menu));
      const selection = { ...selectionReference(menu, "chat"), ...(existing ? { id: existing.id } : {}) };
      return [
        ...current.filter(item => item.sourceMessageId !== selection.sourceMessageId || !chatTextSelectionsOverlap(item, selection)),
        { ...selection, color, ...(existing?.note ? { note: existing.note } : {}) },
      ];
    });
    clearMenu();
  }
  function saveNote(value: string | null) {
    if (!menu) return;
    const note = normalizeChatHighlightNote(value);
    setHighlights(current => {
      const existing = current.find(item => item.sourceMessageId === menu.sourceMessageId && chatTextSelectionsOverlap(item, menu));
      if (!note && !existing) return current;
      const selection = { ...selectionReference(menu, "chat"), ...(existing ? { id: existing.id } : {}) };
      const withoutOverlap = current.filter(item => item.sourceMessageId !== selection.sourceMessageId || !chatTextSelectionsOverlap(item, selection));
      if (!note && existing) {
        if (!existing.color) return withoutOverlap;
        const withoutNote = { ...existing };
        delete withoutNote.note;
        return [...withoutOverlap, withoutNote];
      }
      return [...withoutOverlap, {
        ...selection,
        ...(existing?.color ? { color: existing.color } : {}),
        note,
      }];
    });
    clearMenu();
  }
  function cancelQuestion() {
    if (composerSelection && !threads.get(composerSelection.id)?.question) {
      setSavedSelections(current => current.filter(item => item.id !== composerSelection.id));
    }
    setComposerSelection(null);
  }
  function beginQuestion(mode: "chat" | "inline") {
    if (!menu) return;
    cancelQuestion();
    const selection = selectionReference(menu, mode);
    if (mode === "inline") {
      removeOverlapping(selection);
      setSavedSelections(current => [...current, selection]);
      setOpenAnswers(current => [...retainParents(current, selection.sourceMessageId), { id: selection.id, anchor: menu.anchor }]);
    } else setOpenAnswers([]);
    setComposerSelection(selection);
    onBeginQuestion();
    clearMenu();
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }
  function deleteAnswer(id: string) {
    setSavedSelections(current => current.filter(item => item.id !== id));
    setDeleted(current => [...new Set([...current, id])]);
    setOpenAnswers(current => current.slice(0, current.findIndex(item => item.id === id)));
    setComposerSelection(current => current?.id === id ? null : current);
  }

  const selectedHighlight = menu ? highlights.find(item => item.sourceMessageId === menu.sourceMessageId && chatTextSelectionsOverlap(item, menu)) : undefined;
  const lastMessage = messages.at(-1);
  const overlays = <>
    <TextHighlightSaveStatus error={highlightError ?? selectionError ?? deletedError} />
    {menu && <ChatSelectionMenu selection={menu} highlighted={Boolean(selectedHighlight?.color)} highlightColor={selectedHighlight?.color}
      onHighlightColor={highlight} onRemoveHighlight={() => { removeOverlapping(menu); clearMenu(); }}
      note={selectedHighlight?.note} onSaveNote={saveNote}
      onAskInChat={() => beginQuestion("chat")} onAskHere={() => beginQuestion("inline")} onClose={closeMenu} />}
    {openAnswers.map((open, index) => {
      const thread = threads.get(open.id);
      if (!thread) return null;
      return <InlineSelectionAnswerPopover key={open.id} anchor={open.anchor} selection={thread.selection} question={thread.question}
        answer={thread.answer?.content} answerMessageId={thread.answer?.id}
        pending={busy && lastMessage?.textSelection?.id === open.id}
        usage={thread.answer?.usage} responseDurationMs={thread.answer?.responseDurationMs} startedAt={thread.answer?.createdAt}
        responseCompletedAt={thread.answer?.responseCompletedAt} verification={thread.answer?.verification}
        annotations={thread.answer ? annotations.get(thread.answer.id) ?? EMPTY_ANNOTATIONS : EMPTY_ANNOTATIONS}
        onSelection={receiveSelection} onOpenAnnotation={openAnnotation} onStop={onStop}
        onAskAgain={!busy ? question => onAsk(question, thread.selection) : undefined}
        onClose={() => setOpenAnswers(current => current.slice(0, index))} onDelete={() => deleteAnswer(open.id)} />;
    })}
  </>;
  return { annotations, receiveSelection, openAnnotation, composerSelection, cancelQuestion,
    clearComposerSelection: () => setComposerSelection(null), restoreComposerSelection: setComposerSelection, overlays };
}
