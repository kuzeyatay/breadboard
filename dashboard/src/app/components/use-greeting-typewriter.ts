"use client";

import { useEffect, useRef, useState } from "react";

/** Shared erase/pause/type sequence for browser and new-tab greetings. */
export function useGreetingTypewriter(target: string, initialText = "") {
  const displayedRef = useRef(initialText);
  const [displayed, setDisplayed] = useState(initialText);
  const [animating, setAnimating] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        displayedRef.current = target;
        setDisplayed(target);
        setAnimating(false);
        return;
      }
      if (displayedRef.current === target) {
        setAnimating(false);
        return;
      }

      let current = displayedRef.current;
      setAnimating(true);
      const commit = (value: string) => {
        current = value;
        displayedRef.current = value;
        setDisplayed(value);
      };
      const write = (index: number) => {
        if (cancelled) return;
        commit(target.slice(0, index));
        if (index < target.length) timer = window.setTimeout(() => write(index + 1), 46);
        else setAnimating(false);
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
      else erase();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [reducedMotion, target]);

  return { displayed, animating };
}
