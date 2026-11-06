"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InlineSelectionAnswerPopover } from "@/app/components/chat-text-selection-ui";
import { desktopTabsBridge, sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import type { BrowserInlineAnswerAction, BrowserInlineAnswerViewState } from "@/lib/browser-inline-answer";
import InlineArtifactCards, { InlineArtifactCardsProvider } from "@/app/components/hermes/inline-artifact-cards";

const anchor = { left: 16, right: 16, top: 16, bottom: 16, width: 0, height: 0 };
export default function BrowserInlineAnswer() {
  const [state, setState] = useState<BrowserInlineAnswerViewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.dataset.breadboardInlineAnswer = "true";
    document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
    document.body.style.padding = "0";
    const unsubscribe = desktopTabsBridge()?.onBrowserInlineAnswerState?.(setState);
    void sendDesktopTabsCommand({ type: "browser-answer-ready" });
    return unsubscribe;
  }, []);
  const resize = useCallback((width: number, height: number) => { void sendDesktopTabsCommand({ type: "browser-answer-resize", width, height }); }, []);
  const move = useCallback((dx: number, dy: number) => { void sendDesktopTabsCommand({ type: "browser-answer-move", dx, dy }); }, []);
  const embedded = useMemo(() => ({ width: state?.viewport.width ?? 612, height: state?.viewport.height ?? 600, onSize: resize, onMove: move }), [state?.viewport.width, state?.viewport.height, resize, move]);
  async function act(action: BrowserInlineAnswerAction["action"], question?: string, attachments?: BrowserInlineAnswerAction["attachments"]) {
    if (!state) return; setError(null);
    if (!await sendDesktopTabsCommand({ type: "browser-answer-action", action: {
      requestId: state.requestId, selectionId: state.selectionId, action, question, attachments,
    } })) setError("The saved answer is unavailable. Select the highlight again.");
  }
  if (!state) return null;
  const content = state.content;
  return <InlineArtifactCardsProvider conversationId={content.conversationId ?? null}>
    <InlineSelectionAnswerPopover key={state.requestId} {...content} selection={state.selection} anchor={anchor} embedded={embedded}
      questionDisabled={!content.canAsk} initialEditing={!state.conversationId}
      deleteDisabled={!content.ownerReady}
      artifacts={<>{content.artifactMessageId && content.conversationId && <InlineArtifactCards conversationId={content.conversationId} ownerMessageId={content.artifactMessageId} />}
        {(error || content.error) && <p role="alert" className="mt-2 text-xs text-[var(--danger-hover)]">{error || content.error}</p>}</>}
      onClose={() => void act("close")} onDelete={() => void act("delete")}
      onStop={content.pending ? () => void act("stop") : undefined}
      onAskAgain={(question, attachments) => void act("ask", question, [...attachments])} />
  </InlineArtifactCardsProvider>;
}
