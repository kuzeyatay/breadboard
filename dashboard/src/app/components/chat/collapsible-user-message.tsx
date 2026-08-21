"use client";

// A long message the person sent, folded down to a readable height.
//
// Their own words are the part of a transcript they already know: a prompt
// pasted in whole — a spec, a competing answer, a stack trace — pushes the
// reply it was asking about off the screen, and every scroll back through the
// conversation crosses it again. So a user bubble taller than
// COLLAPSED_USER_MESSAGE_PX is clipped to that height, faded out at the cut,
// and given a Show more / Show less toggle. Anything shorter is left exactly
// as it was — the toggle only appears once folding actually hides something
// worth unfolding.
//
// Two details this has to get right, both of them consequences of the
// transcripts being virtualized:
//
//   * a row that scrolls out of view is unmounted, so `expanded` cannot live
//     in this component alone or a message would re-fold itself behind the
//     reader's back. It is held in a module-level set keyed by the row's
//     identity, which is the same key the virtualizer files heights under;
//   * folding and unfolding changes the row's height, which the virtualizer
//     picks up through its own ResizeObserver sweep. That is also why the
//     change is not animated: a height transition resizes the row on every
//     frame, and re-measuring a virtualized list mid-flight is what makes one
//     stutter. The fade at the cut carries the affordance instead.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  COLLAPSED_USER_MESSAGE_PX,
  USER_MESSAGE_COLLAPSE_SLACK_PX,
} from "@/app/components/chat/chat-row-identity";

/** Layout effects are the point here, but transcripts also render on the server. */
const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Which messages the reader has opened, surviving the row being unmounted as
 * it scrolls past the fold. Keys are row identities, which carry a persisted
 * message id wherever a transcript has one.
 */
const expandedMessages = new Set<string>();

export default function CollapsibleUserMessage({
  messageKey,
  children,
}: {
  /** The row's identity — `chatRowKey` on every surface that has one. */
  messageKey: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => expandedMessages.has(messageKey));
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const bodyId = useId();

  // The clip sits on the wrapper, so the measured element is always its own
  // full height whether the message is open or folded.
  useIsomorphicLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => {
      setOverflowing(
        node.offsetHeight >
          COLLAPSED_USER_MESSAGE_PX + USER_MESSAGE_COLLAPSE_SLACK_PX,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Content arriving late — a webfont, an embedded card, the window being
    // narrowed until the message wraps to twice the lines — changes the answer.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A row remounting with a different message under it must not inherit the
  // previous one's disclosure.
  useIsomorphicLayoutEffect(() => {
    setExpanded(expandedMessages.has(messageKey));
  }, [messageKey]);

  const toggle = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      if (next) expandedMessages.add(messageKey);
      else expandedMessages.delete(messageKey);
      return next;
    });
  }, [messageKey]);

  const folded = !expanded;

  return (
    <div
      data-chat-collapsible-message={overflowing ? "collapsible" : "whole"}
      data-expanded={expanded ? "true" : "false"}
    >
      <div
        id={bodyId}
        // The fade belongs to a fold that is actually hiding something; a short
        // message clipped at a height it never reaches must not have its last
        // line dimmed for nothing.
        className={
          folded
            ? overflowing
              ? "bb-chat-message-fold"
              : "overflow-hidden"
            : undefined
        }
        style={folded ? { maxHeight: COLLAPSED_USER_MESSAGE_PX } : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {overflowing ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="mt-1 inline-flex items-center gap-1 rounded-md text-xs font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-heading)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--botanical)]"
        >
          <span>{expanded ? "Show less" : "Show more"}</span>
          <svg
            className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
