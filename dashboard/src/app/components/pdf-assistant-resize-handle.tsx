"use client";

import { useCallback, useEffect, useRef } from "react";

const MIN_WIDTH = 340;
const MAX_WIDTH = 720;

function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth * 0.65, width));
}

interface Drag {
  pointerId: number;
  startX: number;
  width: number;
  nextWidth: number;
  handle: HTMLButtonElement;
  frame: number | null;
}

export default function PdfAssistantResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const dragRef = useRef<Drag | null>(null);
  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    drag.handle.style.removeProperty("transform");
    drag.handle.style.removeProperty("will-change");
    delete drag.handle.dataset.resizing;
    if (drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("resize", cancelDrag);
    return () => {
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("resize", cancelDrag);
      cancelDrag();
    };
  }, [cancelDrag]);

  return (
    <button
      type="button"
      aria-label="Resize PDF assistant"
      role="separator"
      aria-controls="pdf-assistant-panel"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--selection-highlight-blue)] focus-visible:bg-[var(--selection-highlight-blue)] data-[resizing=true]:bg-[var(--selection-highlight-blue)] lg:block"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId, startX: event.clientX,
          width, nextWidth: width, handle: event.currentTarget, frame: null,
        };
        event.currentTarget.dataset.resizing = "true";
        event.currentTarget.style.willChange = "transform";
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.nextWidth = clampWidth(drag.width + drag.startX - event.clientX);
        if (drag.frame !== null) return;
        // Moving only the guide avoids reflowing the chat and rescaling every
        // PDF page on every pointer event. Commit the pane width on release.
        drag.frame = requestAnimationFrame(() => {
          drag.frame = null;
          drag.handle.style.transform = `translateX(${drag.width - drag.nextWidth}px)`;
        });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextWidth = clampWidth(drag.width + drag.startX - event.clientX);
        cancelDrag();
        onResize(nextWidth);
      }}
      onPointerCancel={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) cancelDrag();
      }}
      onLostPointerCapture={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) cancelDrag();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && dragRef.current) {
          event.preventDefault();
          cancelDrag();
        } else if (!dragRef.current && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          onResize(clampWidth(width + (event.key === "ArrowLeft" ? 20 : -20)));
        }
      }}
    />
  );
}
