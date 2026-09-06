"use client";

import { useEffect, useRef, useState } from "react";

/** The reveal never types slower than this, so short answers stay readable. */
const MIN_CHARS_PER_SECOND = 60;
/**
 * Time constant of the catch-up: each frame reveals backlog/horizon chars per
 * second, so the pace eases out as it closes in — quicker through a burst,
 * settling to the floor rate for the tail.
 */
const CATCH_UP_SECONDS = 2.4;
/** A tighter horizon once the turn is over, so the tail never sits unfinished. */
const SETTLE_SECONDS = 0.9;

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
 * What the reveal is doing right now: the text on screen, whether it is being
 * paced, and the streaming flag it last saw (so a turn starting can be spotted
 * as an edge rather than a level).
 */
export type RevealState = {
  shown: string;
  pacing: boolean;
  streaming: boolean;
  /** Transcript currently owning `shown`. */
  revealKey?: string;
};

/**
 * Decides, before anything is drawn, whether the text arriving is being
 * *written* or merely *fetched* — and snaps the fetched kind straight onto the
 * screen.
 *
 * Pacing belongs to a live turn, not to text. It is armed the moment a turn
 * starts streaming into the newest row, and disarmed whenever a different
 * answer arrives with no turn behind it: opening a saved chat, switching
 * chats, a branch switch. Text that grows while unarmed — a transcript loading
 * in after mount — appears whole, so a chat you open does not retype answers
 * that were written minutes ago. Pure, so the gate is testable without a
 * renderer, and idempotent, so applying it during render settles in one pass.
 */
export function armReveal(
  state: RevealState,
  target: string,
  streaming: boolean,
  revealKey = state.revealKey,
): RevealState {
  if (revealKey !== state.revealKey) {
    // A different transcript is already text, even when it is still live.
    // Draw the snapshot we fetched in full, then leave `streaming` false for
    // one render so the same turn can arm pacing for deltas that arrive after
    // this snapshot. Without the turn identity, reopening a working chat made
    // its cached prefix type through the newer text all over again.
    return {
      shown: target,
      pacing: false,
      streaming: false,
      revealKey,
    };
  }
  let pacing = state.pacing;
  if (streaming && !state.streaming) pacing = true;
  let shown = state.shown;
  if (!target.startsWith(shown)) {
    shown = target;
    if (!streaming) pacing = false;
  } else if (!pacing && shown !== target) {
    shown = target;
  }
  // The first delivery is finished. Later history refreshes are saved text,
  // even when this hook stays mounted on the same conversation.
  if (!streaming && shown === target) pacing = false;
  return { shown, pacing, streaming, revealKey };
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
 * Only a live turn is paced — `armReveal` holds that gate — and the pacing is
 * skipped entirely when the viewer prefers reduced motion.
 */
export function useSmoothStreamText(
  target: string,
  streaming: boolean,
  revealKey?: string,
): string {
  const [state, setState] = useState<RevealState>(() => ({
    shown: target,
    pacing: false,
    // Treat a live mount as an edge. Its existing snapshot is already shown,
    // but output arriving after the mount should still be paced.
    streaming: false,
    revealKey,
  }));
  const lastTickRef = useRef<number | null>(null);

  // Adjusted during render — React's adjust-on-prop pattern — so text that
  // must not animate is discarded before it is ever committed, instead of
  // being retyped for a frame first.
  const next = armReveal(state, target, streaming, revealKey);
  if (
    next.shown !== state.shown ||
    next.pacing !== state.pacing ||
    next.streaming !== state.streaming ||
    next.revealKey !== state.revealKey
  ) {
    setState(next);
  }

  const { shown, pacing } = next;
  useEffect(() => {
    if (!pacing || shown === target || !target.startsWith(shown)) {
      lastTickRef.current = null;
      return;
    }
    // One advance per committed frame; the state change re-runs this effect,
    // which schedules the next frame until the reveal has caught up.
    let settled = false;
    const frame = window.requestAnimationFrame((now) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      const revealed = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? target
        : advanceReveal(shown, target, (now - last) / 1000, streaming);
      setState((current) => ({ ...current, shown: revealed }));
    });
    // Chromium can suspend animation frames for an occluded desktop view even
    // while document.visibilityState is "visible". Text has already arrived;
    // animation must never keep a completed answer blank in that view.
    const fallback = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.cancelAnimationFrame(frame);
      lastTickRef.current = null;
      setState((current) => ({ ...current, shown: target, pacing: false }));
    }, 250);
    return () => {
      settled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [pacing, shown, target, streaming]);

  return shown;
}
