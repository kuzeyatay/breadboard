"use client";

import type { CSSProperties } from "react";
import { ThinkingOrb as Orb, type OrbSize } from "thinking-orbs";

import { useSurfaceTheme } from "@/app/components/effects/use-surface-theme";
import { inkRingPath } from "@/lib/speech/voice-conversation";

interface BreadboardLoaderProps {
  /** Announced to screen readers when the icon is not inside a labelled status. */
  label?: string;
  className?: string;
}

interface BreadboardOrbLoaderProps extends BreadboardLoaderProps {
  /**
   * Which of the library's two tuned orb designs to draw. The canvas is then
   * stretched to the caller's icon box, so the 20px inline design (the
   * default) is right for the small marks most callers use; pass 64 for a
   * large centred mark so the dots keep their detail.
   */
  orbSize?: OrbSize;
}

/**
 * Breadboard's generic circular loading mark: the `breathing` thought orb — a
 * face-on dotted ring slowly morphing — drawn in the same 2D-canvas engine as
 * the status-line orb, so a chat that is loading and a chat that is thinking
 * share one character. Plain canvas, no WebGL, so it keeps moving on a machine
 * whose GPU process has fallen over.
 *
 * The orb replaced `BreadboardSketchLoader` below on every surface
 * (2026-09-15); the sketch rings are kept, not deleted, so a surface can opt
 * back into the hand-drawn mark.
 *
 * Callers keep sizing the mark with `className` exactly as before: the orb
 * stretches to fill whatever box the class assigns.
 */
export default function BreadboardLoader({
  label,
  className = "h-3.5 w-3.5",
  orbSize = 20,
}: BreadboardOrbLoaderProps) {
  const theme = useSurfaceTheme();
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`bb-loader bb-loader-orb ${className}`}
    >
      <Orb
        state="breathing"
        size={orbSize}
        theme={theme ?? "auto"}
        aria-hidden
        role="presentation"
        className="bb-loader-orb-canvas"
        style={{ width: "100%", height: "100%" }}
      />
    </span>
  );
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
 * The hand-drawn circular loading mark. Short strokes trace multiple
 * stationary, irregular ink passes—the small counterpart of the voice ring
 * and the fresh-chat card outlines. No longer the default (the breathing orb
 * above is), but kept so a surface can still ask for the drawn character.
 */
export function BreadboardSketchLoader({
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
