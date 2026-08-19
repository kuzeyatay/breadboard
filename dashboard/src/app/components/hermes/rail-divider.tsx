"use client";

// The edge of a rail or a panel, used as the control that moves it: a hairline
// that thickens into a handle under the cursor. It replaces a toolbar button,
// so the thing you touch sits on the boundary it moves, and it echoes the
// terminal's top resize handle turned on its side.
//
// One edge, two gestures. Click it and the panel travels between its rail and
// the width it was last opened to; drag it and the panel follows the pointer.
// Neither is a mode — a press decides which it was by whether it moved, so
// there is nothing to learn and nothing to aim at twice.
//
// Shared because every edge in a garden is the same idea: the chat list on the
// left, the learning map on the right, the panel between them. Three copies of
// a hairline drift apart in exactly the way a boundary must not.

import type { PointerEvent as ReactPointerEvent } from "react";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Accessible name of the control itself. */
  name: string;
  /** What the divider moves, in words: "the chat list", "the learning map". */
  moves: string;
  /** Given, the edge drags as well as clicks. See `useRailResize`. */
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** True through a drag, so the handle stays lit while the panel moves. */
  dragging?: boolean;
}

export default function RailDivider({
  collapsed,
  onToggle,
  name,
  moves,
  onPointerDown,
  dragging = false,
}: Props) {
  const resizable = onPointerDown !== undefined;
  const title = resizable
    ? `${collapsed ? `Show ${moves}` : `Collapse ${moves}`}, or drag to resize`
    : collapsed
      ? `Show ${moves}`
      : `Collapse ${moves}`;
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      // With a pointer the press itself decides between click and drag, so this
      // is left for the keyboard: a click React reports with no detail came
      // from Enter or Space, and nothing else must reach it twice.
      onClick={(event) => {
        if (!resizable || event.detail === 0) onToggle();
      }}
      aria-expanded={!collapsed}
      aria-label={name}
      title={title}
      className={`group relative z-[2] flex w-2 shrink-0 items-center justify-center border-0 bg-transparent p-0 ${
        resizable ? "cursor-col-resize" : "cursor-pointer"
      }`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-[#8faf9a] group-focus-visible:bg-[#8faf9a] ${
          dragging ? "bg-[#8faf9a]" : "bg-[var(--line)]"
        }`}
      />
      <span
        aria-hidden
        className={`pointer-events-none relative h-14 w-1.5 rounded-full border transition-colors group-hover:border-[rgba(169,193,177,0.7)] group-hover:bg-[#A9C1B1] group-focus-visible:border-[rgba(169,193,177,0.7)] group-focus-visible:bg-[#A9C1B1] ${
          dragging
            ? "border-[rgba(169,193,177,0.7)] bg-[#A9C1B1]"
            : "border-transparent bg-transparent"
        }`}
      />
    </button>
  );
}
