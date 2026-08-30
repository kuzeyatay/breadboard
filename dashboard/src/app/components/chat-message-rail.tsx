"use client";

/**
 * The thin stack of ticks a transcript floats against its right edge — one per
 * visible message, in conversation order. It answers a question the scrollbar
 * cannot: not "how far down this conversation am I", but "which turn am I
 * looking at, and how do I get back to it". Clicking a tick puts that message
 * at the top of the viewport.
 *
 * AI answers are landmarks too. Their larger preview keeps the complete answer
 * available and includes a compact reply field that appends to the same chat.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import type { ChatVirtualBridge } from "@/app/components/use-chat-auto-scroll";

export type ChatMessageRailItem = {
  /** Where the message sits in the list the virtualizer draws. */
  rowIndex: number;
  /** Shown beside the tick on hover, so a tick is never anonymous. */
  label: string;
  /** Answers get a complete, replyable preview; questions keep a compact one. */
  role: "user" | "assistant";
};

/** One visible message is enough to make the rail useful. */
const MINIMUM_TICKS = 1;

/**
 * A little way into the viewport rather than its exact top edge, so a question
 * the reader has just jumped to — which lands a hair short of the top — is
 * measured from where they are actually looking.
 */
const ACTIVE_TOLERANCE = 24;

/** User-message previews stay compact; AI-response previews do not use this. */
const LABEL_LIMIT = 160;

type ChatMessageRailProps = {
  items: readonly ChatMessageRailItem[];
  /** The transcript scroller — the same element the auto-scroll hook holds. */
  scrollRef: RefObject<HTMLElement | null>;
  bridge: ChatVirtualBridge;
  /** Names this rail for the tests and the QA harness. */
  surface: string;
  /** Keeps an inline draft attached to the conversation that opened it. */
  conversationKey?: string | number | null;
  /** Overrides the default placement against the right edge. */
  className?: string;
  /** Appends a reply through the chat surface that owns this rail. */
  onReply?: (
    text: string,
    item: ChatMessageRailItem,
  ) => void | Promise<void>;
};

export function summarise(label: string): string {
  const collapsed = label.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Empty message";
  return collapsed.length > LABEL_LIMIT
    ? `${collapsed.slice(0, LABEL_LIMIT - 1)}…`
    : collapsed;
}

/**
 * The text shown in the preview card. AI answers are deliberately never
 * shortened: the card has its own scroll region, so an ellipsis would hide the
 * exact part someone may want to answer. Questions remain compact landmarks.
 */
export function railPreview(item: ChatMessageRailItem): string {
  const complete = item.label.trim();
  if (!complete) {
    return item.role === "assistant" ? "Empty response" : "Empty message";
  }
  return item.role === "assistant" ? complete : summarise(complete);
}

function InlineRailReply({
  item,
  onReply,
}: {
  item: ChatMessageRailItem;
  onReply: NonNullable<ChatMessageRailProps["onReply"]>;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onReply(text, item);
      setValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reply could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-raised)] p-3"
    >
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-[11px] font-medium text-[var(--ink-muted)]"
      >
        Reply in this chat
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          placeholder="Reply to this response…"
          className="neu-control min-h-14 min-w-0 flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] leading-5 text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)]"
        />
        <button
          type="submit"
          disabled={!value.trim() || submitting}
          className="neu-button-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={submitting ? "Sending reply" : "Send reply"}
        >
          {submitting ? (
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
          ) : (
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-4 w-4"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 14-7-4 14-3-6-7-1Z" />
            </svg>
          )}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Which tick is lit: the question nearest to what the reader is looking at,
 * measured from the top of the viewport.
 *
 * The obvious rule — "the last question you have scrolled past" — is what a
 * table of contents does, and it is wrong here. One answer in this app is
 * routinely several screens tall, so that rule leaves the highlight sitting on
 * the same tick through ten viewports of scrolling and the rail reads as
 * broken. Nearest keeps it moving: the highlight hands over around the midpoint
 * of a long answer, when the next question really is the closer landmark.
 *
 * `starts` runs parallel to the ticks. A start of `null` is a row the
 * virtualizer could not place; it is skipped rather than treated as zero, which
 * would drag the highlight to the top of the conversation. Ties go to the later
 * tick, which is what makes the foot of the transcript land on the newest
 * question: every row past the scroller's travel reports the same saturated
 * offset, so they all tie there.
 */
export function nearestRailTick(
  starts: readonly (number | null)[],
  viewportTop: number,
): number {
  let active = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    if (start === null) continue;
    const distance = Math.abs(start - viewportTop);
    if (distance <= best) {
      best = distance;
      active = index;
    }
  }
  return active;
}

/**
 * The line down the viewport that the rail measures questions against.
 *
 * Normally the top: what you have just scrolled to is what you are reading, and
 * clicking a tick puts that question at the top, so the two agree.
 *
 * That breaks down at the end of a transcript, where the scroller runs out of
 * travel. The last question can never reach the top of the viewport, so it can
 * never be the nearest to it — with two questions close together at the bottom,
 * the highlight stays on the older one even though the reader is plainly
 * looking at the newest. So as the remaining scroll runs out, the line slides
 * down the viewport, reaching the bottom edge exactly when the scroller does.
 * Anywhere with a full screen of travel left is unaffected.
 */
export function railFocusLine(scroller: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): number {
  const remaining = Math.max(
    0,
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
  );
  const runway = Math.max(scroller.clientHeight, 1);
  /** 0 with a full viewport of scrolling left, 1 at the very bottom. */
  const closing = 1 - Math.min(1, remaining / runway);
  const reach = Math.max(runway - ACTIVE_TOLERANCE, 0);
  return scroller.scrollTop + ACTIVE_TOLERANCE + reach * closing;
}

export default function ChatMessageRail({
  items,
  scrollRef,
  bridge,
  surface,
  conversationKey,
  className,
  onReply,
}: ChatMessageRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const enabled = items.length >= MINIMUM_TICKS;

  /**
   * Which tick the reader is standing on.
   *
   * Where each question sits is read from the DOM whenever its row is mounted,
   * and only asked of the virtualizer otherwise. The DOM is the authority: it
   * needs no assumption about which coordinate space the virtualizer counts in,
   * and the rows that decide the answer — the ones around the fold — are
   * precisely the ones that are mounted. The virtualizer covers the rest, where
   * an estimate is all anyone has, shifted into the scroller's own coordinates
   * by where the list container begins.
   */
  const measureActive = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || items.length === 0) return;
    const top = scroller.scrollTop;
    const scrollerTop = scroller.getBoundingClientRect().top;
    /** Distance from the top of the scrolled content to an element. */
    const offsetOf = (element: Element) =>
      element.getBoundingClientRect().top - scrollerTop + top;

    // Scoped to the list, because `data-index` is a common enough attribute
    // that a row inside somebody's message could otherwise answer for a row.
    const list = scroller.querySelector("[data-chat-virtual-list]");
    const listOffset = list ? offsetOf(list) : 0;

    const starts = items.map((item) => {
      const row = list?.querySelector(`:scope > [data-index="${item.rowIndex}"]`);
      if (row) return offsetOf(row);
      const estimated = bridge.getRowStart(item.rowIndex);
      return estimated === null ? null : estimated + listOffset;
    });

    if (starts.every((start) => start === null)) return;
    setActive(nearestRailTick(starts, railFocusLine(scroller)));
  }, [bridge, items, scrollRef]);

  const scheduleMeasure = useCallback(() => {
    if (typeof window === "undefined") return;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measureActive();
    });
  }, [measureActive]);

  // Listened for on the document, in the capture phase, rather than bound to the
  // scroller itself.
  //
  // A scroll event does not bubble, but it does pass through its ancestors on
  // the way down, so this hears every one of them and keeps only the transcript
  // its own. The reason not to bind the element directly is that the rail is
  // handed a ref, not an element: the transcript can be torn down and rebuilt —
  // closing and reopening the terminal does exactly that — while this component
  // stays mounted and none of the dependencies below change. A listener bound at
  // mount would then be sitting on a detached node, hearing nothing, and the
  // highlight would be stuck wherever it last stood.
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onScroll = (event: Event) => {
      if (event.target !== scrollRef.current) return;
      scheduleMeasure();
    };
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [enabled, scheduleMeasure, scrollRef]);

  // Scrolling is not the only thing that changes which question is nearest.
  // The Terminal restores a conversation into a virtual list whose estimated
  // heights are replaced by real row heights after the first paint. Short
  // conversations often stay at scrollTop 0 throughout that work, so no scroll
  // event is emitted: without observing the geometry, the rail keeps the tick
  // it chose from the stale estimates (usually the first question) even though
  // the newest turn is plainly in view.
  //
  // The scroller covers viewport changes, the virtual list covers row
  // measurement corrections, and the tail covers content outside that list
  // (the disclaimer, proposal cards, and the measured composer clearance).
  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof window.ResizeObserver !== "function"
    ) {
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new window.ResizeObserver(scheduleMeasure);
    observer.observe(scroller);
    const list = scroller.querySelector("[data-chat-virtual-list]");
    if (list) observer.observe(list);
    const tail = scroller.querySelector(".bb-chat-scroll-tail");
    if (tail) observer.observe(tail);
    return () => observer.disconnect();
  }, [enabled, items, scheduleMeasure, scrollRef]);

  // The scroller the rail was pointed at is not the one it last measured, so the
  // transcript underneath it has been replaced. Runs after every render, which
  // costs one reference comparison; acting on it costs a measurement only on the
  // renders where the element actually changed.
  const measuredScrollerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (scrollRef.current === measuredScrollerRef.current) return;
    measuredScrollerRef.current = scrollRef.current;
    scheduleMeasure();
  });

  // Rows are measured as they mount, so the offsets the rail read a moment ago
  // are revised under it. A new message also lengthens the rail.
  useEffect(() => {
    if (!enabled) return;
    scheduleMeasure();
  }, [enabled, items, scheduleMeasure]);

  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (hideTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(hideTimerRef.current);
      }
    },
    [],
  );

  // A long conversation's rail scrolls inside itself. The tick being read has to
  // be brought along, or the rail silently stops describing where the reader is.
  useEffect(() => {
    if (!enabled) return;
    const rail = railRef.current;
    const tick = rail?.children[active] as HTMLElement | undefined;
    if (!rail || !tick) return;
    const above = tick.offsetTop < rail.scrollTop;
    const below =
      tick.offsetTop + tick.offsetHeight > rail.scrollTop + rail.clientHeight;
    if (above || below) {
      rail.scrollTop =
        tick.offsetTop - rail.clientHeight / 2 + tick.offsetHeight / 2;
    }
  }, [active, enabled]);

  const jumpTo = useCallback(
    (rowIndex: number) => {
      const reduceMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
      if (bridge.activeRef.current) {
        bridge.scrollToIndex(rowIndex, behavior);
        return;
      }
      const row = scrollRef.current?.querySelector<HTMLElement>(
        `[data-index="${rowIndex}"]`,
      );
      row?.scrollIntoView({ behavior, block: "start" });
    },
    [bridge, scrollRef],
  );

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current === null || typeof window === "undefined") return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const showLabel = useCallback(
    (index: number) => {
      cancelHide();
      setHoveredIndex(index);
    },
    [cancelHide],
  );

  // Leave enough time to cross the small visual gap between a tick and the
  // preview. Once the pointer reaches the card, it cancels this close.
  const scheduleHide = useCallback(() => {
    if (pinnedIndex !== null || typeof window === "undefined") return;
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setHoveredIndex(null);
    }, 180);
  }, [cancelHide, pinnedIndex]);

  if (!enabled) return null;

  const candidateOpenIndex = pinnedIndex ?? hoveredIndex;
  const openIndex =
    candidateOpenIndex !== null && candidateOpenIndex < items.length
      ? candidateOpenIndex
      : null;
  const openItem = openIndex === null ? undefined : items[openIndex];

  return (
    <div
      className={`bb-chat-rail pointer-events-none absolute right-0.5 top-1/2 z-20 flex -translate-y-1/2 items-center ${className ?? ""}`}
      data-chat-message-rail={surface}
      data-tick-count={items.length}
      data-active-tick={active}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          scheduleHide();
        }
      }}
    >
      {/* Kept outside the scrolling track so the track cannot clip it. The card
          is centred in the transcript viewport, which leaves room for long AI
          answers to scroll without escaping above or below the screen. */}
      {openItem ? (
        <section
          role="dialog"
          aria-label={openItem.role === "assistant" ? "AI response preview" : "Your message preview"}
          onPointerEnter={cancelHide}
          onPointerLeave={scheduleHide}
          className="pointer-events-auto absolute right-full top-1/2 mr-3 flex min-h-48 max-h-[min(70vh,42rem)] w-[min(36rem,calc(100vw-5rem))] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)] shadow-2xl"
          data-chat-rail-preview-role={openItem.role}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              {openItem.role === "assistant" ? "AI response" : "Your message"}
            </span>
            <button
              type="button"
              onClick={() => {
                setPinnedIndex(null);
                setHoveredIndex(null);
              }}
              className="neu-button-icon flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]"
              aria-label="Close message preview"
            >
              <span aria-hidden className="text-lg leading-none">×</span>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-5 py-4 text-[14px] leading-6 [scrollbar-width:thin]">
            {railPreview(openItem)}
          </div>
          {openItem.role === "assistant" && onReply ? (
            <InlineRailReply
              key={`${conversationKey ?? surface}:${openItem.rowIndex}`}
              item={openItem}
              onReply={onReply}
            />
          ) : null}
        </section>
      ) : null}

      <div
        ref={railRef}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Conversation messages"
        onPointerLeave={scheduleHide}
        className="bb-chat-rail-track pointer-events-auto flex max-h-[min(60vh,20rem)] flex-col items-end overflow-y-auto py-1 pl-4 pr-1.5"
      >
        {items.map((item, index) => {
          const isActive = index === active;
          return (
            <button
              key={item.rowIndex}
              type="button"
              onClick={() => {
                setPinnedIndex(index);
                jumpTo(item.rowIndex);
              }}
              onPointerEnter={() => showLabel(index)}
              onFocus={() => showLabel(index)}
              aria-label={
                item.role === "assistant"
                  ? `Go to AI response ${index + 1} of ${items.length}`
                  : `Go to message ${index + 1} of ${items.length}: ${summarise(item.label)}`
              }
              aria-expanded={openIndex === index}
              aria-current={isActive ? "true" : undefined}
              data-message-role={item.role}
              className="group flex h-3.5 w-8 shrink-0 items-center justify-end"
            >
              <span
                className={`bb-chat-rail-tick block h-px rounded-full ${
                  isActive
                    ? item.role === "assistant"
                      ? "w-6 bg-[var(--botanical)] opacity-100"
                      : "w-6 bg-[var(--ink)] opacity-100"
                    : item.role === "assistant"
                      ? "w-4 bg-[var(--botanical)] opacity-60 group-hover:w-6 group-hover:opacity-100 group-focus-visible:w-6 group-focus-visible:opacity-100"
                      : "w-4 bg-[var(--ink-muted)] opacity-50 group-hover:w-6 group-hover:opacity-90 group-focus-visible:w-6 group-focus-visible:opacity-90"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
