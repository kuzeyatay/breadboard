"use client";

import { useCallback, useMemo, useState, type ReactNode, type RefObject } from "react";
import {
  isChatHighlightColor,
  normalizeChatHighlightNote,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import { chatQuestionSelections, chatTextSelectionsOverlap, normalizeChatTextSelectionReference, type ChatTextSelectionReference } from "@/lib/chat-text-selection";
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
import { reusableChatAttachments, type ChatAttachment, type ChatMessageAttachment } from "@/lib/chat-attachments";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import type { ChatTextAnnotation } from "./chat-markdown";
import { ChatSelectionMenu, InlineSelectionAnswerPopover, type ChatTextSelectionCandidate, type FloatingAnchorRect } from "./chat-text-selection-ui";
import { TextHighlightSaveStatus } from "./text-highlight-save-status";
import { useTextHighlights } from "./use-text-highlights";

export interface SelectableChatMessage {
  id: string;
  starMessageId?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatMessageAttachment[];
  thinking?: string;
  progressNotes?: string[];
  textSelection?: ChatTextSelectionReference;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  responseCompletedAt?: string;
  verification?: VerificationSummary;
  createdAt?: string;
  pending?: boolean;
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
export function useTextSelectionController({ scope, conversationId, canStar, persistDraft = true, renderArtifacts, messages, busy, concurrentInline = false, composerRef, onAsk, onStop, onBeginQuestion, onOpenChatQuestion }: {
  scope: string | null;
  conversationId?: string;
  canStar?: boolean;
  persistDraft?: boolean;
  renderArtifacts?: (answerMessageId: string) => ReactNode;
  messages: readonly SelectableChatMessage[];
  busy: boolean;
  concurrentInline?: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onAsk: (question: string, selection: ChatTextSelectionReference, attachments: readonly ChatAttachment[]) => void;
  onStop: (selectionId: string) => void;
  onBeginQuestion: () => void;
  onOpenChatQuestion: (selectionId: string) => void;
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
    const result = new Map<string, { selection: ChatTextSelectionReference; question?: string; attachments?: ChatAttachment[]; answer?: SelectableChatMessage }>();
    for (const selection of savedSelections) {
      if (!deleted.includes(selection.id)) result.set(selection.id, { selection });
    }
    let pending: string | undefined;
    for (const message of messages) {
      const selection = message.textSelection;
      if (message.role === "user") {
        pending = selection?.mode === "inline" ? selection.id : undefined;
        if (pending && selection && !deleted.includes(pending)) result.set(pending, {
          selection, question: message.content,
          attachments: reusableChatAttachments(message.attachments).filter(item => item.context !== "pdf"),
        });
      } else {
        const id = selection?.mode === "inline" ? selection.id : pending;
        const thread = id ? result.get(id) : undefined;
        if (thread) thread.answer = message;
        pending = undefined;
      }
    }
    return result;
  }, [deleted, messages, savedSelections]);

  const chatSelections = useMemo(() => chatQuestionSelections(messages, composerSelection), [messages, composerSelection]);
  const annotations = useMemo(() => {
    const result = new Map<string, ChatTextAnnotation[]>();
    const add = (selection: ChatTextSelectionReference, annotation: ChatTextAnnotation) => {
      const list = result.get(selection.sourceMessageId) ?? [];
      list.push(annotation);
      result.set(selection.sourceMessageId, list);
    };
    for (const selection of chatSelections.values()) add(selection, { ...selection, kind: "chat" });
    for (const highlight of highlights) add(highlight, { ...highlight, kind: "highlight" });
    for (const { selection } of threads.values()) add(selection, { ...selection, kind: "answer" });
    return result;
  }, [chatSelections, highlights, threads]);

  const retainParents = useCallback((current: OpenAnswer[], sourceId: string) => {
    const parent = current.findIndex(open => threads.get(open.id)?.answer?.id === sourceId);
    return parent < 0 ? [] : current.slice(0, parent + 1);
  }, [threads]);

  const openAnnotation = useCallback((id: string, anchor: FloatingAnchorRect, toggle = true) => {
    if (chatSelections.has(id)) {
      setMenu(null);
      setOpenAnswers([]);
      window.getSelection()?.removeAllRanges();
      if (messages.some(message => message.role === "user" && message.textSelection?.id === id)) onOpenChatQuestion(id);
      else {
        onBeginQuestion();
        window.setTimeout(() => composerRef.current?.focus(), 0);
      }
      return;
    }
    const highlight = highlights.find(item => item.id === id);
    const thread = threads.get(id);
    if (highlight) {
      setOpenAnswers(current => retainParents(current, highlight.sourceMessageId));
      setMenu({ ...highlight, anchor });
    } else if (thread) {
      setMenu(null);
      const openIndex = openAnswers.findIndex(answer => answer.id === id);
      if (toggle && openIndex >= 0) {
        setOpenAnswers(current => current.slice(0, openIndex));
        window.getSelection()?.removeAllRanges();
        return;
      }
      setOpenAnswers(current => [...retainParents(current, thread.selection.sourceMessageId), { id, anchor }]);
    }
    window.getSelection()?.removeAllRanges();
  }, [chatSelections, messages, onOpenChatQuestion, composerRef, highlights, onBeginQuestion, openAnswers, retainParents, threads]);

  const receiveSelection = useCallback((selection: ChatTextSelectionCandidate) => {
    if (!scope) return;
    const answer = annotations.get(selection.sourceMessageId)?.find(item => item.kind === "answer" && chatTextSelectionsOverlap(item, selection));
    if (answer) { openAnnotation(answer.id, selection.anchor, false); return; }
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
    const selection = selectionReference(menu, mode);
    if (mode === "inline") {
      removeOverlapping(selection);
      setSavedSelections(current => [...current, selection]);
      setOpenAnswers(current => [...retainParents(current, selection.sourceMessageId), { id: selection.id, anchor: menu.anchor }]);
    } else {
      cancelQuestion();
      setOpenAnswers([]);
      setComposerSelection(selection);
      onBeginQuestion();
      window.setTimeout(() => composerRef.current?.focus(), 0);
    }
    clearMenu();
  }
  function deleteAnswer(id: string) {
    setSavedSelections(current => current.filter(item => item.id !== id));
    setDeleted(current => [...new Set([...current, id])]);
    setOpenAnswers(current => current.slice(0, current.findIndex(item => item.id === id)));
    setComposerSelection(current => current?.id === id ? null : current);
  }

  const replyToAnswer = useCallback((selection: ChatTextSelectionReference, anchor: FloatingAnchorRect) => {
    setSavedSelections(current => [...current, selection]);
    setMenu(null);
    setOpenAnswers(current => [...retainParents(current, selection.sourceMessageId), { id: selection.id, anchor }]);
    window.getSelection()?.removeAllRanges();
  }, [retainParents, setSavedSelections]);

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
      const pending = concurrentInline ? thread.answer?.pending === true : busy && lastMessage?.textSelection?.id === open.id;
      return <InlineSelectionAnswerPopover key={open.id} anchor={open.anchor} selection={thread.selection} question={thread.question}
        persistDraft={persistDraft}
        questionAttachments={thread.attachments}
        answer={thread.answer?.content} answerMessageId={thread.answer?.id}
        conversationId={conversationId} canStar={canStar} starMessageId={thread.answer?.starMessageId}
        reasoning={thread.answer?.thinking} progressNotes={thread.answer?.progressNotes}
        artifacts={thread.answer?.id ? renderArtifacts?.(thread.answer.id) : undefined}
        onReply={concurrentInline || !busy ? replyToAnswer : undefined}
        pending={pending}
        usage={thread.answer?.usage} responseDurationMs={thread.answer?.responseDurationMs} startedAt={thread.answer?.createdAt}
        responseCompletedAt={thread.answer?.responseCompletedAt} verification={thread.answer?.verification}
        annotations={thread.answer ? annotations.get(thread.answer.id) ?? EMPTY_ANNOTATIONS : EMPTY_ANNOTATIONS}
        onSelection={receiveSelection} onOpenAnnotation={openAnnotation} onStop={() => onStop(open.id)}
        onAskAgain={(concurrentInline ? !pending : !busy) ? (question, attachments) => onAsk(question, thread.selection, attachments) : undefined}
        onClose={() => setOpenAnswers(current => current.slice(0, index))} onDelete={() => deleteAnswer(open.id)} />;
    })}
  </>;
  return { annotations, receiveSelection, openAnnotation, replyToAnswer, composerSelection, cancelQuestion,
    clearComposerSelection: () => setComposerSelection(null), restoreComposerSelection: setComposerSelection, overlays };
}
