"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * How far the newest content has to sit below the fold before the transcript
 * offers to take the reader back to it. Roughly one line of chat plus its
 * spacing, so an almost-bottom position is still treated as "at the bottom".
 */
const AWAY_FROM_BOTTOM_DISTANCE = 96;

type ScrollMessage = {
  role: string;
  id?: string | number;
  clientMessageId?: string;
  createdAt?: string;
  content?: string;
};

/**
 * Identifies the answer currently being generated. The key deliberately comes
 * from the latest user message, so it stays stable while assistant tokens are
 * appended and changes even when two consecutive prompts have identical text.
 */
export function chatAutoScrollResponseKey(
  messages: readonly ScrollMessage[],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const identity =
      message.clientMessageId ??
      message.id ??
      message.createdAt ??
      `${message.content?.length ?? 0}:${message.content?.slice(-24) ?? ""}`;
    return `${index}:${identity}`;
  }
  return "no-user-message";
}

/** A compact render key that changes as the visible response streams. */
export function chatAutoScrollContentKey(
  messages: readonly ScrollMessage[],
): string {
  const message = messages[messages.length - 1];
  if (!message) return "empty";
  const content = message.content ?? "";
  return `${messages.length}:${message.role}:${message.clientMessageId ?? message.id ?? message.createdAt ?? ""}:${content.length}:${content.slice(-32)}`;
}

/**
 * The seam between a virtualized transcript and this hook.
 *
 * A virtualized transcript keeps only the rows around the fold in the DOM, so
 * two things this hook used to read straight off the element stop being true:
 * "scroll to the bottom of the content" has to be asked of the virtualizer,
 * which knows where the newest row will land once it is mounted; and a scroll
 * the virtualizer performs itself while replacing an estimated row height with
 * the measured one must not be mistaken for the reader scrolling upward.
 *
 * The bridge is created by the surface and handed to both sides, so neither
 * has to import the other.
 */
export type ChatVirtualBridge = {
  /** Raised while the virtualizer is correcting the scroller after a measurement. */
  programmaticRef: RefObject<boolean>;
  /** True once a virtualized list has claimed this bridge. */
  activeRef: RefObject<boolean>;
  /** Puts the newest row at the foot of the viewport. */
  scrollToEnd: (behavior: ScrollBehavior) => void;
  /** Called by the virtualized list as it mounts and unmounts. */
  attach: (scrollToEnd: ((behavior: ScrollBehavior) => void) | null) => void;
};

/**
 * Creates the bridge above. Safe to call on a surface that is not virtualized:
 * an unclaimed bridge leaves this hook on its original element-based path.
 */
export function useChatVirtualBridge(): ChatVirtualBridge {
  const programmaticRef = useRef(false);
  const activeRef = useRef(false);
  const scrollToEndRef = useRef<((behavior: ScrollBehavior) => void) | null>(
    null,
  );

  return useMemo(
    () => ({
      programmaticRef,
      activeRef,
      scrollToEnd: (behavior: ScrollBehavior) =>
        scrollToEndRef.current?.(behavior),
      attach: (scrollToEnd: ((behavior: ScrollBehavior) => void) | null) => {
        scrollToEndRef.current = scrollToEnd;
        activeRef.current = scrollToEnd !== null;
      },
    }),
    [],
  );
}

type ChatAutoScrollOptions = {
  isResponding: boolean;
  responseKey: string;
  contentKey: string;
  enabled?: boolean;
  /** Present when the transcript below this scroller is virtualized. */
  virtual?: ChatVirtualBridge;
};

export type ChatAutoScroll<T extends HTMLElement> = {
  /** Attach to the scrolling transcript element. */
  ref: RefObject<T | null>;
  /** True while the newest content sits below the visible area. */
  awayFromBottom: boolean;
  /** Glides back to the newest content and resumes following the answer. */
  scrollToBottom: () => void;
};

/**
 * Follows a streaming answer until the user scrolls upward. Follow mode is
 * intentionally reset only when a new answer begins, never merely because the
 * user returns to the bottom during the current answer.
 *
 * It also reports whether the reader has drifted away from the newest content,
 * which is what lets a transcript offer a way back down.
 */
export function useChatAutoScroll<T extends HTMLElement>({
  isResponding,
  responseKey,
  contentKey,
  enabled = true,
  virtual,
}: ChatAutoScrollOptions): ChatAutoScroll<T> {
  const containerRef = useRef<T>(null);
  const followingRef = useRef(true);
  const respondingRef = useRef(false);
  const previousRespondingRef = useRef(false);
  const activeResponseKeyRef = useRef<string | null>(null);
  const lastScrollTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  /** Set while a requested glide to the bottom is still travelling. */
  const jumpingRef = useRef(false);

  const measureDistance = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const away = distance > AWAY_FROM_BOTTOM_DISTANCE;
    // A requested glide passes through "away" on every frame of its way down.
    // Ignoring those frames keeps the control from blinking back into view
    // underneath the reader's cursor mid-animation.
    if (away && jumpingRef.current) return;
    if (!away) jumpingRef.current = false;
    setAwayFromBottom(away);
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    followingRef.current = true;
    jumpingRef.current = true;
    setAwayFromBottom(false);
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A virtualized transcript's scrollHeight is only an estimate for the rows
    // that are not mounted, so the glide has to be aimed by the virtualizer,
    // which re-aims it as those rows are measured on the way down.
    if (virtual?.activeRef.current) {
      virtual.scrollToEnd(reduceMotion ? "auto" : "smooth");
      return;
    }
    if (typeof container.scrollTo === "function") {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [virtual]);

  const scheduleScrollToBottom = useCallback((finishResponse = false) => {
    if (typeof window === "undefined") return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const container = containerRef.current;
      if (
        !container ||
        (!respondingRef.current && !finishResponse) ||
        !followingRef.current
      ) {
        return;
      }
      if (virtual?.activeRef.current) {
        virtual.scrollToEnd("auto");
      } else {
        container.scrollTop = container.scrollHeight;
      }
      lastScrollTopRef.current = container.scrollTop;
      measureDistance();
    });
  }, [measureDistance, virtual]);

  useEffect(() => {
    const responding = enabled && isResponding;
    const wasResponding = previousRespondingRef.current;
    respondingRef.current = responding;

    if (
      responding &&
      (!wasResponding ||
        activeResponseKeyRef.current !== responseKey)
    ) {
      followingRef.current = true;
      activeResponseKeyRef.current = responseKey;
      scheduleScrollToBottom();
    }

    // A short response can finish in the same React batch as its first visible
    // content. Land that final render only when the user is still following.
    if (enabled && wasResponding && !responding && followingRef.current) {
      scheduleScrollToBottom(true);
    }

    previousRespondingRef.current = responding;
  }, [enabled, isResponding, responseKey, scheduleScrollToBottom]);

  useEffect(() => {
    if (enabled && isResponding && followingRef.current) {
      scheduleScrollToBottom();
    }
    // Content that arrives without moving the scroll position still changes how
    // far the newest message sits below the fold.
    measureDistance();
  }, [contentKey, enabled, isResponding, measureDistance, scheduleScrollToBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    measureDistance();

    const stopFollowing = () => {
      if (respondingRef.current || frameRef.current !== null) {
        followingRef.current = false;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        // Reading upward cancels a glide the reader no longer wants.
        jumpingRef.current = false;
        stopFollowing();
      }
    };
    const handleScroll = () => {
      const nextScrollTop = container.scrollTop;
      // A virtualizer nudges the scroller backwards when a row above the fold
      // turns out to be shorter than its estimate. That is bookkeeping, not the
      // reader deciding to read upward, so it must not end follow mode.
      if (virtual?.programmaticRef.current) {
        lastScrollTopRef.current = nextScrollTop;
        measureDistance();
        return;
      }
      if (nextScrollTop < lastScrollTopRef.current - 1) {
        jumpingRef.current = false;
        stopFollowing();
      }
      lastScrollTopRef.current = nextScrollTop;
      measureDistance();
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [measureDistance, virtual]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observed = container.firstElementChild ?? container;
    const observer = new ResizeObserver(() => {
      if (respondingRef.current && followingRef.current) {
        scheduleScrollToBottom();
      }
      measureDistance();
    });
    observer.observe(observed);
    return () => observer.disconnect();
  }, [contentKey, measureDistance, scheduleScrollToBottom]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return { ref: containerRef, awayFromBottom, scrollToBottom };
}
