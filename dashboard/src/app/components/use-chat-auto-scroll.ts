"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

/** The landing below has to beat the paint, but this file also renders on the server. */
const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;

/**
 * How far the newest content has to sit below the fold before the transcript
 * offers to take the reader back to it. Roughly one line of chat plus its
 * spacing, so an almost-bottom position is still treated as "at the bottom".
 */
const AWAY_FROM_BOTTOM_DISTANCE = 96;

/**
 * How long a landing keeps re-aiming itself after a conversation is opened.
 * A transcript settles over several frames rather than one — markdown and code
 * blocks lay themselves out late, and a virtualized list is still replacing row
 * estimates with measurements — so the foot of the conversation moves for a
 * moment after the first jump. Short enough that it can never be felt as the
 * transcript fighting the reader.
 */
const LANDING_SETTLE_MS = 1_200;

/** Frames at an unchanged height that end a landing before its deadline. */
const LANDING_STABLE_FRAMES = 3;

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
 * Whether a change of conversation identity is a conversation being *opened* —
 * the one event that puts a reader at the end of a transcript.
 *
 * The distinction that matters is the same one the virtualized list draws about
 * its measurements: a conversation being *created* is not a conversation being
 * opened. A new chat's id arrives mid-turn, on the very rows already on screen,
 * so treating it as an open would drag a reader who had scrolled up back down
 * onto an answer that is still being written. Nothing else about a null
 * identity is special: opening a saved chat while sitting on an empty new one
 * is a real open, and it is the turn in flight that tells the two apart.
 */
export function chatConversationWasOpened({
  previous,
  next,
  responding,
}: {
  /** The identity last landed on. `undefined` means the transcript is new. */
  previous: string | number | null | undefined;
  next: string | number | null;
  /** True when a turn owns the transcript at the moment the identity changes. */
  responding: boolean;
}): boolean {
  if (previous === next) return false;
  if (previous === undefined) return true;
  return !(previous === null && responding);
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
/**
 * What a mounted virtualized list lends the rest of the transcript. Every one of
 * these has to be asked of the virtualizer rather than read off the scroller,
 * because the rows they speak about are usually not in the DOM.
 */
export type ChatVirtualHandlers = {
  /** Puts the newest row at the foot of the viewport. */
  scrollToEnd: (behavior: ScrollBehavior) => void;
  /** Puts one specific row at the top of the viewport. */
  scrollToIndex: (index: number, behavior: ScrollBehavior) => void;
  /**
   * How far down the scrolled content a row begins, in the same units as
   * `scrollTop`. Below the fold this comes from the estimates, which is what
   * lets a position indicator speak about rows that were never mounted.
   *
   * Rows past the point where the scroller runs out of travel all report the
   * furthest it can go. That is deliberate: a reader at the bottom is exactly
   * as close to every one of them, and "the newest" is the right answer there.
   */
  getRowStart: (index: number) => number | null;
};

export type ChatVirtualBridge = ChatVirtualHandlers & {
  /** Raised while the virtualizer is correcting the scroller after a measurement. */
  programmaticRef: RefObject<boolean>;
  /** True once a virtualized list has claimed this bridge. */
  activeRef: RefObject<boolean>;
  /** Called by the virtualized list as it mounts and unmounts. */
  attach: (handlers: ChatVirtualHandlers | null) => void;
};

/**
 * Creates the bridge above. Safe to call on a surface that is not virtualized:
 * an unclaimed bridge leaves this hook on its original element-based path.
 */
export function useChatVirtualBridge(): ChatVirtualBridge {
  const programmaticRef = useRef(false);
  const activeRef = useRef(false);
  const handlersRef = useRef<ChatVirtualHandlers | null>(null);

  return useMemo(
    () => ({
      programmaticRef,
      activeRef,
      scrollToEnd: (behavior: ScrollBehavior) =>
        handlersRef.current?.scrollToEnd(behavior),
      scrollToIndex: (index: number, behavior: ScrollBehavior) =>
        handlersRef.current?.scrollToIndex(index, behavior),
      getRowStart: (index: number) =>
        handlersRef.current?.getRowStart(index) ?? null,
      attach: (handlers: ChatVirtualHandlers | null) => {
        handlersRef.current = handlers;
        activeRef.current = handlers !== null;
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
  /**
   * Conversation identity, the same one the transcript scopes its row
   * measurements to. Opening a conversation lands the reader on its newest
   * message; without this the transcript would open at the beginning, which is
   * the one place in a chat nobody means to start reading.
   */
  conversationKey?: string | number | null;
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
 * Given a `conversationKey` it also opens every conversation where a reader
 * expects to be put down — on its newest message, not at its beginning.
 *
 * It also reports whether the reader has drifted away from the newest content,
 * which is what lets a transcript offer a way back down.
 */
export function useChatAutoScroll<T extends HTMLElement>({
  isResponding,
  responseKey,
  contentKey,
  enabled = true,
  conversationKey,
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
  /** Set while an opened conversation is still settling onto its last message. */
  const landingRef = useRef(false);
  const landingFrameRef = useRef<number | null>(null);
  /** The conversation the last landing was spent on. `undefined` means none yet. */
  const landedKeyRef = useRef<string | number | null | undefined>(undefined);
  /**
   * Raised between opening a conversation and its messages being on screen. A
   * chat kept on the server arrives a beat after the chat itself, so the
   * landing has to survive until there is something to land on.
   */
  const awaitingContentRef = useRef(false);

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

  /**
   * Puts the foot of the conversation at the foot of the viewport, now, with no
   * animation. A virtualized transcript has to be aimed by the virtualizer,
   * which knows where the newest row lands even though it is not mounted yet.
   */
  const pinToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (virtual?.activeRef.current) {
      virtual.scrollToEnd("auto");
    } else {
      container.scrollTop = container.scrollHeight;
    }
    // Written back before the scroll event this caused is delivered, so the
    // hook does not read its own write as the reader scrolling upward.
    lastScrollTopRef.current = container.scrollTop;
  }, [virtual]);

  const cancelLanding = useCallback(() => {
    awaitingContentRef.current = false;
    if (!landingRef.current) return;
    landingRef.current = false;
    jumpingRef.current = false;
    if (landingFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(landingFrameRef.current);
      landingFrameRef.current = null;
    }
  }, []);

  /**
   * What opening a conversation does: go straight to the newest message, then
   * hold that position while the transcript finishes laying itself out. The
   * first jump is made here rather than in a frame callback so the reader never
   * sees the top of the conversation drawn on the way past.
   */
  const landOnNewestMessage = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // Opening a conversation is a fresh start, not the reader having chosen to
    // read away from an answer.
    followingRef.current = true;
    landingRef.current = true;
    // A landing passes through "away from the bottom" on its early frames; the
    // control that offers a way back must not blink through them.
    jumpingRef.current = true;
    setAwayFromBottom(false);
    pinToBottom();

    if (typeof window === "undefined") {
      landingRef.current = false;
      jumpingRef.current = false;
      return;
    }
    if (landingFrameRef.current !== null) {
      window.cancelAnimationFrame(landingFrameRef.current);
    }

    let startedAt: number | null = null;
    let previousHeight = container.scrollHeight;
    let stableFrames = 0;
    const step = (now: number) => {
      landingFrameRef.current = null;
      if (!landingRef.current) return;
      const element = containerRef.current;
      if (!element) {
        landingRef.current = false;
        jumpingRef.current = false;
        return;
      }
      startedAt ??= now;
      pinToBottom();
      const height = element.scrollHeight;
      stableFrames = height === previousHeight ? stableFrames + 1 : 0;
      previousHeight = height;
      // Settled once the transcript has stopped changing shape underneath the
      // landing — or once it has had long enough that anything still moving is
      // no longer part of opening the conversation.
      if (
        stableFrames >= LANDING_STABLE_FRAMES ||
        now - startedAt >= LANDING_SETTLE_MS
      ) {
        landingRef.current = false;
        jumpingRef.current = false;
        measureDistance();
        return;
      }
      landingFrameRef.current = window.requestAnimationFrame(step);
    };
    landingFrameRef.current = window.requestAnimationFrame(step);
  }, [measureDistance, pinToBottom]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // An explicit jump replaces a landing that is still travelling.
    cancelLanding();
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
  }, [cancelLanding, virtual]);

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
      pinToBottom();
      measureDistance();
    });
  }, [measureDistance, pinToBottom]);

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

  // Opening a conversation puts the reader at the end of it. A layout effect,
  // because the alternative is one painted frame of the top of the transcript
  // before the jump — and the transcript below this hook clears its scroller on
  // the same commit, so this has to be the last word on that frame. Child
  // effects run before the parent's, which is what makes that true.
  useIsomorphicLayoutEffect(() => {
    if (!enabled) {
      // A transcript that is put away lands again when it is opened.
      landedKeyRef.current = undefined;
      return;
    }
    if (conversationKey === undefined) return;
    const previous = landedKeyRef.current;
    if (previous === conversationKey) return;
    landedKeyRef.current = conversationKey;
    if (
      !chatConversationWasOpened({
        previous,
        next: conversationKey,
        responding: respondingRef.current,
      })
    ) {
      return;
    }
    // The messages of a chat kept on the server arrive after the chat itself,
    // so the landing stays owed until there is something below the fold.
    awaitingContentRef.current = true;
    landOnNewestMessage();
  }, [conversationKey, enabled, landOnNewestMessage]);

  useEffect(() => {
    if (enabled && awaitingContentRef.current) {
      const container = containerRef.current;
      // Nothing overflows yet on an empty transcript, and landing on it would
      // be landing on nothing — so the debt is only settled once the
      // conversation is long enough to have a foot the reader cannot see.
      if (container && container.scrollHeight > container.clientHeight) {
        awaitingContentRef.current = false;
      }
      landOnNewestMessage();
    } else if (enabled && isResponding && followingRef.current) {
      scheduleScrollToBottom();
    }
    // Content that arrives without moving the scroll position still changes how
    // far the newest message sits below the fold.
    measureDistance();
  }, [
    contentKey,
    enabled,
    isResponding,
    landOnNewestMessage,
    measureDistance,
    scheduleScrollToBottom,
  ]);

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
        cancelLanding();
        stopFollowing();
      }
    };
    // Touch scrolling raises no wheel event, and a landing has to lose to a
    // finger on the transcript the same way it loses to a wheel.
    const handleTouchMove = () => cancelLanding();
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
        // A landing re-aims itself as the rows it is travelling past are
        // measured, and each correction moves the scroller backwards without
        // anyone having asked for it. While one is in flight, only a gesture —
        // handled above — is allowed to end it.
        if (!landingRef.current) {
          jumpingRef.current = false;
          // Reading upward also forfeits a landing still owed to a conversation
          // whose messages have not arrived yet — a reader who has gone looking
          // through a transcript is not waiting to be put at the end of it.
          awaitingContentRef.current = false;
          stopFollowing();
        }
      }
      lastScrollTopRef.current = nextScrollTop;
      measureDistance();
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("scroll", handleScroll);
    };
  }, [cancelLanding, measureDistance, virtual]);

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
      if (landingFrameRef.current !== null) {
        window.cancelAnimationFrame(landingFrameRef.current);
      }
    },
    [],
  );

  return { ref: containerRef, awayFromBottom, scrollToBottom };
}
