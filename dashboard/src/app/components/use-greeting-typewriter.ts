"use client";

import { useEffect, useRef, useState } from "react";

// Typing runs on 32-46ms timers, so any long task lands as a visible stall.
// Deferrable work (the Terminal dock prebuilding its body) waits for this.
let typingCount = 0;
const settledWaiters = new Set<() => void>();

/** Runs `callback` once no greeting is typing; returns a cancel function. */
export function whenGreetingsSettled(callback: () => void): () => void {
  if (typingCount === 0) {
    callback();
    return () => undefined;
  }
  settledWaiters.add(callback);
  return () => settledWaiters.delete(callback);
}

function markTyping(active: boolean) {
  typingCount = Math.max(0, typingCount + (active ? 1 : -1));
  if (typingCount > 0) return;
  const waiters = [...settledWaiters];
  settledWaiters.clear();
  for (const waiter of waiters) waiter();
}

/**
 * Calls `start` once no long task has run for 300ms and the browser is idle
 * (or after 2s regardless), at least 180ms out so the full line is seen first.
 * A single idle gap is not enough: a load burst has short lulls between renders.
 */
function whenMainThreadQuiet(start: () => void, onCancel: (cancel: () => void) => void) {
  const begun = performance.now();
  let lastLongTaskEnd = begun;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) lastLongTaskEnd = Math.max(lastLongTaskEnd, entry.startTime + entry.duration);
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    observer = null;
  }
  let timer = 0;
  let idle = 0;
  const finish = () => {
    observer?.disconnect();
    start();
  };
  const check = (deadline?: IdleDeadline) => {
    const now = performance.now();
    const quiet = now - lastLongTaskEnd >= 300 && (!deadline || deadline.timeRemaining() >= 20);
    if (now - begun >= 2_000 || (now - begun >= 180 && quiet)) {
      finish();
      return;
    }
    // Poll on a short timer; an idle callback alone fires inside a burst's lulls.
    timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(check, { timeout: 500 });
      else check();
    }, 100);
  };
  timer = window.setTimeout(() => check(), 180);
  onCancel(() => {
    window.clearTimeout(timer);
    if (idle) window.cancelIdleCallback(idle);
    observer?.disconnect();
  });
}

/** Shared erase/pause/type sequence for browser and new-tab greetings. */
interface GreetingAnimationOptions {
  enabled?: boolean;
  animateInitial?: boolean;
}

export function useGreetingTypewriter(
  target: string,
  initialText = "",
  { enabled = true, animateInitial = false }: GreetingAnimationOptions = {},
) {
  const displayedRef = useRef(initialText);
  const completedTarget = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [displayed, setDisplayed] = useState(initialText);
  const [animating, setAnimating] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!target || !enabled || !visible) return;
    let cancelled = false;
    let timer: number | null = null;
    let typing = false;
    let cancelQuiet = () => {};
    const stopTyping = () => {
      if (!typing) return;
      typing = false;
      markTyping(false);
    };
    const frame = window.requestAnimationFrame(() => {
      if (reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        completedTarget.current = target;
        displayedRef.current = target;
        setDisplayed(target);
        setAnimating(false);
        return;
      }
      if (displayedRef.current === target && (!animateInitial || completedTarget.current === target)) {
        setAnimating(false);
        return;
      }

      let current = displayedRef.current;
      setAnimating(true);
      typing = true;
      markTyping(true);
      const commit = (value: string) => {
        current = value;
        displayedRef.current = value;
        setDisplayed(value);
      };
      const write = (index: number) => {
        if (cancelled) return;
        commit(target.slice(0, index));
        if (index < target.length) timer = window.setTimeout(() => write(index + 1), 46);
        else {
          completedTarget.current = target;
          setAnimating(false);
          stopTyping();
        }
      };
      const erase = () => {
        if (cancelled) return;
        if (current.length > 0) {
          commit(current.slice(0, -1));
          timer = window.setTimeout(erase, 32);
        } else {
          timer = window.setTimeout(() => write(1), 260);
        }
      };
      // A greeting that arrived asynchronously should become visible at once.
      // Keep the pause only between an old greeting being erased and its
      // replacement; an initially empty line has nothing to pause after.
      if (current.length === 0) write(1);
      // Leave the complete server-rendered line visible until the page's load
      // burst has passed: typing on 32-46ms timers through hydration and data
      // renders stuttered, and the full line is already readable meanwhile.
      // A prewarmed Terminal must not spend its animation offscreen.
      else if (animateInitial) whenMainThreadQuiet(() => { if (!cancelled) erase(); }, (cancel) => { cancelQuiet = cancel; });
      else erase();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
      cancelQuiet();
      stopTyping();
    };
  }, [reducedMotion, target, enabled, visible, animateInitial]);

  return { displayed, animating: animating && enabled && visible };
}
