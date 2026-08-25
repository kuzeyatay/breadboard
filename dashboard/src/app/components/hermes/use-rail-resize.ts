"use client";

// The state behind an edge that both drags and toggles.
//
// The two edges of a garden used to disagree about what an edge is. The left
// rail clicked open and shut, animated, at two fixed widths — and could not be
// made any other size. The learning map on the right dragged to any width and
// collapsed if you dragged it far enough — and could not be clicked at all, so
// putting it away meant a deliberate drag across half the panel. Each was
// missing exactly what the other had.
//
// Width is the single source of truth, the way the map already had it: there is
// no separate open/shut flag to fall out of step with it, and "collapsed" is
// just a width at the rail. A press that never travels is a click and toggles;
// a press that travels is a drag and sets the width; a drag released too narrow
// lands on the rail rather than at some unusable sliver.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Past this many pixels a press stops being a click and becomes a drag. */
const CLICK_SLOP_PX = 4;

export interface RailResize {
  /** The panel's width now, in pixels. */
  width: number;
  /** At the rail — the panel is put away. Derived from the width, never stored. */
  collapsed: boolean;
  /**
   * The width a collapsed panel would come back to. Contents are laid out at
   * this rather than at `width`, so a panel on its way out slides rather than
   * reflowing every line it holds as the box narrows around them.
   */
  openWidth: number;
  /** True for the length of a drag, so the panel can drop its transition. */
  dragging: boolean;
  /** What a click on the edge does: rail ⇄ the width it was last opened to. */
  toggle: () => void;
  /** Hand to `RailDivider`. */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface RailResizeOptions {
  /** Which side of the edge the panel sits on: a left panel widens rightward. */
  side: "left" | "right";
  /** Width when open and untouched. */
  defaultWidth: number;
  /** Narrowest and widest a drag may leave it, short of collapsing. */
  min: number;
  max: number;
  /** The width it rests at when collapsed — an icon rail, or nothing at all. */
  railWidth: number;
  /** A drag released narrower than this collapses instead of resizing. */
  threshold: number;
  /** When set, the width survives a reload. */
  storageKey?: string;
  /**
   * A key holding an older boolean "is it collapsed", read once so a rail that
   * was shut before this existed comes back shut.
   */
  legacyCollapsedKey?: string;
  /**
   * The most of the window the panel may take. A width dragged on a wide window
   * would otherwise keep squeezing the page after the window shrinks, and the
   * desktop shell resizes freely.
   */
  viewportShare?: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where a released drag lands.
 *
 * The gap between the rail and `min` is the interesting part: it is the band a
 * panel may be dragged *through* and never left in, because a chat list at
 * 140px is rendered and unreadable at the same time. Exported so that stays
 * pinned by a test rather than by the two places that call it.
 */
export function settleRailWidth(
  width: number,
  bounds: { min: number; max: number; railWidth: number; threshold: number },
): number {
  return width < bounds.threshold
    ? bounds.railWidth
    : clamp(width, bounds.min, bounds.max);
}

export function useRailResize({
  side,
  defaultWidth,
  min,
  max,
  railWidth,
  threshold,
  storageKey,
  legacyCollapsedKey,
  viewportShare = 0.45,
}: RailResizeOptions): RailResize {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const [maxWidth, setMaxWidth] = useState(max);

  // The width a collapsed panel comes back to. State, because the panel lays
  // its contents out at it while the box travels — and a ref below, because the
  // gesture handlers need the latest without being rebound mid-drag.
  const [openWidth, setOpenWidth] = useState(defaultWidth);

  // Mirrors, read inside a gesture where a stale closure would make the panel
  // jump back to whatever it measured when the press started. Written from an
  // effect, so nothing here touches a ref during a render.
  const widthRef = useRef(width);
  const maxRef = useRef(maxWidth);
  const openRef = useRef(openWidth);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    widthRef.current = width;
    maxRef.current = maxWidth;
    openRef.current = openWidth;
  }, [maxWidth, openWidth, width]);

  const persist = useCallback(
    (next: number) => {
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // A browser that refuses storage still gets a working edge.
      }
    },
    [storageKey],
  );

  // Restored after mount rather than in the initial state, so the server and
  // the first client render agree on the width.
  useEffect(() => {
    let restored: number | null = null;
    try {
      const stored = storageKey ? window.localStorage.getItem(storageKey) : null;
      if (stored !== null && stored.trim() !== "") {
        const parsed = Number(stored);
        if (Number.isFinite(parsed)) restored = parsed;
      }
      if (restored === null && legacyCollapsedKey) {
        if (window.localStorage.getItem(legacyCollapsedKey) === "1") restored = railWidth;
      }
    } catch {
      restored = null;
    }
    if (restored === null) return;
    const next = settleRailWidth(restored, { min, max, railWidth, threshold });
    /* eslint-disable react-hooks/set-state-in-effect -- a stored width cannot
       be the initial state: the server has no localStorage, and seeding from it
       during the first render is a hydration mismatch. One extra render on
       mount is the price of the width surviving a reload. */
    if (next >= threshold) setOpenWidth(next);
    setWidth(next);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [legacyCollapsedKey, max, min, railWidth, storageKey, threshold]);

  useEffect(() => {
    const applyViewportLimit = () => {
      const limit = clamp(Math.round(window.innerWidth * viewportShare), min, max);
      setMaxWidth(limit);
      // A collapsed panel is left alone: its width is the rail, which is below
      // every limit and means something other than "this wide".
      setWidth((current) => (current < threshold ? current : Math.min(current, limit)));
    };
    applyViewportLimit();
    window.addEventListener("resize", applyViewportLimit);
    return () => window.removeEventListener("resize", applyViewportLimit);
  }, [max, min, threshold, viewportShare]);

  // Pointer listeners are installed from an event handler rather than an
  // effect. Keep their disposer in a ref so route navigation or a conditional
  // panel unmount cannot strand a window-level drag subscription (or leave the
  // document in its no-selection resize state).
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    },
    [],
  );

  const toggle = useCallback(() => {
    // Read through the mirror rather than a functional update: collapsing has
    // to remember the width it is leaving, and a second setState belongs
    // nowhere near an updater React is free to run twice.
    const current = widthRef.current;
    if (current >= threshold) {
      setOpenWidth(current);
      setWidth(railWidth);
      persist(railWidth);
      return;
    }
    const next = clamp(openRef.current, min, maxRef.current);
    setWidth(next);
    persist(next);
  }, [min, persist, railWidth, threshold]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // A second press should replace, never stack on, an unfinished gesture.
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      setDragging(false);
      const startX = event.clientX;
      const startWidth = widthRef.current;
      let travelled = false;
      let next = startWidth;

      // Not preventDefault: the edge is a button, and swallowing the press
      // would take its focus with it. Selection is stopped the other way.
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      // Listeners on the window, not pointer capture, so the drag survives the
      // panel swapping between its open and rail renders at the threshold.
      const handleMove = (moveEvent: PointerEvent) => {
        const delta =
          side === "left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        if (!travelled) {
          if (Math.abs(delta) < CLICK_SLOP_PX) return;
          travelled = true;
          setDragging(true);
          document.body.style.cursor = "var(--bb-cursor-col-resize, col-resize)";
        }
        next = clamp(Math.round(startWidth + delta), railWidth, maxRef.current);
        setWidth(next);
      };

      const detach = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
        window.removeEventListener("pointercancel", handleEnd);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        if (dragCleanupRef.current === detach) {
          dragCleanupRef.current = null;
        }
      };

      const handleEnd = () => {
        detach();
        // A press that never travelled is a click, and a click toggles — which
        // is the whole reason the edge no longer needs a button beside it.
        if (!travelled) {
          toggle();
          return;
        }
        setDragging(false);
        const settled = settleRailWidth(next, {
          min,
          max: maxRef.current,
          railWidth,
          threshold,
        });
        if (settled >= threshold) setOpenWidth(settled);
        setWidth(settled);
        persist(settled);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
      window.addEventListener("pointercancel", handleEnd);
      dragCleanupRef.current = detach;
    },
    [min, persist, railWidth, side, threshold, toggle],
  );

  return {
    width,
    collapsed: width < threshold,
    openWidth,
    dragging,
    toggle,
    onPointerDown,
  };
}
