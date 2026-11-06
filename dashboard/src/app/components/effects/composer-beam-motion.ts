type BeamPose = { angle: number; velocity: number; opacity: number };

const randomBetween = (low: number, high: number) => low + Math.random() * (high - low);
const transform = (angle: number) => `translate(-50%, -50%) rotate(${angle}deg)`;

/**
 * Prepare a fresh trajectory, then let the compositor play it. Integrating a
 * smoothly changing velocity keeps both position and speed continuous at the
 * joins, including occasional reversals. Nothing writes styles every frame.
 */
function nextDrift(from: BeamPose) {
  const seconds = randomBetween(9, 16);
  const direction = Math.sign(from.velocity) * (Math.random() < 0.22 ? -1 : 1);
  const velocity = direction * randomBetween(7, 19);
  const opacity = randomBetween(0.4, 0.85);
  const keyframes: Keyframe[] = [];
  for (let step = 0; step <= 48; step++) {
    const t = step / 48;
    const blend = t * t * (3 - 2 * t);
    const distance = seconds * (from.velocity * t + (velocity - from.velocity) * (t ** 3 - t ** 4 / 2));
    keyframes.push({
      offset: t,
      transform: transform(from.angle + distance),
      opacity: from.opacity + (opacity - from.opacity) * blend,
    });
  }
  return {
    keyframes,
    duration: seconds * 1000,
    end: { angle: from.angle + seconds * (from.velocity + velocity) / 2, velocity, opacity },
  };
}

export function startComposerBeam(surface: HTMLElement) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = false;
  let visible = true;
  let disposed = false;
  const tracks = Array.from(surface.children, (child, index) => ({
    element: child as HTMLElement,
    pose: {
      angle: randomBetween(0, 360),
      velocity: randomBetween(7, 19) * (index === 0 ? 1 : -1),
      opacity: randomBetween(0.4, 0.85),
    },
    animation: null as Animation | null,
  }));

  const shouldPlay = () => active && visible && !document.hidden && !reducedMotion.matches;

  function playNext(track: typeof tracks[number]) {
    if (disposed) return;
    const drift = nextDrift(track.pose);
    const animation = track.element.animate(drift.keyframes, {
      duration: drift.duration,
      easing: "linear",
      fill: "forwards",
    });
    track.animation = animation;
    if (!shouldPlay()) animation.pause();
    animation.onfinish = () => {
      // Persist the exact endpoint before replacing the animation; no reset to
      // zero degrees and no accumulated finished animations on long chats.
      track.pose = drift.end;
      track.element.style.transform = transform(track.pose.angle);
      track.element.style.opacity = String(track.pose.opacity);
      animation.cancel();
      track.animation = null;
      if (shouldPlay()) playNext(track);
    };
  }

  function sync() {
    const playing = shouldPlay();
    for (const track of tracks) {
      if (!playing) track.animation?.pause();
      else if (track.animation) track.animation.play();
      else playNext(track);
    }
  }

  for (const track of tracks) {
    track.element.style.transform = transform(track.pose.angle);
    track.element.style.opacity = String(track.pose.opacity);
  }
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
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      for (const track of tracks) {
        if (track.animation) {
          track.animation.onfinish = null;
          track.animation.cancel();
        }
      }
    },
  };
}
