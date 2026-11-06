"use client";

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface Position { x: number; y: number }
interface Placement { position: Position | null; collapsed: boolean; enlarged?: boolean; layoutVersion?: number }

export function useNotepadPosition(ownerKey: string) {
  const panelRef = useRef<HTMLElement>(null);
  const placement = useRef<Placement>({ position: null, collapsed: true });
  const drag = useRef<{ id: number; x: number; y: number; origin: Position } | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const key = `breadboard:terminal-notepad:layout:v1:${ownerKey}`;

  const save = useCallback(() => {
    try { localStorage.setItem(key, JSON.stringify(placement.current)); } catch { /* Still movable. */ }
  }, [key]);

  function place(position: Position) {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return position;
    const x = Math.max(12, Math.min(position.x, parent.clientWidth - panel.offsetWidth - 12));
    const y = Math.max(12, Math.min(position.y, parent.clientHeight - panel.offsetHeight - 12));
    panel.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    return { x, y };
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const saved: Placement = { position: null, collapsed: true, enlarged: false, layoutVersion: 3 };
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      // Each fresh Terminal starts minimal; retain placement and preferred expanded size.
      saved.enlarged = value?.enlarged === true;
      if (Number.isFinite(value?.position?.x) && Number.isFinite(value?.position?.y)) {
        saved.position = value.position;
      }
    } catch { /* A malformed preference falls back to the visible default. */ }
    placement.current = saved;
    const fit = () => {
      // Do not overwrite the preferred position when a smaller window clamps it.
      place(placement.current.position ?? {
        x: 24,
        y: 16,
      });
    };
    // Restore browser-owned preferences together before revealing the panel.
    // Cancel the frame if the owner changes or the notepad unmounts.
    const restoreFrame = requestAnimationFrame(() => {
      setCollapsed(saved.collapsed);
      setEnlarged(Boolean(saved.enlarged));
      fit();
      setReady(true);
    });
    save();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(panel);
    return () => { cancelAnimationFrame(restoreFrame); observer.disconnect(); };
  }, [key, save]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    const panel = panelRef.current;
    if (!panel?.parentElement) return;
    const bounds = panel.getBoundingClientRect();
    const parent = panel.parentElement.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { x: bounds.left - parent.left, y: bounds.top - parent.top } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!dragging && Math.hypot(dx, dy) < 4) return;
    setDragging(true);
    placement.current.position = place({ x: gesture.origin.x + dx, y: gesture.origin.y + dy });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    save();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    if (!delta[event.key]) return;
    event.preventDefault();
    const panel = panelRef.current;
    if (!panel?.parentElement) return;
    const bounds = panel.getBoundingClientRect();
    const parent = panel.parentElement.getBoundingClientRect();
    const step = event.shiftKey ? 32 : 8;
    placement.current.position = place({ x: bounds.left - parent.left + delta[event.key].x * step, y: bounds.top - parent.top + delta[event.key].y * step });
    save();
  }

  function open() {
    placement.current.collapsed = false;
    setCollapsed(false);
    save();
  }

  function toggleCollapsed() {
    placement.current.collapsed = !placement.current.collapsed;
    setCollapsed(placement.current.collapsed);
    save();
  }

  function toggleEnlarged() {
    placement.current.enlarged = !placement.current.enlarged;
    setEnlarged(placement.current.enlarged);
    save();
  }

  return { panelRef, ready, collapsed, enlarged, dragging, open, toggleCollapsed, toggleEnlarged, handleProps: {
    onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onKeyDown,
  } };
}
