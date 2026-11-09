const SPEED_PX_PER_SECOND = 90;
const CORNER_STEPS = 12;

/** Equal distances take equal time, even on a very wide, shallow composer. */
function borderTrajectory(width: number, height: number, radius: number) {
  const horizontal = width - 2 * radius;
  const vertical = height - 2 * radius;
  const corner = Math.PI * radius / 2;
  const perimeter = 2 * (horizontal + vertical) + 4 * corner;
  const keyframes: Keyframe[] = [];
  let distance = 0;
  const point = (x: number, y: number) => keyframes.push({
    offset: distance / perimeter,
    transform: `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`,
  });

  point(radius, 0);
  // Each straight edge is followed by a sampled quarter circle. The browser
  // interpolates the transforms between samples; JavaScript never ticks frames.
  for (let side = 0; side < 4; side++) {
    distance += side % 2 === 0 ? horizontal : vertical;
    const cx = side < 2 ? width - radius : radius;
    const cy = side === 0 || side === 3 ? radius : height - radius;
    const start = (side - 1) * Math.PI / 2;
    point(cx + radius * Math.cos(start), cy + radius * Math.sin(start));
    for (let step = 1; step <= CORNER_STEPS; step++) {
      distance += corner / CORNER_STEPS;
      const angle = start + step / CORNER_STEPS * Math.PI / 2;
      point(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    }
  }
  // Use exactly the same endpoint to avoid a seam (and floating-point offsets
  // slightly over 1) when the compositor repeats the infinite animation.
  keyframes[keyframes.length - 1] = { ...keyframes[0], offset: 1 };
  return { keyframes, duration: perimeter / SPEED_PX_PER_SECOND * 1000 };
}

export function startComposerBeam(surface: HTMLElement) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = false;
  let visible = true;
  let disposed = false;
  let duration = 0;
  let previousWidth = 0;
  let previousHeight = 0;
  const tracks = Array.from(surface.children, child => ({
    element: child as HTMLElement,
    animation: null as Animation | null,
  }));

  // A visible empty composer stays alive even if focus moves to another window.
  const shouldPlay = () => active && visible && !document.hidden && !reducedMotion.matches;

  function sync() {
    if (disposed) return;
    const playing = shouldPlay();
    for (const { animation } of tracks) {
      if (!animation) continue;
      if (playing && animation.playState !== "running") animation.play();
      else if (!playing && animation.playState !== "paused") animation.pause();
    }
  }

  function resize(width: number, height: number) {
    if (disposed || width <= 0 || height <= 0 || (width === previousWidth && height === previousHeight)) return;
    previousWidth = width;
    previousHeight = height;
    const radius = Math.min(parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0, width / 2, height / 2);
    const trajectory = borderTrajectory(width, height, radius);
    tracks.forEach((track, index) => {
      if (track.animation) {
        const progress = (Number(track.animation.currentTime) % duration) / duration;
        const effect = track.animation.effect as KeyframeEffect;
        effect.setKeyframes(trajectory.keyframes);
        effect.updateTiming({ duration: trajectory.duration });
        track.animation.currentTime = progress * trajectory.duration;
      } else {
        track.animation = track.element.animate(trajectory.keyframes, {
          duration: trajectory.duration,
          iterations: Infinity,
          easing: "linear",
        });
        track.animation.currentTime = trajectory.duration * (0.12 + index / tracks.length);
      }
    });
    duration = trajectory.duration;
    sync();
  }

  const sizeObserver = new ResizeObserver(([entry]) => resize(entry.contentRect.width, entry.contentRect.height));
  sizeObserver.observe(surface);
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  observer?.observe(surface);
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", sync);

  return {
    setActive(value: boolean) {
      active = value;
      sync();
    },
    dispose() {
      disposed = true;
      sizeObserver.disconnect();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      for (const track of tracks) track.animation?.cancel();
    },
  };
}
