"use client";

import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import type { ChatVirtualBridge } from "./use-chat-auto-scroll";

export interface StarredMessageTarget {
  chatId: string;
  messageId: string;
  clientMessageId?: string;
  requestId: number;
}

/** Wait for restored rows, then let the virtualizer mount the saved message. */
export function useStarredMessageJump({ target, chatId, loading, rows, bridge, scrollRef, scrollToMessage }: {
  target?: StarredMessageTarget | null;
  chatId: string | number | null | undefined;
  loading: boolean;
  rows: readonly { message: { id?: string; clientMessageId?: string; role: string } }[];
  bridge: ChatVirtualBridge;
  scrollRef: RefObject<HTMLElement | null>;
  scrollToMessage: (index: number) => void;
}) {
  const handled = useRef<StarredMessageTarget | null>(null);
  // History refreshes and streaming replace the rows array. Only a change in
  // the target's position should restart a jump that is already settling.
  const index = target ? rows.findIndex(({ message }) => message.role === "assistant" &&
    (message.id === target.messageId || message.clientMessageId === target.messageId ||
      (Boolean(target.clientMessageId) && (message.id === target.clientMessageId ||
        message.clientMessageId === target.clientMessageId)))) : -1;
  const scrollToTarget = useEffectEvent((rowIndex: number) => scrollToMessage(rowIndex));

  useEffect(() => {
    if (!target || target === handled.current || loading || String(chatId) !== target.chatId) return;
    if (index < 0) return;
    let frame = 0;
    let highlightTimer = 0;
    let row: HTMLElement | null = null;
    let previousTabIndex: string | null = null;
    let started = false;
    let visibleSince: number | null = null;
    const deadline = performance.now() + 5_000;
    const clearHighlight = () => {
      row?.removeAttribute("data-starred-message-target");
      if (previousTabIndex === null) row?.removeAttribute("tabindex");
      else row?.setAttribute("tabindex", previousTabIndex);
    };
    const jump = () => {
      const container = scrollRef.current;
      if (container && bridge.activeRef.current) {
        const offset = bridge.getRowStart(index);
        if (!started || (offset !== null && Math.abs(container.scrollTop - offset) > 2)) {
          started = true;
          scrollToTarget(index);
        }
        const mounted = container.querySelector<HTMLElement>(`[data-chat-virtual-list] > [data-index="${index}"]`);
        const bounds = mounted?.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        if (mounted && bounds && bounds.bottom > viewport.top && bounds.top < viewport.bottom) {
          if (row !== mounted) {
            clearHighlight();
            row = mounted;
            previousTabIndex = row.getAttribute("tabindex");
            row.setAttribute("data-starred-message-target", "");
            row.setAttribute("tabindex", "-1");
            row.focus({ preventScroll: true });
          }
          visibleSince ??= performance.now();
          // Allow lazy content and the virtualizer's measurements to settle.
          // A requested scroll alone is not proof that its row was reached.
          if (performance.now() - visibleSince >= 200) {
            handled.current = target;
            highlightTimer = window.setTimeout(clearHighlight, 2500);
            return;
          }
        } else {
          visibleSince = null;
        }
      }
      if (performance.now() < deadline) frame = requestAnimationFrame(jump);
      else clearHighlight();
    };
    // Cancel the default landing on the newest message as soon as rows exist.
    jump();
    const cancel = () => {
      cancelAnimationFrame(frame);
      handled.current = target;
      clearHighlight();
    };
    const container = scrollRef.current;
    container?.addEventListener("wheel", cancel, { passive: true });
    container?.addEventListener("touchmove", cancel, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(highlightTimer);
      container?.removeEventListener("wheel", cancel);
      container?.removeEventListener("touchmove", cancel);
      clearHighlight();
    };
  }, [target, chatId, loading, index, bridge, scrollRef]);
}

export function initialStarredMessageTarget(): StarredMessageTarget | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const chatId = query.get("terminalChat") ?? query.get("chat");
  const messageId = query.get("message");
  return chatId && messageId ? { chatId, messageId, requestId: 0 } : null;
}
