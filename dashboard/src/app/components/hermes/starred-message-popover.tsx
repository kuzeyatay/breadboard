"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { StarredMessage, StarredMessageContent } from "@/lib/starred-messages-types";
import ChatMarkdown from "../chat-markdown";

export default function StarredMessagePopover({ message, anchor, onClose }: {
  message: StarredMessage;
  anchor: { left: number; bottom: number };
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const positionRef = useRef({ left: anchor.left - 24, top: anchor.bottom + 14 });
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/starred-messages?message=${encodeURIComponent(message.messageId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const body = await response.json() as { message?: StarredMessageContent; error?: string; detail?: string };
        if (!response.ok) throw new Error(body.detail || body.error || "Could not open this message.");
        if (body.message?.messageId !== message.messageId || typeof body.message.content !== "string") {
          throw new Error("Could not open this message.");
        }
        if (!controller.signal.aborted) setContent(body.message.content);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not open this message.");
      }
    })();
    return () => controller.abort();
  }, [message.messageId, attempt]);

  const place = useCallback(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    popover.style.width = `${Math.min(580, width - 32)}px`;
    popover.style.maxHeight = `${Math.min(520, height - 32)}px`;
    const next = {
      left: Math.max(left + 16, Math.min(positionRef.current.left, left + width - popover.offsetWidth - 16)),
      top: Math.max(top + 16, Math.min(positionRef.current.top, top + height - popover.offsetHeight - 16)),
    };
    positionRef.current = next;
    popover.style.left = `${next.left}px`;
    popover.style.top = `${next.top}px`;
    popover.style.visibility = "visible";
  }, []);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popover);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [place]);

  useEffect(() => {
    const popover = popoverRef.current;
    const previousFocus = document.activeElement;
    popover?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected &&
          (document.activeElement === document.body || popover?.contains(document.activeElement))) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={popoverRef} role="dialog" aria-label="Starred message" tabIndex={-1}
      className="neu-popover fixed z-[46] flex flex-col overflow-hidden rounded-[1.4rem] border p-5 text-sm text-[var(--ink)] outline-none sm:p-6 [-webkit-app-region:no-drag]"
      style={{ visibility: "hidden" }}
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}>
      <button type="button" aria-label="Move starred message" title="Drag to move this message; use arrow keys to adjust"
        className="mb-2 flex h-5 w-full shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-[var(--ink-muted)] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
        onPointerDown={event => {
          if (event.button !== 0 || dragRef.current) return;
          event.preventDefault();
          const rect = popoverRef.current!.getBoundingClientRect();
          dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          positionRef.current = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
          place();
        }}
        onPointerUp={event => {
          if (dragRef.current?.id !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => { dragRef.current = null; }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const step = event.shiftKey ? 40 : 10;
          positionRef.current.left += event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
          positionRef.current.top += event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
          place();
        }}><span className="h-1 w-9 rounded-full bg-current opacity-35" aria-hidden /></button>
      <header className="mb-3 flex shrink-0 items-start justify-between gap-4">
        <h3 className="min-w-0 break-words font-medium text-[var(--ink-heading)]">{message.title || "Untitled chat"}</h3>
        <button type="button" onClick={onClose} aria-label="Close starred message" title="Close"
          className="neu-button-icon shrink-0 rounded-full border p-2 text-[var(--ink-muted)] hover:text-[var(--ink-heading)]">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain" aria-busy={content === null && !error}>
        {error ? <div role="alert" className="py-2">
          {error}<button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>Retry</button>
        </div> : content === null ? <p className="whitespace-pre-wrap break-words text-[var(--ink-muted)]">{message.preview}</p>
          : content.trim() ? <ChatMarkdown content={content} compact />
            : <p className="text-[var(--ink-muted)]">This message has no text.</p>}
      </div>
    </div>, document.body,
  );
}
