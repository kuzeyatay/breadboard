"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatSelectionMenu, InlineSelectionAnswerPopover, type ChatTextSelectionCandidate, type FloatingAnchorRect } from "@/app/components/chat-text-selection-ui";
import type { ChatTextAnnotation } from "@/app/components/chat-markdown";
import { desktopTabsBridge, sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import type { BrowserInlineAnswerAction, BrowserInlineAnswerViewState, BrowserInlineNestedThread } from "@/lib/browser-inline-answer";
import { chatTextSelectionsOverlap, type ChatTextSelectionReference } from "@/lib/chat-text-selection";
import InlineArtifactCards, { InlineArtifactCardsProvider } from "@/app/components/hermes/inline-artifact-cards";

const anchor = { left: 16, right: 16, top: 16, bottom: 16, width: 0, height: 0 };
const ROOT = "root";
type Open = { id: string; left: number; top: number };
type Passage = ChatTextAnnotation & { sourceMessageId?: string; quote?: string; prefix?: string; suffix?: string };

export default function BrowserInlineAnswer() {
  const [state, setState] = useState<BrowserInlineAnswerViewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Follow-ups asked inside this card stack at their passage, like the
  // Terminal's cards. The Terminal still runs every turn and stores marks.
  const [stack, setStack] = useState<Open[]>([]);
  const [drafts, setDrafts] = useState<ChatTextSelectionReference[]>([]);
  const [menu, setMenu] = useState<ChatTextSelectionCandidate | null>(null);
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  useEffect(() => {
    document.documentElement.dataset.breadboardInlineAnswer = "true";
    document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
    document.body.style.padding = "0";
    const unsubscribe = desktopTabsBridge()?.onBrowserInlineAnswerState?.(setState);
    void sendDesktopTabsCommand({ type: "browser-answer-ready" });
    return unsubscribe;
  }, []);
  // The native view is one rectangle: it must cover every open card.
  const report = useCallback(() => {
    let width = 1, height = 1;
    for (const size of sizes.current.values()) { width = Math.max(width, size.width); height = Math.max(height, size.height); }
    void sendDesktopTabsCommand({ type: "browser-answer-resize", width, height });
  }, []);
  const move = useCallback((dx: number, dy: number) => { void sendDesktopTabsCommand({ type: "browser-answer-move", dx, dy }); }, []);
  const viewWidth = state?.viewport.width ?? 612, viewHeight = state?.viewport.height ?? 600;
  const nested = new Map<string, BrowserInlineNestedThread>(drafts.map(selection => [selection.id, { selection, pending: false }]));
  for (const thread of state?.content.nested ?? []) nested.set(thread.selection.id, thread);
  const open = stack.filter(item => nested.has(item.id));
  const openKey = open.map(item => `${item.id}:${item.left}:${item.top}`).join("|");
  const embedded = useMemo(() => new Map([{ id: ROOT, left: 16, top: 16 }, ...open].map(item => [item.id, {
    width: viewWidth, height: viewHeight, left: item.left, top: item.top, onMove: move,
    onSize: (width: number, height: number) => { sizes.current.set(item.id, { width, height }); report(); },
  }])), [openKey, viewWidth, viewHeight, move, report]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let changed = false;
    for (const id of sizes.current.keys()) if (!embedded.has(id)) { sizes.current.delete(id); changed = true; }
    if (changed) report();
  }, [embedded, report]);

  async function act(action: BrowserInlineAnswerAction["action"], extra: Partial<BrowserInlineAnswerAction> = {}) {
    if (!state) return false; setError(null);
    const sent = await sendDesktopTabsCommand({ type: "browser-answer-action", action: {
      requestId: state.requestId, selectionId: state.selectionId, action, ...extra,
    } });
    if (!sent) setError("The saved answer is unavailable. Select the highlight again.");
    return sent;
  }
  if (!state) return null;
  const content = state.content;
  const answerIdOf = (id: string) => id === ROOT ? content.answerMessageId : nested.get(id)?.answerMessageId;
  // Opening a card keeps the cards it sits inside and closes the rest.
  const openAt = (id: string, sourceMessageId: string, at: FloatingAnchorRect) => {
    setMenu(null); window.getSelection()?.removeAllRanges();
    const parent = open.findIndex(item => answerIdOf(item.id) === sourceMessageId);
    const left = Math.max(16, Math.min(viewWidth - 416, at.left - 24));
    const top = Math.max(16, Math.min(viewHeight - 276, at.bottom + 10));
    setStack([...open.slice(0, parent + 1), { id, left, top }]);
  };
  const passageOf = (from: ChatTextSelectionCandidate, mode: "chat" | "inline"): ChatTextSelectionReference => ({
    id: crypto.randomUUID(), mode, sourceMessageId: from.sourceMessageId,
    start: from.start, end: from.end, quote: from.quote, prefix: from.prefix, suffix: from.suffix,
  });
  const marksOn = (sourceMessageId: string) => (content.annotations?.[sourceMessageId] ?? []) as Passage[];
  const receiveSelection = (candidate: ChatTextSelectionCandidate) => {
    const answer = marksOn(candidate.sourceMessageId).find(item => item.kind === "answer" && chatTextSelectionsOverlap(item, candidate));
    if (answer && nested.has(answer.id)) openAt(answer.id, candidate.sourceMessageId, candidate.anchor);
    else setMenu(candidate);
  };
  const openAnnotation = (id: string, at: FloatingAnchorRect) => {
    const thread = nested.get(id);
    if (thread) {
      const index = open.findIndex(item => item.id === id);
      if (index >= 0) setStack(open.slice(0, index));
      else openAt(id, thread.selection.sourceMessageId, at);
      return;
    }
    for (const [sourceMessageId, marks] of Object.entries(content.annotations ?? {})) {
      const mark = (marks as Passage[]).find(item => item.id === id && item.kind === "highlight");
      if (mark) { setMenu({ sourceMessageId, start: mark.start, end: mark.end, quote: mark.quote ?? "", prefix: mark.prefix, suffix: mark.suffix, anchor: at }); return; }
    }
  };
  const menuHighlight = menu ? marksOn(menu.sourceMessageId).find(item => item.kind === "highlight" && chatTextSelectionsOverlap(item, menu)) : undefined;
  const highlight = (change: NonNullable<BrowserInlineAnswerAction["highlight"]>) => {
    if (!menu) return;
    void act("highlight", { selection: passageOf(menu, "chat"), highlight: change });
    setMenu(null); window.getSelection()?.removeAllRanges();
  };

  const cards = [{ id: ROOT, thread: undefined as BrowserInlineNestedThread | undefined }, ...open.map(item => ({ id: item.id, thread: nested.get(item.id)! }))];
  return <InlineArtifactCardsProvider conversationId={content.conversationId ?? null}>
    {cards.map(({ id, thread }, index) => {
      const shown = thread ?? content;
      const closeFromHere = () => { if (!thread) void act("close"); else setStack(open.slice(0, index - 1)); };
      return <InlineSelectionAnswerPopover key={thread?.selection.id ?? state.requestId}
        question={shown.question} questionAttachments={shown.questionAttachments} answer={shown.answer} reasoning={shown.reasoning}
        progressNotes={shown.progressNotes} pending={shown.pending} usage={shown.usage} responseDurationMs={shown.responseDurationMs}
        responseCompletedAt={shown.responseCompletedAt} verification={shown.verification} startedAt={shown.startedAt}
        answerMessageId={shown.answerMessageId} starMessageId={shown.starMessageId}
        conversationId={content.conversationId} canStar={content.canStar} persistDraft={content.persistDraft}
        note={thread ? undefined : content.note}
        selection={thread?.selection ?? state.selection} anchor={anchor} embedded={embedded.get(id)}
        questionDisabled={!content.canAsk} initialEditing={thread ? !thread.question : !state.conversationId}
        deleteDisabled={!content.ownerReady}
        annotations={shown.answerMessageId ? content.annotations?.[shown.answerMessageId] : undefined}
        onSelection={content.ownerReady ? receiveSelection : undefined} onOpenAnnotation={openAnnotation}
        onReply={content.canAsk ? (selection, at) => { setDrafts(current => [...current, selection]); openAt(selection.id, selection.sourceMessageId, at); } : undefined}
        artifacts={<>{shown.artifactMessageId && content.conversationId && <InlineArtifactCards conversationId={content.conversationId} ownerMessageId={shown.artifactMessageId} />}
          {(error || (!thread && content.error)) && <p role="alert" className="mt-2 text-xs text-[var(--danger-hover)]">{error || content.error}</p>}</>}
        onClose={closeFromHere}
        onDelete={() => {
          if (!thread) { void act("delete"); return; }
          setStack(open.slice(0, index - 1)); setDrafts(current => current.filter(item => item.id !== thread.selection.id));
          if (thread.question) void act("delete", { selection: thread.selection });
        }}
        onStop={shown.pending ? () => void act("stop", { selection: thread?.selection }) : undefined}
        onAskAgain={(question, attachments) => void act("ask", { question, attachments: [...attachments], selection: thread?.selection })} />;
    })}
    {menu && <ChatSelectionMenu selection={menu} highlighted={Boolean(menuHighlight?.color)} highlightColor={menuHighlight?.color}
      note={menuHighlight?.note} onClose={() => setMenu(null)}
      onHighlightColor={color => highlight({ color })} onRemoveHighlight={() => highlight({ color: null })}
      onSaveNote={note => highlight({ note })}
      onAskInChat={content.canAsk ? () => {
        const passage = passageOf(menu, "chat"); setMenu(null);
        void act("ask-in-chat", { selection: passage }).then(sent => { if (sent) void act("close"); });
      } : undefined}
      onAskHere={content.canAsk ? () => {
        const passage = passageOf(menu, "inline");
        setDrafts(current => [...current, passage]); openAt(passage.id, passage.sourceMessageId, menu.anchor);
      } : undefined} />}
  </InlineArtifactCardsProvider>;
}
