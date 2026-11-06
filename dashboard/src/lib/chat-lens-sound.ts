// One lazily unlocked audio context per renderer, shared by all chat rails.
const KEY = 'breadboard:chat-rail-sound';
const CHANGE_EVENT = 'breadboard:chat-rail-sound-change';
let context: AudioContext | null = null;
let output: GainNode | null = null;
let buffers: AudioBuffer[] = [];
let users = 0;
let count = 0;
let lastPlayed = -1;
let enabled = true;
let unsubscribePreference: (() => void) | null = null;

export function getChatRailSoundEnabled(): boolean {
  try { return window.localStorage.getItem(KEY) !== 'false'; }
  catch { return true; }
}

export function setChatRailSoundEnabled(value: boolean): boolean {
  try {
    window.localStorage.setItem(KEY, String(value));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch { return false; }
}

export function subscribeChatRailSound(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function lensClickSamples(rate: number, seed: number): Float32Array {
  const duration = .046;
  const data = new Float32Array(Math.ceil(rate * duration));
  const fastAlpha = 1 - Math.exp(-2 * Math.PI * 5200 / rate);
  const slowAlpha = 1 - Math.exp(-2 * Math.PI * 850 / rate);
  const bodyAlpha = 1 - Math.exp(-2 * Math.PI * 620 / rate);
  const pitch = 1 + ((seed % 11) - 5) * .004;
  const delay = .0046 + (seed % 5) * .00015;
  let fast = 0, slow = 0, low = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1, t = i / rate;
    fast += fastAlpha * (noise - fast);
    slow += slowAlpha * (noise - slow);
    low += bodyAlpha * (noise - low);
    const band = fast - slow, onset = 1 - Math.exp(-t * 11000);
    const contact = .48 * band * onset * Math.exp(-t * 730);
    const body = onset * (
      .23 * Math.sin(2 * Math.PI * 570 * pitch * t) * Math.exp(-t * 245) +
      .10 * Math.sin(2 * Math.PI * 1360 * pitch * t) * Math.exp(-t * 490) +
      .045 * Math.sin(2 * Math.PI * 2870 * pitch * t) * Math.exp(-t * 900)
    );
    const r = t - delay;
    const rebound = r > 0 ? (1 - Math.exp(-r * 8500)) * (
      .16 * band * Math.exp(-r * 860) +
      .045 * Math.sin(2 * Math.PI * 790 * pitch * r) * Math.exp(-r * 450)
    ) : 0;
    data[i] = (contact + body + rebound + .035 * low * onset * Math.exp(-t * 260)) *
      Math.min(1, Math.max(0, (duration - t) / .007));
    peak = Math.max(peak, Math.abs(data[i]));
  }
  for (let i = 0; i < data.length; i++) data[i] *= .62 / Math.max(peak, .001);
  return data;
}

function readPreference() {
  enabled = getChatRailSoundEnabled();
  if (output) output.gain.value = enabled ? .22 : 0;
}
function unlock() {
  if (!enabled || !users || document.hidden) return;
  // Wheel events cannot unlock audio before the first real user activation.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    if (!context) {
      if (!window.AudioContext) return;
      context = new window.AudioContext({ latencyHint: 'interactive' });
      output = context.createGain(); output.gain.value = .22; output.connect(context.destination);
      const audio = context;
      buffers = [13, 47, 101, 193, 317, 541].map(seed => {
        const data = lensClickSamples(audio.sampleRate, seed);
        const buffer = audio.createBuffer(1, data.length, audio.sampleRate);
        buffer.getChannelData(0).set(data);
        return buffer;
      });
    }
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  } catch { /* A rail still works when the browser cannot provide audio. */ }
}

export function acquireLensSound() {
  let released = false;
  if (users++ === 0) {
    readPreference();
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
    unsubscribePreference = subscribeChatRailSound(readPreference);
  }
  return {
    unlock,
    play(direction: number) {
      if (!enabled || document.hidden) return;
      unlock();
      if (!context || context.state !== 'running' || !output) return;
      const now = context.currentTime, interval = now - lastPlayed;
      if (interval < .02) return;
      lastPlayed = now;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffers[count % buffers.length];
      source.playbackRate.value = (direction < 0 ? .99 : 1.005) + ((count % 3) - 1) * .006;
      gain.gain.value = (interval < .04 ? .72 : interval < .08 ? .86 : 1) * (1 - count % 3 * .018);
      source.connect(gain); gain.connect(output); source.start(now);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      count++;
    },
    release() {
      if (released) return;
      released = true;
      if (--users !== 0) return;
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      unsubscribePreference?.(); unsubscribePreference = null;
      const old = context;
      context = null; output = null; buffers = []; lastPlayed = -1;
      if (old) void old.close().catch(() => undefined);
    },
  };
}
