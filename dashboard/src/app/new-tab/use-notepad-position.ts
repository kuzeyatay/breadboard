"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface Position { x: number; y: number }
interface Placement { position: Position | null; collapsed: boolean }

export function useNotepadPosition(ownerKey: string) {
  const panelRef = useRef<HTMLElement>(null);
  const placement = useRef<Placement>({ position: null, collapsed: false });
  const drag = useRef<{ id: number; x: number; y: number; origin: Position } | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const key = `breadboard:new-tab:notepad:${ownerKey}`;

  function save() {
    try { localStorage.setItem(key, JSON.stringify(placement.current)); } catch { /* Still movable. */ }
  }

  function place(position: Position) {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return position;
    const x = Math.max(12, Math.min(position.x, parent.clientWidth - panel.offsetWidth - 12));
    const y = Math.max(12, Math.min(position.y, parent.clientHeight - panel.offsetHeight - 12));
    panel.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    return { x, y };
  }

  useEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const saved: Placement = { position: null, collapsed: parent.clientWidth < 1180 };
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value && typeof value.collapsed === "boolean") saved.collapsed = value.collapsed;
      if (Number.isFinite(value?.position?.x) && Number.isFinite(value?.position?.y)) {
        saved.position = value.position;
      }
    } catch { /* A malformed preference falls back to the visible default. */ }
    placement.current = saved;
    const fit = () => {
      // Do not overwrite the preferred position when a smaller window clamps it.
      place(placement.current.position ?? {
        x: parent.clientWidth - panel.offsetWidth - 28,
        y: parent.clientWidth < 1180 ? 20 : 116,
      });
    };
    const frame = requestAnimationFrame(() => {
      setCollapsed(saved.collapsed);
      fit();
      setReady(true);
    });
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(panel);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [key]);

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

  function toggleCollapsed() {
    placement.current.collapsed = !placement.current.collapsed;
    setCollapsed(placement.current.collapsed);
    save();
  }

  return { panelRef, ready, collapsed, dragging, toggleCollapsed, handleProps: {
    onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onKeyDown,
  } };
}
