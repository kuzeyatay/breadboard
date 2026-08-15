"use client";

import {
  useCallback,
  useEffect,
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

type ChatAutoScrollOptions = {
  isResponding: boolean;
  responseKey: string;
  contentKey: string;
  enabled?: boolean;
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
    if (typeof container.scrollTo === "function") {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

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
      container.scrollTop = container.scrollHeight;
      lastScrollTopRef.current = container.scrollTop;
      measureDistance();
    });
  }, [measureDistance]);

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
  }, [measureDistance]);

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
