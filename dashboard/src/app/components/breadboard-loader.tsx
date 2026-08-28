import type { CSSProperties } from "react";

import { inkRingPath, scribbleRings } from "@/lib/speech/voice-conversation";

interface BreadboardLoaderProps {
  /** Announced to screen readers when the icon is not inside a labelled status. */
  label?: string;
  className?: string;
}

// Use the voice interface's actual hand-drawn geometry instead of decorating a
// perfect circle. The shared voice helper keeps each pass nearly coincident
// while progressively increasing its wobble, so four separately phased traces
// remain visibly layered instead of collapsing into one clean stroke.
const LOADER_SETTLED_RING = inkRingPath(11, 12, 12, 7.35, 0.075, 13);
const LOADER_SKETCH_RINGS = scribbleRings(12, 12, 7.45, 4);

/**
 * Breadboard's generic circular loading mark. Short strokes trace multiple
 * stationary, irregular ink passes—the small counterpart of the voice ring
 * and the fresh-chat card outlines. Only this shared component owns circular
 * loading motion, so every surface gets the same drawn character.
 */
export default function BreadboardLoader({
  label,
  className = "h-3.5 w-3.5",
}: BreadboardLoaderProps) {
  return (
    <svg
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      fill="none"
      className={`bb-loader ${className}`}
    >
      <path
        className="bb-loader-settled"
        d={LOADER_SETTLED_RING}
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {LOADER_SKETCH_RINGS.map((path, index) => (
        <path
          key={path}
          className={`bb-loader-sketch bb-loader-sketch-${index + 1}`}
          d={path}
          pathLength={100}
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={
            {
              "--bb-loader-sketch-delay": `${index * -210}ms`,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}
