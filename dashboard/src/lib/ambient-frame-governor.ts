// Slow decorative loops (swaying plants, drifting lights, orbiting rings, rain)
// do not need sixty frames a second, but each frame they force re-composites
// the whole window, including every frosted-glass panel above them. Measured
// on the desktop home tab (2026-11-10): 71-83% of a core in the GPU process at
// the display rate, about 20% when the same animations advance fifteen times
// a second. No single animation was expensive; the frame count was.
//
// The governor adopts long-running infinite CSS animations, holds them paused,
// and advances all of them from one timer, so they share their frames. Easing,
// timing and phase are unchanged; only the sampling rate drops.

export const AMBIENT_FRAMES_PER_SECOND = 15;
/** Loops shorter than this are quick feedback (a fast spinner, a pulse) and
 * keep the display rate. One second also takes in the rain background and the
 * usage spinner, which otherwise kept the whole window at full rate. */
export const AMBIENT_MIN_ITERATION_MS = 1_000;
/** A one-shot this long is ambience too. The random-colour palette fade runs
 * 20 s out of every 20 s cycle as a single iteration; left at the display rate
 * it re-blurred every glass panel 60 times a second for 12 s of each cycle
 * (GPU process ~85% of a core against ~30% between fades, measured 2026-11-11). */
export const AMBIENT_MIN_ONE_SHOT_MS = 10_000;
const RESCAN_MS = 1_000;

interface GovernedAnimation {
  animation: CSSAnimation;
  /** False while the stylesheet says this animation is paused. */
  advancing: boolean;
  /** Where a one-shot ends and is handed back finished; Infinity for a loop. */
  endTime: number;
}

type AmbientTiming = { iterations?: number; duration?: number | string | CSSNumericValue; delay?: number; endDelay?: number };

/** Whether an animation is slow decoration the governor should own: a slow
 * infinite loop, or a one-shot long enough that nobody is waiting on it. */
export function isAmbientLoop(timing: AmbientTiming): boolean {
  if (typeof timing.duration !== "number" || timing.duration < AMBIENT_MIN_ITERATION_MS) return false;
  return timing.iterations === Infinity || timing.duration * (timing.iterations ?? 1) >= AMBIENT_MIN_ONE_SHOT_MS;
}

function ambientEndTime(timing: AmbientTiming): number {
  if (timing.iterations === Infinity) return Infinity;
  return (timing.delay ?? 0) + (timing.duration as number) * (timing.iterations ?? 1) + (timing.endDelay ?? 0);
}

/** The stylesheet's play state for one animation of an element that may run several. */
export function cssPlayStateFor(animationName: string, names: string, states: string): "running" | "paused" {
  const nameList = names.split(",").map((value) => value.trim());
  const stateList = states.split(",").map((value) => value.trim());
  const index = nameList.indexOf(animationName);
  if (index < 0 || stateList.length === 0) return "running";
  return stateList[index % stateList.length] === "paused" ? "paused" : "running";
}

export function startAmbientFrameGovernor(doc: Document = document): () => void {
  const view = doc.defaultView;
  if (!view || typeof doc.getAnimations !== "function" || typeof view.CSSAnimation !== "function") return () => {};
  const governed = new Map<CSSAnimation, GovernedAnimation>();
  let lastTick = view.performance.now();

  const release = (animation: CSSAnimation) => {
    governed.delete(animation);
    try {
      if (animation.playState === "paused") animation.play();
    } catch {
      // The animation's element is gone; nothing to hand back.
    }
  };

  const rescan = () => {
    for (const animation of doc.getAnimations()) {
      if (!(animation instanceof view.CSSAnimation) || governed.has(animation)) continue;
      const effect = animation.effect;
      if (!effect || animation.playState !== "running") continue;
      const timing = effect.getTiming();
      if (!isAmbientLoop(timing)) continue;
      animation.pause();
      governed.set(animation, { animation, advancing: true, endTime: ambientEndTime(timing) });
    }
    for (const entry of governed.values()) {
      const effect = entry.animation.effect as KeyframeEffect | null;
      const target = effect?.target;
      if (!target || !target.isConnected || entry.animation.playState === "idle") {
        governed.delete(entry.animation);
        continue;
      }
      // pause() overrides the stylesheet, so its play state is read back here:
      // a component that pauses its ambience (music stopped, user idle) must
      // still be able to.
      const style = view.getComputedStyle(target, effect.pseudoElement ?? undefined);
      entry.advancing = cssPlayStateFor(entry.animation.animationName, style.animationName, style.animationPlayState) === "running";
    }
  };

  const tick = () => {
    const now = view.performance.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (doc.hidden) return;
    for (const entry of governed.values()) {
      if (!entry.advancing) continue;
      const current = entry.animation.currentTime;
      if (typeof current !== "number") continue;
      // Incremental, so a component that sets currentTime itself keeps its phase.
      const next = current + elapsed * entry.animation.playbackRate;
      if (next >= entry.endTime) {
        // A finished one-shot goes back to the browser in its natural end
        // state, so its fill mode and a later restart behave as authored.
        governed.delete(entry.animation);
        entry.animation.finish();
        continue;
      }
      entry.animation.currentTime = next;
    }
  };

  const motion = view.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (motion?.matches) return () => {};
  rescan();
  const tickTimer = view.setInterval(tick, 1000 / AMBIENT_FRAMES_PER_SECOND);
  const rescanTimer = view.setInterval(rescan, RESCAN_MS);
  // A restarted one-shot is adopted on its first frame, not up to a second later.
  doc.addEventListener?.("animationstart", rescan, true);
  return () => {
    doc.removeEventListener?.("animationstart", rescan, true);
    view.clearInterval(tickTimer);
    view.clearInterval(rescanTimer);
    for (const animation of [...governed.keys()]) release(animation);
  };
}
