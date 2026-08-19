"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { ChatGreeting } from "@/lib/hermes/chat-greeting";
import { SKETCH_MARGIN, sketchRectOutlines, type SketchBox } from "@/lib/hermes/sketch-outline";

interface Props {
  greeting: ChatGreeting | null;
  suggestions: string[];
  /**
   * An opener was picked. It goes into the composer rather than straight to the
   * runtime: these are starting points, and most of them want a subject filled
   * in before they are worth sending.
   */
  onSelectSuggestion: (prompt: string) => void;
  disabled?: boolean;
  /**
   * One small line under the openers, for what a surface needs said in its own
   * words — the garden workspace uses it for the Save page hint. Held to the
   * same fade as the greeting so it cannot appear before the words above it.
   */
  footnote?: ReactNode;
}

/**
 * What a blank chat shows: a greeting that knows roughly what time it is and
 * roughly what you have been doing, and four openers drawn from the same
 * reading. Both step forward every hour.
 *
 * Shared by the runtime terminal and the legacy one so the two cannot drift.
 * The greeting is held back until the clock and the activity signals have both
 * landed, and then faded in, because a heading that appears and then rewrites
 * itself a frame later reads as a bug.
 */
export default function ChatGreetingEmptyState({
  greeting,
  suggestions,
  onSelectSuggestion,
  disabled = false,
  footnote,
}: Props) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-6 py-8 text-center">
      <div
        className={`transition-opacity duration-500 motion-reduce:transition-none ${
          greeting ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* The placeholders are non-breaking spaces, not empty strings: the
            two lines still have to take their height while the greeting is on
            its way, or the block grows the moment it lands. */}
        <p className="text-2xl font-medium leading-tight text-white sm:text-3xl">
          {greeting?.lead ?? " "}
          {greeting?.name ? <span className="text-gray-500">, {greeting.name}</span> : null}
        </p>
        <p className="mt-1 text-2xl font-medium leading-tight text-white sm:text-3xl">
          {greeting?.question ?? " "}
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {suggestions.map((prompt, index) => (
          <SuggestionCard
            key={prompt}
            prompt={prompt}
            index={index}
            disabled={disabled}
            onSelect={onSelectSuggestion}
          />
        ))}
      </div>
      {footnote ? (
        <p
          className={`text-xs text-gray-700 transition-opacity duration-500 motion-reduce:transition-none ${
            greeting ? "opacity-100" : "opacity-0"
          }`}
        >
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One opener, wearing the voice screen's sketch language on its outline: a
 * faint settled line that is always there, and a pass that draws along it,
 * rests, and lifts — a quarter of the cycle behind the card before it.
 *
 * The two lines are generated the way the voice ring's are — knots pushed a
 * little off the ideal outline and smoothed — in real pixel coordinates from
 * the card's measured size. Not percentages: a percentage-sized layer sat at
 * the card's content height while the grid row stretched it taller, which drew
 * the outline straight through the middle of the card. The observer
 * regenerates the paths whenever the card changes size, so the drawing can
 * never disagree with the card it is on.
 */
function SuggestionCard({
  prompt,
  index,
  disabled,
  onSelect,
}: {
  prompt: string;
  index: number;
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [box, setBox] = useState<SketchBox | null>(null);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const measure = () => {
      const bounds = button.getBoundingClientRect();
      // The card's own corner radius, read from the one place it is stated.
      const radius = Number.parseFloat(getComputedStyle(button).borderTopLeftRadius) || 8;
      const next: SketchBox = {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        radius,
      };
      setBox((previous) =>
        previous &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.radius === next.radius
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  const outlines = useMemo(() => (box ? sketchRectOutlines(box, index) : null), [box, index]);
  const surface = box
    ? { width: box.width + SKETCH_MARGIN * 2, height: box.height + SKETCH_MARGIN * 2 }
    : null;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onSelect(prompt)}
      disabled={disabled}
      className="bb-terminal-suggestion neu-button border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {/* Empty until the card has been measured — the server knows no sizes,
          so this also keeps hydration exact. Width and height are stated in
          pixels because an SVG is a replaced element and `inset` alone will
          not size it. */}
      <svg
        aria-hidden
        className="bb-terminal-suggestion-beam"
        viewBox={surface ? `0 0 ${surface.width} ${surface.height}` : undefined}
        style={
          {
            "--bb-beam-delay": `${index * -2115}ms`,
            width: surface ? `${surface.width}px` : undefined,
            height: surface ? `${surface.height}px` : undefined,
          } as CSSProperties
        }
      >
        {outlines ? (
          <>
            <path d={outlines.settled} pathLength={1} />
            <path d={outlines.pass} pathLength={1} />
          </>
        ) : null}
      </svg>
      {prompt}
    </button>
  );
}
