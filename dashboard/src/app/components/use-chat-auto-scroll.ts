"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

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

/**
 * Follows a streaming answer until the user scrolls upward. Follow mode is
 * intentionally reset only when a new answer begins, never merely because the
 * user returns to the bottom during the current answer.
 */
export function useChatAutoScroll<T extends HTMLElement>({
  isResponding,
  responseKey,
  contentKey,
  enabled = true,
}: ChatAutoScrollOptions): RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const followingRef = useRef(true);
  const respondingRef = useRef(false);
  const previousRespondingRef = useRef(false);
  const activeResponseKeyRef = useRef<string | null>(null);
  const lastScrollTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);

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
    });
  }, []);

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
  }, [contentKey, enabled, isResponding, scheduleScrollToBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;

    const stopFollowing = () => {
      if (respondingRef.current || frameRef.current !== null) {
        followingRef.current = false;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stopFollowing();
    };
    const handleScroll = () => {
      const nextScrollTop = container.scrollTop;
      if (nextScrollTop < lastScrollTopRef.current - 1) stopFollowing();
      lastScrollTopRef.current = nextScrollTop;
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observed = container.firstElementChild ?? container;
    const observer = new ResizeObserver(() => {
      if (respondingRef.current && followingRef.current) {
        scheduleScrollToBottom();
      }
    });
    observer.observe(observed);
    return () => observer.disconnect();
  }, [contentKey, scheduleScrollToBottom]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return containerRef;
}
