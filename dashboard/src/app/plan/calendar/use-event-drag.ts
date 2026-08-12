"use client";

// Dragging and resizing events.
//
// Pointer events rather than HTML5 drag-and-drop: DnD cannot express "snap to
// the nearest 15 minutes while you move", it needs a drag image the grid does
// not want, and it behaves differently in the Electron shell. Pointer capture
// gives one element the whole gesture, so leaving the grid mid-drag does not
// strand it.
//
// The hook owns only the gesture. It reports a delta in minutes (time grid) or
// days (month grid); deciding what that means for a recurring series is the
// caller's job.

import { useCallback, useEffect, useRef, useState } from "react";

import type { CalendarOccurrence } from "@/lib/calendar/types.ts";

/** Time-grid drags snap to this, matching how people book meetings. */
export const DRAG_SNAP_MINUTES = 15;

/** Below this the pointer is treated as a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

export type DragMode = "move" | "resize";

export interface DragState {
  occurrence: CalendarOccurrence;
  mode: DragMode;
  /** Whole days moved, for the month grid. */
  dayDelta: number;
  /** Minutes moved (or added to the end, when resizing), for the time grid. */
  minuteDelta: number;
  /** False until the pointer has moved past the click threshold. */
  active: boolean;
}

export interface DragResult {
  occurrence: CalendarOccurrence;
  mode: DragMode;
  dayDelta: number;
  minuteDelta: number;
}

interface Origin {
  pointerId: number;
  x: number;
  y: number;
  mode: DragMode;
  occurrence: CalendarOccurrence;
  /** Pixels per day across the row, for month-grid drags. */
  dayWidth: number;
  /** Pixels per minute down the column, for time-grid drags. */
  minuteHeight: number;
}

export function useEventDrag(onDrop: (result: DragResult) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const origin = useRef<Origin | null>(null);
  // The callback is read at drop time so a re-render mid-gesture cannot leave
  // the listener holding a stale closure over `occurrences`.
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const begin = useCallback(
    (
      event: React.PointerEvent,
      occurrence: CalendarOccurrence,
      mode: DragMode,
      metrics: { dayWidth?: number; minuteHeight?: number },
    ) => {
      if (occurrence.readOnly) return;
      if (event.button !== 0) return;

      origin.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        mode,
        occurrence,
        dayWidth: metrics.dayWidth ?? 0,
        minuteHeight: metrics.minuteHeight ?? 0,
      };

      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      setDrag({ occurrence, mode, dayDelta: 0, minuteDelta: 0, active: false });
    },
    [],
  );

  const move = useCallback((event: React.PointerEvent) => {
    const start = origin.current;
    if (!start || event.pointerId !== start.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const active = Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;

    const dayDelta = start.dayWidth > 0 ? Math.round(dx / start.dayWidth) : 0;
    const minuteDelta =
      start.minuteHeight > 0
        ? Math.round(dy / start.minuteHeight / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES
        : 0;

    setDrag({
      occurrence: start.occurrence,
      mode: start.mode,
      dayDelta,
      minuteDelta,
      active,
    });
  }, []);

  const end = useCallback((event: React.PointerEvent) => {
    const start = origin.current;
    origin.current = null;
    if (!start || event.pointerId !== start.pointerId) {
      setDrag(null);
      return;
    }

    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const moved = Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
    setDrag(null);

    // A gesture that never passed the threshold is a click; the button's own
    // onClick opens the editor, so nothing is reported here.
    if (!moved) return;

    const dayDelta = start.dayWidth > 0 ? Math.round(dx / start.dayWidth) : 0;
    const minuteDelta =
      start.minuteHeight > 0
        ? Math.round(dy / start.minuteHeight / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES
        : 0;

    if (dayDelta === 0 && minuteDelta === 0) return;

    onDropRef.current({
      occurrence: start.occurrence,
      mode: start.mode,
      dayDelta,
      minuteDelta,
    });
  }, []);

  const cancel = useCallback(() => {
    origin.current = null;
    setDrag(null);
  }, []);

  /** True while this occurrence is the one being dragged past the threshold. */
  const isDragging = useCallback(
    (occurrence: CalendarOccurrence) =>
      !!drag && drag.active && drag.occurrence.key === occurrence.key,
    [drag],
  );

  return { drag, begin, move, end, cancel, isDragging };
}
