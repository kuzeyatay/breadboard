"use client";

import type { ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { useSurfaceTheme } from "./use-surface-theme";

/** Matches the composer's own `rounded-[30px]`. */
const COMPOSER_RADIUS_PX = 30;

/**
 * Warm on paper, cool on the dark surface. Before the theme has resolved
 * (server, first client frame) the light palette stands in; the beam is still
 * fading in at that point, so nothing flashes.
 */
export function composerBeamPalette(theme: "light" | "dark" | null): "sunset" | "ocean" {
  return theme === "dark" ? "ocean" : "sunset";
}

export interface ComposerBorderBeamProps {
  /** The composer this beam traces. */
  children: ReactNode;
  /**
   * Whether the beam is travelling. It fades in and out rather than snapping.
   * The composer runs it while the draft is empty and lets it go the moment
   * typing starts: an invitation to write, not a distraction from writing.
   */
  active: boolean;
  className?: string;
}

/**
 * The travelling beam around the bottom chat dialogue.
 *
 * The obvious shape — `<BorderBeam>{composer}</BorderBeam>` — is wrong here.
 * `BorderBeam` puts `overflow: hidden` on the element it wraps, to clip its
 * rotating conic gradient to the rounded rectangle. The composer is not a card:
 * things come *out* of it. The slash-command menu, the capability palette, the
 * model picker and the attachment previews all open upward from inside it, and
 * every one of them would have been cut off at the composer's top edge.
 *
 * So the beam traces an empty box laid over the composer instead of containing
 * it. The clip still applies — to a box with nothing in it. The composer keeps
 * its own border, shadow, radius and overflow, its popovers keep escaping, and
 * the beam paints across the top exactly as it would have.
 */
export default function ComposerBorderBeam({
  children,
  active,
  className,
}: ComposerBorderBeamProps) {
  const theme = useSurfaceTheme();
  return (
    <div className={`relative${className ? ` ${className}` : ""}`}>
      {children}
      {/* Decorative, inert, and above the composer's own surface — the same
          stacking order the beam would have had as a wrapper. */}
      <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
        <BorderBeam
          size="md"
          colorVariant={composerBeamPalette(theme)}
          theme={theme ?? "auto"}
          borderRadius={COMPOSER_RADIUS_PX}
          active={active}
          className="h-full w-full"
        >
          <div className="h-full w-full" />
        </BorderBeam>
      </div>
    </div>
  );
}
