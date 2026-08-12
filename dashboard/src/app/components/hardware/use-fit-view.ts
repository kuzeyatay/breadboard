"use client";

// Pan, zoom and — the point of it — an opening view that is fitted and centred.
//
// Both diagrams draw into a fixed content box whose origin is its top-left, so
// leaving the transform at identity pins the circuit to the top-left corner of
// a much larger stage. This measures the stage and the content and places one
// inside the other, then keeps out of the way: once the user pans or zooms, a
// resize no longer moves anything under them.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;

/** Breathing room, in stage pixels, between the content and the stage edge. */
const PADDING = 24;

export interface ContentBox {
  /** Content origin inside the drawing space; usually 0, 0. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Fit {
  zoom: number;
  pan: { x: number; y: number };
}

/**
 * Place `box` in the middle of a stage of this size. Pure, so the centring can
 * be checked without a layout engine.
 *
 * Never magnifies past 1: a two-part circuit blown up to fill the stage looks
 * like a mistake. Shrinking to fit is what a fit is for.
 */
export function computeFit(input: {
  stageWidth: number;
  stageHeight: number;
  box: ContentBox;
}): Fit | null {
  const { stageWidth, stageHeight, box } = input;
  if (!stageWidth || !stageHeight || box.width <= 0 || box.height <= 0) return null;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(1, (stageWidth - PADDING * 2) / box.width, (stageHeight - PADDING * 2) / box.height),
    ),
  );
  return {
    zoom,
    pan: {
      x: (stageWidth - box.width * zoom) / 2 - box.x * zoom,
      y: (stageHeight - box.height * zoom) / 2 - box.y * zoom,
    },
  };
}

export interface FitView<T extends HTMLElement> {
  zoom: number;
  pan: { x: number; y: number };
  /** `translate(...) scale(...)`, ready for a style transform. */
  transform: string;
  /** Fit the content into the stage and centre it. */
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** Pointer handlers for drag-to-pan; spread onto the stage element. */
  panHandlers: {
    onPointerDown: (event: ReactPointerEvent<T>) => void;
    onPointerMove: (event: ReactPointerEvent<T>) => void;
    onPointerUp: (event: ReactPointerEvent<T>) => void;
  };
}

/**
 * The stage ref stays with the caller rather than coming back out of here:
 * a hook that returns a ref inside an object makes every read of that object
 * a ref read during render.
 *
 * @param stageRef The element the content is fitted into.
 * @param content Drawing-space box to frame. A new object each render is fine;
 *   only its numbers are read.
 * @param resetKey Changing it re-fits — a different design gets a fresh view.
 */
export function useFitView<T extends HTMLElement>(
  stageRef: RefObject<T | null>,
  content: ContentBox,
  resetKey: string,
): FitView<T> {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  // Once the user has moved the view, a resize must not yank it back.
  const touchedRef = useRef(false);
  const { x, y, width, height } = content;

  const fit = useCallback(() => {
    const node = stageRef.current;
    if (!node) return;
    const fitted = computeFit({
      stageWidth: node.clientWidth,
      stageHeight: node.clientHeight,
      box: { x, y, width, height },
    });
    if (!fitted) return;
    setZoom(fitted.zoom);
    setPan(fitted.pan);
    touchedRef.current = false;
  }, [height, stageRef, width, x, y]);

  // Before paint, so the diagram is never briefly visible in the corner.
  useLayoutEffect(() => {
    touchedRef.current = false;
    fit();
  }, [fit, resetKey]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (touchedRef.current) return;
      fit();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit, stageRef]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      touchedRef.current = true;
      setZoom((current) =>
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * (event.deltaY < 0 ? 1.1 : 0.9))),
      );
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [stageRef]);

  const zoomBy = useCallback((factor: number) => {
    touchedRef.current = true;
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)));
  }, []);

  const panHandlers = {
    onPointerDown: (event: ReactPointerEvent<T>) => {
      dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<T>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      // A click inside the diagram is a pointer down and up in the same place;
      // only real movement counts as taking the view over.
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) touchedRef.current = true;
      setPan({ x: drag.panX + dx, y: drag.panY + dy });
    },
    onPointerUp: (event: ReactPointerEvent<T>) => {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
  };

  return {
    zoom,
    pan,
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    fit,
    zoomBy,
    panHandlers,
  };
}
