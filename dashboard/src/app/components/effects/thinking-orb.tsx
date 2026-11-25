"use client";

import { ThinkingOrb as Orb } from "thinking-orbs";
import type { VolumetricOrbState } from "./orb-state";
import { useSurfaceTheme } from "./use-surface-theme";
import { loadingIconMotion } from "../loading-icon-motion";

export {
  VOLUMETRIC_ORB_STATES,
  isVolumetricOrbState,
  orbStateForLabel,
  type VolumetricOrbState,
} from "./orb-state";

export interface ThinkingOrbProps {
  /**
   * Which orb to draw. `composing` preserves the undulating multi-band sash
   * for Thinking; live status rows use `orbStateForLabel()` for other activity.
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
    <span {...loadingIconMotion} aria-hidden="true" className={className} style={{ display: "inline-flex", flex: "none" }}>
      <Orb
        state={state}
        data-orb-state={state}
        size={size}
        theme={theme ?? "auto"}
        paused={paused}
        aria-hidden
        role="presentation"
        className="bb-thinking-orb"
      />
    </span>
  );
}
