"use client";

// The one virtualization primitive every Breadboard transcript sits on.
//
// A conversation is kept whole in application state; only the rows around the
// fold are put in the DOM. Everything else about a transcript — the bubbles,
// the spacing, the separators, the activity panels — is left to the surface
// that owns it, which passes its existing row markup in through `renderItem`.
//
// Three things make that safe on chat in particular:
//
//   * rows are measured, never assumed. A message is one line or a thousand,
//     and it grows again while the answer streams;
//   * `gap` is TanStack's own between-row spacing, so the space a surface used
//     to draw with `space-y-*` survives without becoming padding inside a row
//     (padding would be measured, and the last row would gain a phantom tail);
//   * `anchorTo: "end"` keeps a reader pinned to the newest message while it
//     grows, and keeps the row under the fold still when rows above it are
//     measured for the first time.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";

import { CHAT_OVERSCAN } from "@/app/components/chat/chat-row-identity";
import type { ChatVirtualBridge } from "@/app/components/use-chat-auto-scroll";

/** Layout effects are the point here, but this file also renders on the server. */
const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;

export type VirtualizedMessageListProps<T> = {
  /** The rows to draw. Anything a surface hides must be filtered out first. */
  items: readonly T[];
  /** Stable for the lifetime of a loaded conversation. */
  getItemKey: (item: T, index: number) => string | number;
  estimateSize: (item: T, index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  /** The existing transcript scroller. Not created here, and never replaced. */
  scrollRef: RefObject<HTMLElement | null>;
  bridge: ChatVirtualBridge;
  /** The space the un-virtualized list drew between rows, in px. */
  gap: number;
  overscan?: number;
  /**
   * Conversation identity. When it changes every measurement is thrown away,
   * so one conversation can never be laid out with another's row heights.
   */
  resetKey?: string | number | null;
  /** Applied to the sized container that stands in for the old list wrapper. */
  className?: string;
  /** Names this transcript in the development-only mount report. */
  surface: string;
  /**
   * Viewport size to assume before the scroller has been measured. Only used
   * for server rendering, where there is no element to observe.
   */
  initialRect?: { width: number; height: number };
};

export default function VirtualizedMessageList<T>({
  items,
  getItemKey,
  estimateSize,
  renderItem,
  scrollRef,
  bridge,
  gap,
  overscan = CHAT_OVERSCAN,
  resetKey = null,
  className,
  surface,
  initialRect,
}: VirtualizedMessageListProps<T>) {
  const count = items.length;

  // The virtualizer holds onto the option callbacks it was constructed with, so
  // everything it calls per index reads the current render's data through refs.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getItemKeyRef = useRef(getItemKey);
  getItemKeyRef.current = getItemKey;
  const estimateSizeRef = useRef(estimateSize);
  estimateSizeRef.current = estimateSize;

  const releaseTimerRef = useRef<number | null>(null);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      estimateSizeRef.current(itemsRef.current[index] as T, index),
    getItemKey: (index) =>
      getItemKeyRef.current(itemsRef.current[index] as T, index),
    overscan,
    gap,
    // Chat reads from the bottom: a row that grows keeps its foot under the
    // reader's eye instead of pushing the conversation up past them.
    anchorTo: "end",
    initialRect,
    scrollToFn: (offset, options, instance) => {
      // `adjustments` is set only when the virtualizer is compensating for a
      // row whose measured height differed from its estimate. Those writes look
      // exactly like a reader scrolling, so they are flagged for the auto-scroll
      // hook, which would otherwise read one as "stop following the answer".
      if (options.adjustments !== undefined) {
        bridge.programmaticRef.current = true;
        if (typeof window !== "undefined") {
          if (releaseTimerRef.current !== null) {
            window.clearTimeout(releaseTimerRef.current);
          }
          releaseTimerRef.current = window.setTimeout(() => {
            releaseTimerRef.current = null;
            bridge.programmaticRef.current = false;
          }, 120);
        }
      }
      elementScroll(offset, options, instance);
    },
  });

  const scrollToEnd = useCallback(
    (behavior: ScrollBehavior) => {
      if (itemsRef.current.length === 0) return;
      virtualizer.scrollToEnd({ behavior });
    },
    [virtualizer],
  );

  useIsomorphicLayoutEffect(() => {
    bridge.attach(scrollToEnd);
    return () => bridge.attach(null);
  }, [bridge, scrollToEnd]);

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(releaseTimerRef.current);
      }
    },
    [],
  );

  // Opening a different conversation must not inherit the last one's row
  // heights, or the reader lands somewhere arbitrary in a transcript laid out
  // to the wrong shape. Done before paint so the wrong frame is never drawn.
  //
  // A conversation being *created*, though, is not a conversation being opened.
  // The first message of a new chat is drawn before the chat has an id, and the
  // id arrives mid-turn — the same rows, already mounted and already measured.
  // Resetting there would leave every one of them on its estimate for good:
  // `measure()` only clears the size cache, and a row only reports its real
  // height again when it mounts or resizes, neither of which a mounted row does
  // on its own. The transcript below the first message would slide up onto it
  // until something else resized the rows. So an identity appearing for the
  // first time is not a switch; only one identity replacing another is.
  const previousResetRef = useRef(resetKey);
  useIsomorphicLayoutEffect(() => {
    const previous = previousResetRef.current;
    if (previous === resetKey) return;
    previousResetRef.current = resetKey;
    if (previous === null || previous === undefined) return;
    virtualizer.measure();
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [resetKey, scrollRef, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
      return;
    }
    const report = ((
      window as unknown as {
        __breadboardChatVirtualization?: Record<
          string,
          { messages: number; mountedRows: number }
        >;
      }
    ).__breadboardChatVirtualization ??= {});
    report[surface] = { messages: count, mountedRows: virtualItems.length };
  }, [count, surface, virtualItems.length]);

  const containerStyle: CSSProperties = {
    height: virtualizer.getTotalSize(),
    width: "100%",
    position: "relative",
  };

  return (
    <div
      className={className}
      style={containerStyle}
      // Read by the long-conversation tests and the QA harness: the two numbers
      // together are the whole claim this component makes.
      data-chat-virtual-list={surface}
      data-message-count={count}
      data-mounted-rows={virtualItems.length}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
