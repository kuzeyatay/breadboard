"use client";

import { useEffect, useRef, useState } from "react";

/** The reveal never types slower than this, so short answers stay snappy. */
const MIN_CHARS_PER_SECOND = 220;
/**
 * Time constant of the catch-up: each frame reveals backlog/horizon chars per
 * second, so the pace eases out as it closes in — fast through a burst,
 * settling to the floor rate for the tail.
 */
const CATCH_UP_SECONDS = 0.9;
/** A tighter horizon once the turn is over, so the tail never sits unfinished. */
const SETTLE_SECONDS = 0.35;

/**
 * One pacing step: how much of `target` should be shown `dtSeconds` after
 * `shown` was on screen. Pure so the reveal contract is testable without a
 * renderer. Guarantees: the result is always a prefix of `target` on a whole
 * code point; it never moves backwards while `shown` is a prefix; and a target
 * that is not an extension of `shown` (chat switch, branch switch, completion
 * rewrite) snaps whole.
 */
export function advanceReveal(
  shown: string,
  target: string,
  dtSeconds: number,
  streaming: boolean,
): string {
  if (!target.startsWith(shown)) return target;
  const backlog = target.length - shown.length;
  if (backlog <= 0) return target;
  const horizon = streaming ? CATCH_UP_SECONDS : SETTLE_SECONDS;
  const rate = Math.max(MIN_CHARS_PER_SECOND, backlog / horizon);
  const dt = Math.min(0.1, Math.max(1 / 60, dtSeconds));
  let next = Math.min(
    target.length,
    shown.length + Math.max(1, Math.round(rate * dt)),
  );
  // Never cut a surrogate pair in half — half an emoji renders as a
  // replacement glyph for a frame.
  const boundary = target.charCodeAt(next - 1);
  if (next < target.length && boundary >= 0xd800 && boundary <= 0xdbff) {
    next += 1;
  }
  return target.slice(0, next);
}

/**
 * Paces a streaming assistant reply onto the screen.
 *
 * Providers and the agent pipeline deliver text in uneven bursts — sometimes a
 * whole answer in one chunk — so rendering the raw buffer makes replies pop in
 * as blocks. This hook chases the live buffer instead: the shown text is
 * always a prefix of the real one, advanced every animation frame by
 * `advanceReveal`. A burst that lands together with turn completion still
 * types out (at the quicker settle rate) rather than snapping.
 *
 * The pacing is skipped when the viewer prefers reduced motion, and whenever
 * the target stops being an extension of what is shown.
 */
export function useSmoothStreamText(
  target: string,
  streaming: boolean,
): string {
  const [shown, setShown] = useState(target);
  const lastTickRef = useRef<number | null>(null);

  // A target that is not an extension of what is shown (chat switch, branch
  // switch, completion rewrite) snaps whole. Adjusted during render — the
  // stale text is discarded before it is ever committed — instead of one
  // frame late in an effect.
  if (!target.startsWith(shown)) {
    setShown(target);
  }

  useEffect(() => {
    if (shown === target || !target.startsWith(shown)) {
      lastTickRef.current = null;
      return;
    }
    // One advance per committed frame; the state change re-runs this effect,
    // which schedules the next frame until the reveal has caught up.
    const frame = window.requestAnimationFrame((now) => {
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      const next = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? target
        : advanceReveal(shown, target, (now - last) / 1000, streaming);
      setShown(next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shown, target, streaming]);

  return shown;
}
