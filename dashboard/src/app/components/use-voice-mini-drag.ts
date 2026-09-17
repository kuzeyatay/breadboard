'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';

/** Browser overlays move within the page; native companions use OS drag regions. */
export function useVoiceMiniDrag(enabled: boolean, ref: RefObject<HTMLDivElement | null>) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);

  const clamp = useCallback((x: number, y: number) => {
    const bounds = ref.current?.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - (bounds?.width ?? 240) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (bounds?.height ?? 72) - 8)),
    };
  }, [ref]);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    const resize = () => setPosition(current => current ? clamp(current.x, current.y) : current);
    const frame = window.requestAnimationFrame(resize);
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(frame);
      if (drag.current && node?.hasPointerCapture(drag.current.id)) node.releasePointerCapture(drag.current.id);
      drag.current = null;
      window.removeEventListener('resize', resize);
    };
  }, [enabled, clamp, ref]);

  return {
    style: enabled && position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } as CSSProperties : undefined,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!enabled || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: bounds.x, y: bounds.y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current;
      if (!enabled || !current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
      if (!current.moved && Math.hypot(dx, dy) < 4) return;
      current.moved = true;
      setPosition(clamp(current.x + dx, current.y + dy));
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onLostPointerCapture() { drag.current = null; },
    onPointerCancel() { drag.current = null; },
  };
}
