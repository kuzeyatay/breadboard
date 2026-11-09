"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BEND, MetalFx, useMetalBend } from "metal-fx";
import { useSurfaceTheme } from "./use-surface-theme";
import { useUserIdle } from "./use-user-idle";

// metal-fx's default getter is a new function on every render. Its effect
// depends on that getter, so a keystroke would remove and reinsert a body-level
// SVG filter, invalidating styles across the entire transcript. Keep the getter
// stable while still reading the library's live configuration.
const getMetalBendConfig = () => BEND;

const subscribeNever = () => () => {};

/**
 * False while React hydrates server HTML, true afterwards and for client-only
 * mounts. metal-fx decides WebGL support during render, so the server sends its
 * fallback while the client's first render is the full ring: a hydration
 * mismatch (React #418) that discarded the server HTML around every composer.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

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

/** True when every pixel of the ring canvas is fully transparent. */
function ringIsBlank(canvas: HTMLCanvasElement): boolean {
  if (canvas.width < 1 || canvas.height < 1) return false;
  try {
    const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) return false;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return false;
    return true;
  } catch {
    return false;
  }
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
 *   instance within a document.
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
  useMetalBend(root, getMetalBendConfig);
  const reducedMotion = usePrefersReducedMotion();
  const idle = useUserIdle();
  const hydrated = useHydrated();
  const paused = reducedMotion || disabled || idle;
  const wrapperClass = className ? `bb-metal-send ${className}` : "bb-metal-send";

  // A paused instance is painted exactly once and then left alone. If that one
  // paint lands on nothing — the ring canvas lost its contents (GPU reset,
  // evicted context) or the shared frame was blank when the pause snapshot was
  // taken (tab loaded in the background) — the button shows a bare paper disc
  // until something unpauses it, which a disabled button never does. A fresh
  // instance repaints from the live frame, so remount when the canvas is still
  // transparent a beat after it should have been drawn.
  // ponytail: reads a 48px canvas on visibility/pause transitions only; drop
  // once metal-fx repaints paused instances after a context restore.
  const [epoch, setEpoch] = useState(0);
  const remounts = useRef(0);
  useEffect(() => {
    if (!hydrated) return;
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        const canvas = root.current?.querySelector<HTMLCanvasElement>(".metal-fx-canvas");
        if (!canvas || remounts.current >= 3 || !ringIsBlank(canvas)) return;
        remounts.current += 1;
        setEpoch((value) => value + 1);
      }, 400);
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [hydrated, paused, epoch]);

  // Exactly the markup metal-fx renders without WebGL, which is what the
  // server sent; the ring replaces it right after hydration.
  if (!hydrated) {
    return (
      <div ref={root} className={`metal-fx-fallback ${wrapperClass}`} data-metal-fx-unsupported="" style={{ display: "inline-flex" }}>
        {children}
      </div>
    );
  }

  return (
    <MetalFx
      key={epoch}
      ref={root}
      variant={variant}
      preset="chromatic"
      // The app's own theme, not the OS one: metal-fx's `auto` reads
      // prefers-color-scheme, which Breadboard does not follow.
      theme={theme ?? "dark"}
      // A light rim along the top inside edge — the demo's send button has it.
      innerShadow
      // Still metal, just not moving, when the viewer asked for less motion
      // or the button has nothing to do, or nobody is at the window.
      paused={paused}
      // Deliberately left on. The library strips the button to its glyph and
      // paints the disc itself; `.bb-metal-send` in globals.css makes that
      // disc the composer's raised paper, the glyph solid ink, and carries
      // the shadow, disabled and focus styles the button used to own.
      normalizeHostStyles
      className={wrapperClass}
    >
      {children}
    </MetalFx>
  );
}
