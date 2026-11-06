"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import { useTerminalHeaderClickGuard } from "../terminal-header-click-guard";

interface Props {
  dockStyle: CSSProperties;
  resizing: boolean;
  onOpen: () => void;
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLElement>) => void;
  onResizeEnd: (event: PointerEvent<HTMLElement>) => void;
}

/** Share the dock's height and animation, but stay outside its clipped content
 * so the grip can straddle the top border without exposing the transcript.
 * The 2px offset centers it on the inset outline rather than the dock's box. */
export default function TerminalDockHandle({ dockStyle, resizing, onOpen, onResizeStart, onResizeMove, onResizeEnd }: Props) {
  const gesture = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const clickGuard = useTerminalHeaderClickGuard();

  function track(event: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) start.dragged = true;
  }

  function finish(event: PointerEvent<HTMLElement>) {
    if (!gesture.current) return;
    track(event);
    const open = !gesture.current.dragged && event.type !== "pointercancel";
    gesture.current = null;
    onResizeEnd(event);
    clickGuard.endPointerSequence();
    if (open) onOpen();
  }

  return (
    <div
      data-terminal-handle-position
      className="pointer-events-none fixed inset-x-0 z-50 h-0"
      style={{ bottom: dockStyle.height, transform: dockStyle.transform, transition: dockStyle.transition, willChange: dockStyle.willChange }}
    >
      <button
        type="button"
        aria-label="Fully open terminal"
        title="Click to fully open, or drag to resize the terminal"
        className="group pointer-events-auto absolute left-1/2 top-[2px] flex h-6 w-24 -translate-x-1/2 -translate-y-1/2 cursor-row-resize touch-none items-center justify-center rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
        onPointerDown={event => {
          if (event.button !== 0) return;
          gesture.current = { x: event.clientX, y: event.clientY, dragged: false };
          clickGuard.beginPointerSequence();
          onResizeStart(event);
        }}
        onPointerMove={event => {
          if (!gesture.current) return;
          track(event);
          onResizeMove(event);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onClick={() => { if (clickGuard.shouldHandleClick()) onOpen(); }}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-16 rounded-full border border-[rgba(79,112,108,0.3)] shadow-[0_1px_4px_rgba(74,91,70,0.18)] transition-colors ${
            resizing ? "bg-[var(--botanical-hover)]" : "bg-[var(--botanical)] group-hover:bg-[var(--botanical-hover)]"
          }`}
        />
      </button>
    </div>
  );
}
