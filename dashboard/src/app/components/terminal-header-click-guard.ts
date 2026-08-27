"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Lets a pointer-driven terminal header also accept a standalone click.
 *
 * A normal pointer gesture is already handled on pointerup, and browsers emit
 * a click immediately afterwards. The hydration bridge, however, can only
 * replay the click when the original gesture landed before React was ready.
 * This guard consumes the former and admits the latter.
 */
export function useTerminalHeaderClickGuard() {
  const pointerClickPendingRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  const cancelReset = useCallback(() => {
    if (resetTimerRef.current === null) return;
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  const beginPointerSequence = useCallback(() => {
    cancelReset();
    pointerClickPendingRef.current = true;
  }, [cancelReset]);

  const endPointerSequence = useCallback(() => {
    cancelReset();
    // A native click follows pointerup in the same browser task. Clear the
    // marker on the next task in case a cancelled gesture produces no click.
    resetTimerRef.current = window.setTimeout(() => {
      pointerClickPendingRef.current = false;
      resetTimerRef.current = null;
    }, 0);
  }, [cancelReset]);

  const shouldHandleClick = useCallback(() => {
    if (!pointerClickPendingRef.current) return true;
    pointerClickPendingRef.current = false;
    cancelReset();
    return false;
  }, [cancelReset]);

  useEffect(() => cancelReset, [cancelReset]);

  return { beginPointerSequence, endPointerSequence, shouldHandleClick };
}
