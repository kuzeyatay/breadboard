"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

export const MARQUEE_DELAY_MS = 350;
export const MARQUEE_SPEED_PX_PER_SEC = 42;
/** Share of the animation spent travelling one way; the rest is the pause at each end. */
export const MARQUEE_TRAVEL_SHARE = 0.36;

/** Measure the real clipped width only after hover intent is clear. */
export function useOverflowMarquee<T extends HTMLElement>(
  textRef: RefObject<T | null>,
) {
  const timerRef = useRef<number | null>(null);
  const [scroll, setScroll] = useState<{
    distance: number;
    duration: number;
  } | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setScroll(null);
  }, []);

  const start = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const text = textRef.current;
      if (!text) return;
      const distance = text.scrollWidth - text.clientWidth;
      // Sub-pixel overflow is rounding, not a cut-off name.
      if (distance < 2) return;
      const duration =
        distance / MARQUEE_SPEED_PX_PER_SEC / MARQUEE_TRAVEL_SHARE;
      setScroll({ distance, duration });
    }, MARQUEE_DELAY_MS);
  }, [textRef]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    running: scroll !== null,
    style: scroll
      ? ({
          "--bb-marquee-distance": `${scroll.distance}px`,
          "--bb-marquee-duration": `${scroll.duration.toFixed(2)}s`,
        } as CSSProperties)
      : undefined,
    start,
    stop,
  };
}

export default function OverflowMarquee({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const marquee = useOverflowMarquee(textRef);

  function startOnHover() {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      marquee.start();
  }

  return (
    <span
      className={`bb-chat-marquee ${className}`.trim()}
      onMouseEnter={startOnHover}
      onMouseLeave={marquee.stop}
    >
      <span
        ref={textRef}
        className="bb-chat-marquee-text"
        data-marquee={marquee.running ? "run" : undefined}
        style={marquee.style}
      >
        {children}
      </span>
    </span>
  );
}
