"use client";

import { ThinkingOrb as Orb } from "thinking-orbs";
import type { VolumetricOrbState } from "./orb-state";
import { useSurfaceTheme } from "./use-surface-theme";

export {
  VOLUMETRIC_ORB_STATES,
  isVolumetricOrbState,
  orbStateForLabel,
  type VolumetricOrbState,
} from "./orb-state";

export interface ThinkingOrbProps {
  /**
   * Which orb to draw. The chat always shows `composing` — the undulating
   * multi-band sash the user picked (2026-09-15) — regardless of what the
   * status line says; `orbStateForLabel()` is still exported for a surface
   * that wants the label-matched orb instead.
   */
  state?: VolumetricOrbState;
  /** 20 is the inline-text preset, 64 the chat-avatar one. */
  size?: 20 | 64;
  paused?: boolean;
  className?: string;
}

/**
 * The dotted thought orb shown beside a live status line.
 *
 * Plain 2D canvas — no WebGL — so it keeps animating even on a machine whose
 * GPU process has fallen over, which is exactly when a chat most needs to look
 * alive. It is decorative next to text that already says what is happening, so
 * it is hidden from assistive technology.
 */
export default function ThinkingOrb({
  state = "composing",
  size = 20,
  paused = false,
  className,
}: ThinkingOrbProps) {
  const theme = useSurfaceTheme();
  return (
    <Orb
      state={state}
      size={size}
      // Until the theme resolves, let the library's own detection stand rather
      // than painting light ink on paper for a frame.
      theme={theme ?? "auto"}
      paused={paused}
      aria-hidden
      role="presentation"
      // `bb-thinking-orb` pales the ink to the label's weight; see globals.css.
      className={className ? `bb-thinking-orb ${className}` : "bb-thinking-orb"}
      style={{ flex: "none" }}
    />
  );
}
