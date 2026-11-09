/**
 * Whether anyone is using this window. Decorative motion (composer beam, metal
 * send button) settles once input stops: left running on a
 * visible but untouched window it kept the GPU process near a full core all
 * night. Progress indicators (spinners, thinking orbs) keep moving; the one
 * exception is the Terminal usage notch, whose glass made each frame costly.
 * Visible Terminal backgrounds, rings and navbar motion are deliberately
 * independent of input-idle state so they continue on a second monitor.
 */
export const USER_IDLE_MS = 60_000;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"] as const;

let idle = false;
let lastInput = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setIdle(next: boolean) {
  if (idle === next) return;
  idle = next;
  // CSS-only loops (globals.css `html[data-user-idle]`) settle with the rest.
  globalThis.document?.documentElement.toggleAttribute("data-user-idle", next);
  for (const listener of listeners) listener();
}

// One timer, re-armed only when it fires: pointermove must stay cheap.
function schedule(ms: number) {
  timer = setTimeout(() => {
    timer = undefined;
    const left = lastInput + USER_IDLE_MS - Date.now();
    if (left > 0) schedule(left);
    else setIdle(true);
  }, ms);
}

// The window losing focus (another app in front, or a click into the shell)
// settles decoration at once rather than after the quiet minute. Only the
// window's own blur: element blurs do not bubble to this non-capture listener.
function onWindowBlur(event: Event) {
  if (event.target === window) setIdle(true);
}

/** Counts as input. Also called when new decoration mounts, so a fresh toast animates before settling. */
export function wakeUser() {
  lastInput = Date.now();
  setIdle(false);
  if (!timer && listeners.size > 0) schedule(USER_IDLE_MS);
}

export function subscribeUserIdle(changed: () => void) {
  if (listeners.size === 0) {
    for (const type of INPUT_EVENTS) window.addEventListener(type, wakeUser, { capture: true, passive: true });
    window.addEventListener("blur", onWindowBlur);
  }
  listeners.add(changed);
  wakeUser();
  return () => {
    listeners.delete(changed);
    if (listeners.size > 0) return;
    for (const type of INPUT_EVENTS) window.removeEventListener(type, wakeUser, { capture: true });
    window.removeEventListener("blur", onWindowBlur);
    clearTimeout(timer);
    timer = undefined;
    setIdle(false);
  };
}

export const userIdle = () => idle;
export const serverUserIdle = () => false;
