import type { CSSProperties } from "react";

import { inkRingPath } from "@/lib/speech/voice-conversation";

interface BreadboardLoaderProps {
  /** Announced to screen readers when the icon is not inside a labelled status. */
  label?: string;
  className?: string;
}

// Four separate passes over one fixed circle. They deliberately keep the same
// radius: changing it between passes made the tiny mark look like a warped ball
// instead of several hand-drawn lines following the same guide. Different
// seeds, point counts, and wobble make each hand imperfect in its own way.
const LOADER_SKETCH_RINGS = [
  inkRingPath(31, 12, 12, 7.35, 0.042, 15),
  inkRingPath(48, 12, 12, 7.35, 0.058, 17),
  inkRingPath(65, 12, 12, 7.35, 0.078, 16),
  inkRingPath(82, 12, 12, 7.35, 0.052, 18),
];

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
      <circle
        className="bb-loader-settled"
        cx="12"
        cy="12"
        r="7.35"
        stroke="currentColor"
        strokeWidth="0.9"
      />
      {LOADER_SKETCH_RINGS.map((path, index) => (
        <path
          key={path}
          className={`bb-loader-sketch bb-loader-sketch-${index + 1}`}
          d={path}
          pathLength={1}
          stroke="currentColor"
          strokeWidth="0.95"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={
            {
              "--bb-loader-sketch-delay": `${index * -705}ms`,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}
