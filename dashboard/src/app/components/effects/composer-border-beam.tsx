"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSurfaceTheme } from "./use-surface-theme";
import { startComposerBeam } from "./composer-beam-motion";
import styles from "./composer-border-beam.module.css";

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
 * Only the decorative overlay is clipped; menus still escape upward. Two
 * soft lights travel at a steady speed behind a static edge mask, changing only
 * transform and opacity instead of repainting gradient masks every frame.
 */
export default function ComposerBorderBeam({
  children,
  active,
  className,
}: ComposerBorderBeamProps) {
  const theme = useSurfaceTheme();
  const surface = useRef<HTMLDivElement>(null);
  const motion = useRef<ReturnType<typeof startComposerBeam> | null>(null);

  useEffect(() => {
    if (!surface.current) return;
    const controller = startComposerBeam(surface.current);
    motion.current = controller;
    return () => {
      controller.dispose();
      motion.current = null;
    };
  }, []);

  useEffect(() => {
    motion.current?.setActive(active);
  }, [active]);

  return (
    <div className={`relative${className ? ` ${className}` : ""}`}>
      {children}
      {/* Decorative, inert, and above the composer's own surface — the same
          stacking order the beam would have had as a wrapper. */}
      <div
        ref={surface}
        className={styles.beam}
        data-beam="composer"
        data-active={active}
        data-palette={composerBeamPalette(theme)}
        aria-hidden="true"
      >
        <span className={styles.light} />
        <span className={styles.light} />
      </div>
    </div>
  );
}
