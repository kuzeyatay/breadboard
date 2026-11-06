"use client";

import { useEffect, useRef } from "react";
import { desktopTabsBridge, sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import type { BrowserInlineAnswerContent, BrowserInlineAnswerState } from "@/lib/browser-inline-answer";
import type { ChatTextSelectionReference } from "@/lib/chat-text-selection";
import type { ChatAttachment } from "@/lib/chat-attachments";

/** The Terminal remains the sole runtime owner. Only the visible card is mirrored. */
export function useBrowserInlineAnswer({ selection, content, onAsk, onStop, onDelete, onClose }: {
  selection?: { requestId: string; reference: ChatTextSelectionReference } | null;
  content: BrowserInlineAnswerContent | null;
  onAsk: (question: string, attachments: readonly ChatAttachment[]) => void;
  onStop: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const bridge = desktopTabsBridge();
  const native = Boolean(selection?.reference.mode === "inline" && bridge?.onBrowserInlineAnswerAction);
  const latest = useRef({ content, onAsk, onStop, onDelete, onClose });
  const queued = useRef<BrowserInlineAnswerState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { latest.current = { content, onAsk, onStop, onDelete, onClose }; }, [content, onAsk, onStop, onDelete, onClose]);
  useEffect(() => {
    if (!native || !selection) return;
    return bridge?.onBrowserInlineAnswerAction?.(action => {
      if (action.requestId !== selection.requestId || action.selectionId !== selection.reference.id) return;
      const owner = latest.current;
      if (action.action === "ask" && owner.content?.canAsk && action.question) owner.onAsk(action.question, action.attachments ?? []);
      else if (action.action === "stop") owner.onStop();
      else if (action.action === "delete") owner.onDelete();
      else if (action.action === "close") owner.onClose();
    });
  }, [native, bridge, selection]);
  useEffect(() => {
    if (!native || !selection || !content) return;
    queued.current = { requestId: selection.requestId, selectionId: selection.reference.id, content };
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (queued.current) void sendDesktopTabsCommand({ type: "browser-answer-state", state: queued.current });
    }, 60);
  }, [native, selection, content]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return native;
}
