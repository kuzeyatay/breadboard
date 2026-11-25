// Slow decorative loops (swaying plants, drifting lights, orbiting rings, rain)
// do not need sixty frames a second, but each frame they force re-composites
// the whole window, including every frosted-glass panel above them. Measured
// on the desktop home tab (2026-11-10): 71-83% of a core in the GPU process at
// the display rate, about 20% when the same animations advance fifteen times
// a second. No single animation was expensive; the frame count was.
//
// The governor samples CSS animations from a single clock per presented page.
// Lights and Terminal ink opt into 30 FPS; other decoration shares every
// second tick. Pages without a faster effect only wake at 15 FPS.

export const AMBIENT_FRAMES_PER_SECOND = 15;
export const FOREGROUND_AMBIENT_FPS = 30;
export const AMBIENT_LIGHTING_CHANGE = "breadboard:ambient-lighting-change";
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
const LIGHTING_SURFACES = "[data-spotify-background], [data-ambient-layer]";
const lightOrigins = new WeakMap<Animation, number>();
const scriptedPlayback = new WeakMap<Animation, boolean>();
const requestScan = new WeakMap<Document, () => void>();

/** Let the shared 30 FPS clock drive a script-created effect while its owner
 * controls when it should move. Without a clock, use normal browser playback. */
export function setAmbientEffectPlaying(doc: Document, animation: Animation, playing: boolean) {
  const changed = scriptedPlayback.get(animation) !== playing;
  scriptedPlayback.set(animation, playing);
  const scan = requestScan.get(doc);
  if (playing && !scan) {
    if (animation.playState !== "running") animation.play();
  } else if (animation.playState !== "paused") animation.pause();
  if (changed) scan?.();
}

/** Anchor a wallpaper effect to the palette's wall clock, including seeks
 * performed between governor ticks when another tab or album becomes active. */
export function setAmbientLightPhase(animation: Animation, now: number, phase: number) {
  lightOrigins.set(animation, now - phase);
}

interface GovernedAnimation {
  animation: Animation;
  /** False while the stylesheet says this animation is paused. */
  advancing: boolean;
  foregroundRate: boolean;
  nextTime: number | null;
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

export function startAmbientFrameGovernor(doc: Document = document, presentation?: {
  visible: () => boolean;
  subscribe: (changed: () => void) => () => void;
}): () => void {
  const view = doc.defaultView;
  if (!view || typeof doc.getAnimations !== "function" || typeof view.CSSAnimation !== "function") return () => {};
  const governed = new Map<Animation, GovernedAnimation>();
  let lastTick = view.performance.now();
  let lastSlowTick = lastTick;
  let slowFrame = false;
  let fps = 0;
  let tickTimer = 0;
  let scanTimer = 0;
  let presented: boolean | undefined;

  const release = (animation: Animation) => {
    governed.delete(animation);
    try {
      if (animation.playState === "paused" && scriptedPlayback.get(animation) !== false) animation.play();
    } catch {
      // The animation's element is gone; nothing to hand back.
    }
  };

  const rescan = () => {
    let nextFps = 0;
    for (const animation of doc.getAnimations()) {
      if (governed.has(animation)) continue;
      const scripted = scriptedPlayback.has(animation);
      const isTransition = typeof view.CSSTransition === "function" && animation instanceof view.CSSTransition;
      if (!(animation instanceof view.CSSAnimation) && !isTransition && !scripted) continue;
      const effect = animation.effect;
      if (!effect || (animation.playState !== "running" && !(scripted && animation.playState === "paused"))) continue;
      const timing = effect.getTiming();
      const target = (effect as KeyframeEffect).target;
      // Track changes also crossfade the random and album layers, using
      // ordinary CSS opacity transitions in addition to the palette keyframes.
      if (isTransition) {
        if (animation.transitionProperty !== "opacity" || !target?.matches(LIGHTING_SURFACES)) continue;
      } else if (!isAmbientLoop(timing) && !(typeof timing.duration === "number" && target?.closest("[data-ambient-layer]"))) continue;
      animation.pause();
      governed.set(animation, { animation, advancing: true, foregroundRate: false, nextTime: null, endTime: ambientEndTime(timing) });
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
      const scripted = scriptedPlayback.get(entry.animation);
      if (scripted !== undefined) {
        entry.advancing = scripted;
        entry.foregroundRate = true;
      } else {
        const style = view.getComputedStyle(target, effect.pseudoElement ?? undefined);
        entry.advancing = !(entry.animation instanceof view.CSSAnimation) ||
          cssPlayStateFor(entry.animation.animationName, style.animationName, style.animationPlayState) === "running";
        entry.foregroundRate = style.getPropertyValue("--bb-ambient-fps").trim() === String(FOREGROUND_AMBIENT_FPS);
      }
      if (presented && entry.advancing) {
        nextFps = Math.max(nextFps, entry.foregroundRate ? FOREGROUND_AMBIENT_FPS : AMBIENT_FRAMES_PER_SECOND);
      }
    }
    if (nextFps === fps) return;
    if (tickTimer) view.clearInterval(tickTimer);
    fps = nextFps;
    lastTick = lastSlowTick = view.performance.now();
    slowFrame = false;
    tickTimer = fps ? view.setInterval(tick, 1000 / fps) : 0;
  };

  const tick = () => {
    const now = view.performance.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (doc.hidden) return;
    // Fifteen divides thirty exactly. Slower loops use alternate shared
    // ticks and consume the elapsed time from both, preserving their speed.
    slowFrame = fps === AMBIENT_FRAMES_PER_SECOND || !slowFrame;
    const slowElapsed = now - lastSlowTick;
    if (slowFrame) lastSlowTick = now;
    const wallTime = Date.now();
    // A currentTime read can flush pending animation styles in Chromium.
    // Read all phases before seeking any effect so one widget's write cannot
    // force a style update for the next widget on the same frame.
    for (const entry of governed.values()) {
      entry.nextTime = null;
      if (!entry.advancing || (!entry.foregroundRate && !slowFrame)) continue;
      const lightOrigin = lightOrigins.get(entry.animation);
      if (lightOrigin !== undefined) {
        entry.nextTime = Math.max(0, wallTime - lightOrigin);
        continue;
      }
      const current = entry.animation.currentTime;
      if (typeof current !== "number") continue;
      // Incremental, so a component that sets currentTime itself keeps its phase.
      entry.nextTime = current + (entry.foregroundRate ? elapsed : slowElapsed) * entry.animation.playbackRate;
    }
    for (const entry of governed.values()) {
      const next = entry.nextTime;
      if (next === null) continue;
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
  const visibilityChanged = () => {
    const visible = !doc.hidden && (presentation?.visible() ?? true);
    if (visible === presented) return;
    presented = visible;
    if (scanTimer) view.clearInterval(scanTimer);
    scanTimer = visible ? view.setInterval(rescan, RESCAN_MS) : 0;
    rescan();
  };
  const unsubscribe = presentation?.subscribe(visibilityChanged);
  doc.addEventListener?.("visibilitychange", visibilityChanged);
  visibilityChanged();
  // A restarted one-shot is adopted on its first frame, not up to a second later.
  // Coalesced: a page load starts dozens of animations at once, and a full
  // getAnimations() + style read per event stalled the greeting's typing.
  let rescanFrame = 0;
  const scheduleRescan = () => {
    if (rescanFrame) return;
    rescanFrame = view.requestAnimationFrame(() => {
      rescanFrame = 0;
      rescan();
    });
  };
  requestScan.set(doc, scheduleRescan);
  doc.addEventListener?.("animationstart", scheduleRescan, true);
  doc.addEventListener?.(AMBIENT_LIGHTING_CHANGE, scheduleRescan);
  const transitionStarted = (event: TransitionEvent) => {
    if (event.propertyName === "opacity" && event.target instanceof view.Element &&
        event.target.matches(LIGHTING_SURFACES)) scheduleRescan();
  };
  doc.addEventListener?.("transitionstart", transitionStarted, true);
  return () => {
    requestScan.delete(doc);
    unsubscribe?.();
    doc.removeEventListener?.("visibilitychange", visibilityChanged);
    doc.removeEventListener?.("animationstart", scheduleRescan, true);
    doc.removeEventListener?.(AMBIENT_LIGHTING_CHANGE, scheduleRescan);
    doc.removeEventListener?.("transitionstart", transitionStarted, true);
    if (rescanFrame) view.cancelAnimationFrame(rescanFrame);
    if (tickTimer) view.clearInterval(tickTimer);
    if (scanTimer) view.clearInterval(scanTimer);
    for (const animation of [...governed.keys()]) release(animation);
  };
}
