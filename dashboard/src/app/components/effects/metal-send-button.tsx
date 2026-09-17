"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MetalFx, useMetalBend } from "metal-fx";
import { useSurfaceTheme } from "./use-surface-theme";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export interface MetalSendButtonProps {
  /** The existing send button, unchanged. */
  children: ReactNode;
  /** `circle` for the round send buttons, `button` for pill-shaped ones. */
  variant?: "circle" | "button";
  /** Class on the wrapper. It becomes the flex item the button used to be, so
   *  whatever sizing class the button carried in its row belongs here too. */
  className?: string;
  /** Only paces the ring: a disabled button keeps its metal but stops moving. */
  disabled?: boolean;
  /**
   * Override the resolved theme. Buzz keeps its own light/dark preference,
   * separate from the app's, so it has to say which side it is painting on.
   */
  theme?: "dark" | "light";
}

/**
 * A send button wearing a real-time liquid-metal ring.
 *
 * The button itself is untouched: `metal-fx` measures the wrapped element and
 * paints its shader on top, with `pointer-events: none`, so every class,
 * handler, label and disabled state below still behaves exactly as it did.
 *
 * Three things make this safe to put on every chat surface:
 *
 * - The effect needs WebGL2. Where there is none the library renders the plain
 *   child, which is the button as it looked before. (Breadboard's shell now
 *   keeps a software WebGL path alive for precisely this reason — see
 *   `desktop/src/main/gpu-preferences.ts`.)
 * - One WebGL context and one animation loop are shared by every mounted
 *   instance, so N send buttons across N open chats cost one context.
 * - A disabled button gets no ring. A dead control should not be the most
 *   alive thing in the composer.
 */
export default function MetalSendButton({
  children,
  variant = "circle",
  className,
  disabled = false,
  theme: themeOverride,
}: MetalSendButtonProps) {
  const surfaceTheme = useSurfaceTheme();
  const theme = themeOverride ?? surfaceTheme;
  const root = useRef<HTMLDivElement>(null);
  // The cursor dent: the ring (and the disc with it) liquefies toward the
  // pointer and springs back. This is what the library's demo feels like.
  useMetalBend(root);
  const reducedMotion = usePrefersReducedMotion();

  return (
    <MetalFx
      ref={root}
      variant={variant}
      preset="chromatic"
      // The app's own theme, not the OS one: metal-fx's `auto` reads
      // prefers-color-scheme, which Breadboard does not follow.
      theme={theme ?? "dark"}
      // A light rim along the top inside edge — the demo's send button has it.
      innerShadow
      // Still metal, just not moving, when the viewer asked for less motion
      // or the button has nothing to do.
      paused={reducedMotion || disabled}
      // Deliberately left on. The library strips the button to its glyph and
      // paints the disc itself; `.bb-metal-send` in globals.css makes that
      // disc the composer's raised paper, the glyph solid ink, and carries
      // the shadow, disabled and focus styles the button used to own.
      normalizeHostStyles
      className={className ? `bb-metal-send ${className}` : "bb-metal-send"}
    >
      {children}
    </MetalFx>
  );
}
