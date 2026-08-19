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
import { flushSync } from "react-dom";
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

  // A row is measured from its ref callback, which React runs inside the commit
  // phase. On a list anchored to its end, a first measurement that differs from
  // the estimate also writes `scrollTop`, and the virtualizer reports that write
  // synchronously — a `flushSync` from inside a commit, which React refuses to
  // perform and logs as "React cannot flush when React is already rendering".
  // The measurement survives, the synchronous flush does not, and it is wanted
  // exactly where it is lost: the row that appears when a message is sent, first
  // measured while the reader is pinned to the end of the conversation.
  //
  // So rows are measured one microtask after the commit that mounted them. That
  // still runs before the browser paints — a row is never drawn at its estimate
  // — and batching the rows of one commit into a single `flushSync` collapses
  // what would otherwise be one synchronous re-render per newly mounted row.
  const pendingRowsRef = useRef<Set<HTMLElement> | null>(null);
  const measureScheduledRef = useRef(false);
  const unmountedRef = useRef(false);

  // Handing a row to `measureElement` does two things, and a transcript only
  // ever gets one of them. It registers the row with the virtualizer's own
  // ResizeObserver — which is what follows an answer growing as it streams —
  // but it *measures* only when the virtualizer believes nothing is scrolling,
  // and a transcript following an answer writes `scrollTop` on every frame, so
  // it believes it is scrolling for the whole turn. A smooth glide suppresses
  // measurement again, for every row outside a band around the row being
  // travelled to.
  //
  // A row first mounted inside either window is therefore left at its estimate,
  // and the estimate is capped: a long answer stands 900px tall while really
  // being several thousand, and the rest of the conversation is laid out on top
  // of it. Nothing recovers it, either — a row reports its height again only
  // when it resizes, and a finished answer never does.
  //
  // So a row the virtualizer holds no measurement for at all is measured here,
  // directly. One it has already measured is left to the ResizeObserver, which
  // is the half the library is right to suppress mid-glide: re-aiming a
  // travelling scroll at every row it passes is what makes one stutter.
  const measureFirstSize = useCallback(
    (row: HTMLElement) => {
      const index = Number(row.getAttribute("data-index"));
      if (!Number.isInteger(index) || index < 0) return;
      if (virtualizer.itemSizeCache.has(virtualizer.options.getItemKey(index))) {
        return;
      }
      virtualizer.resizeItem(index, row.offsetHeight);
    },
    [virtualizer],
  );

  // The measurement the library drops on the floor, recovered.
  //
  // Its own ResizeObserver is the half that follows a row *after* it mounts —
  // markdown that reflows once a table has its column widths, a font that
  // arrives late, an answer still streaming. But it refuses the correction
  // whenever a smooth scroll is in flight and the row sits outside a band
  // around the one being travelled to (`shouldMeasureDuringScroll`), and the
  // correction is not retried afterwards: a row reports its height again only
  // when it resizes again, which a finished answer never does. Landing on a
  // conversation is a smooth glide over exactly those rows, so the transcript
  // came to rest holding heights for content that had since grown, and every
  // row below one of them was laid out on top of it — messages drawn inside
  // each other.
  //
  // So rows are reconciled against the DOM here instead, on our own observer,
  // and the correction is deferred rather than dropped: while anything is
  // scrolling the sweep re-arms itself, which is the part the library is right
  // about — re-aiming a travelling scroll at every row it passes is what makes
  // one stutter. Once the transcript is still, every mounted row whose real
  // height disagrees with the recorded one is resized in a single pass.
  const observedRowsRef = useRef<Set<HTMLElement> | null>(null);
  const sweepFrameRef = useRef<number | null>(null);
  const sweepDeferralsRef = useRef(0);

  const sweepMeasurements = useCallback(() => {
    sweepFrameRef.current = null;
    if (unmountedRef.current || typeof window === "undefined") return;
    const rows = observedRowsRef.current;
    if (!rows || rows.size === 0) return;

    // Still moving: try again on the next frame rather than fighting the
    // scroll. `isScrolling` falls 150ms after the last scroll event, so this
    // usually settles the moment the transcript does — but only usually, so
    // the wait is bounded. A transcript following a streaming answer writes
    // `scrollTop` every frame and would postpone the correction for the whole
    // turn; past the cap the sweep runs anyway, and rows are never left drawn
    // on top of each other for more than a beat.
    if (virtualizer.isScrolling && sweepDeferralsRef.current < 40) {
      sweepDeferralsRef.current += 1;
      sweepFrameRef.current = window.requestAnimationFrame(sweepMeasurements);
      return;
    }
    sweepDeferralsRef.current = 0;

    const corrections: Array<[number, number]> = [];
    for (const row of rows) {
      if (!row.isConnected) {
        rows.delete(row);
        continue;
      }
      const index = Number(row.getAttribute("data-index"));
      if (!Number.isInteger(index) || index < 0 || index >= itemsRef.current.length) {
        continue;
      }
      const actual = row.offsetHeight;
      // Still an empty shell: there is nothing true to record yet.
      if (actual < 2) continue;
      const recorded = virtualizer.itemSizeCache.get(
        virtualizer.options.getItemKey(index),
      );
      // Sub-pixel disagreement is what rounding leaves behind, not drift. No
      // recorded height at all is a row whose empty mount was skipped: the DOM
      // now holds its first real height, so it is taken here — `resizeItem`
      // no-ops when it happens to match the estimate.
      if (recorded !== undefined && Math.abs(recorded - actual) < 1) continue;
      corrections.push([index, actual]);
    }
    if (corrections.length === 0) return;
    flushSync(() => {
      for (const [index, size] of corrections) virtualizer.resizeItem(index, size);
    });
  }, [virtualizer]);

  const scheduleSweep = useCallback(() => {
    if (typeof window === "undefined" || unmountedRef.current) return;
    if (sweepFrameRef.current !== null) return;
    sweepFrameRef.current = window.requestAnimationFrame(sweepMeasurements);
  }, [sweepMeasurements]);

  // A hard refresh lands on a conversation before its webfonts do: rows are
  // measured in the fallback font, and when the real one arrives every row
  // reflows at once — the classic refreshed-terminal transcript with rows
  // drawn into each other. The per-row observers catch most of it; this
  // catches all of it, in one sweep, the moment the fonts settle.
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) scheduleSweep();
    });
    return () => {
      cancelled = true;
    };
  }, [scheduleSweep]);

  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const getRowObserver = useCallback(() => {
    if (typeof window === "undefined" || !window.ResizeObserver) return null;
    return (rowObserverRef.current ??= new window.ResizeObserver(() => {
      scheduleSweep();
    }));
  }, [scheduleSweep]);

  const measureRow = useCallback(
    (node: HTMLElement | null) => {
      // React detaching a row. Handing the null straight on is what sweeps the
      // node out of the virtualizer's element cache, and it measures nothing.
      if (node === null) {
        const observed = observedRowsRef.current;
        if (observed) {
          for (const row of observed) {
            if (row.isConnected) continue;
            rowObserverRef.current?.unobserve(row);
            observed.delete(row);
          }
        }
        virtualizer.measureElement(null);
        return;
      }
      const observer = getRowObserver();
      if (observer && !observedRowsRef.current?.has(node)) {
        (observedRowsRef.current ??= new Set<HTMLElement>()).add(node);
        observer.observe(node);
      }
      const pending = (pendingRowsRef.current ??= new Set<HTMLElement>());
      pending.add(node);
      if (measureScheduledRef.current) return;
      measureScheduledRef.current = true;
      queueMicrotask(() => {
        measureScheduledRef.current = false;
        const rows = pendingRowsRef.current;
        pendingRowsRef.current = null;
        if (!rows || unmountedRef.current) return;
        flushSync(() => {
          for (const row of rows) {
            // A row mounted and unmounted inside one commit was never observed,
            // so there is nothing to measure and nothing to clean up.
            if (!row.isConnected) continue;
            // A row that mounts as an empty shell — markdown still hydrating, a
            // dynamic import still resolving — must not have its emptiness
            // recorded: a near-zero height in the size cache lays every row
            // below out on top of this one, and the library never takes a
            // measurement back on its own. The estimate stands until the
            // content arrives; the sweep observer takes it from there.
            if (row.offsetHeight < 2) continue;
            virtualizer.measureElement(row);
            measureFirstSize(row);
          }
        });
      });
    },
    [getRowObserver, measureFirstSize, virtualizer],
  );

  const scrollToEnd = useCallback(
    (behavior: ScrollBehavior) => {
      if (itemsRef.current.length === 0) return;
      virtualizer.scrollToEnd({ behavior });
    },
    [virtualizer],
  );

  // Aimed at the top of the viewport, which is where a row someone chose to go
  // to wants to sit: the message they picked heads the screen, and its answer
  // reads downward from it. The virtualizer re-aims the glide as the rows it
  // travels past are measured for the first time.
  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior) => {
      if (index < 0 || index >= itemsRef.current.length) return;
      virtualizer.scrollToIndex(index, { align: "start", behavior });
    },
    [virtualizer],
  );

  // The scroll position that would bring row N to the top, which for every row
  // the scroller can actually reach is just where that row begins. Past that
  // point it saturates at the furthest the scroller travels, and callers are
  // told to read the tie as "the newest" rather than trying to undo it.
  const getRowStart = useCallback(
    (index: number) => virtualizer.getOffsetForIndex(index, "start")?.[0] ?? null,
    [virtualizer],
  );

  useIsomorphicLayoutEffect(() => {
    bridge.attach({ scrollToEnd, scrollToIndex, getRowStart });
    return () => bridge.attach(null);
  }, [bridge, getRowStart, scrollToEnd, scrollToIndex]);

  useEffect(() => {
    // Not a redundant write: StrictMode mounts, runs the cleanup below, and
    // mounts again — all on a component that then lives on. Left `true`, the
    // flag silences the microtask measurement and the sweep for the lifetime
    // of every development transcript, and rows stand at their estimates.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (typeof window !== "undefined") {
        if (releaseTimerRef.current !== null) {
          window.clearTimeout(releaseTimerRef.current);
        }
        if (sweepFrameRef.current !== null) {
          window.cancelAnimationFrame(sweepFrameRef.current);
        }
      }
      rowObserverRef.current?.disconnect();
      rowObserverRef.current = null;
      observedRowsRef.current = null;
    };
  }, []);

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
    // The transcripts lay this container out in a flex column (which is what
    // lets the disclaimer sit at the bottom of a short conversation). Its
    // rows are absolutely positioned, so its content-based minimum is zero —
    // without this, flex would squash the whole conversation into the
    // viewport instead of letting it scroll.
    flexShrink: 0,
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
            ref={measureRow}
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
