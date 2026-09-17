const PREFERENCE_KEY = 'breadboard:notification-sound';
const CHANGE_EVENT = 'breadboard:notification-sound-change';
const RECEIPTS_KEY = 'breadboard:notification-sound-receipts';
const MAX_RECEIPTS = 256;
let receipts: string[] = [];
let lastPlayedAt = 0;

export function getNotificationSoundEnabled(): boolean {
  try { return window.localStorage.getItem(PREFERENCE_KEY) !== 'false'; }
  catch { return true; }
}

export function setNotificationSoundEnabled(enabled: boolean): boolean {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, String(enabled));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch { return false; }
}

export function subscribeNotificationSound(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PREFERENCE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** A quiet, two-note bell with a soft attack and a short decay. */
function playChime(isVisible: () => boolean): () => void {
  let context: AudioContext | undefined;
  let timeout: number | undefined;
  const close = () => {
    window.clearTimeout(timeout);
    void context?.close().catch(() => undefined);
  };
  try {
    context = new window.AudioContext();
    const audio = context;
    // Also closes suspended contexts: blocked autoplay must never queue a
    // surprise sound for the next click or leave audio resources behind.
    timeout = window.setTimeout(close, 800);
    void audio.resume().then(() => {
      if (audio.state !== 'running' || !getNotificationSoundEnabled() || !isVisible()) {
        close();
        return;
      }
      const start = audio.currentTime + 0.01;
      [880, 1174.66].forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const at = start + index * 0.1;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.07, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.36);
      });
    }).catch(close);
  } catch {
    close();
    // Sound is optional; notifications still arrive if audio is unavailable.
  }
  return close;
}

/** Coalesce bursts and remember delivery across polls, reloads, and windows. */
export function chimeForNotifications(
  ids: readonly string[],
  isVisible: (id: string) => boolean,
): () => void {
  let cancelled = false;
  let stop: (() => void) | undefined;
  const cancel = () => { cancelled = true; stop?.(); };
  if (!ids.length || typeof window === 'undefined') return cancel;
  const deliver = () => {
    if (cancelled) return;
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(RECEIPTS_KEY) ?? '[]');
      if (Array.isArray(stored)) receipts = stored.filter((id): id is string => typeof id === 'string');
    } catch { /* Retain this renderer's receipts if storage is unavailable. */ }
    const known = new Set(receipts);
    const fresh = ids.filter(id => !known.has(id) && isVisible(id));
    if (!fresh.length) return;
    receipts = [...new Set([...receipts, ...fresh])].slice(-MAX_RECEIPTS);
    try { window.localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts)); }
    catch { /* Repeated polls still stay silent in this renderer. */ }
    // Muted notices are consumed too, so enabling sound never plays a backlog.
    if (!getNotificationSoundEnabled() || Date.now() - lastPlayedAt < 1_000) return;
    lastPlayedAt = Date.now();
    stop = playChime(() => !cancelled && fresh.some(isVisible));
  };
  // Every desktop window has an overlay; claim each delivery only once.
  if (navigator.locks) void navigator.locks.request(RECEIPTS_KEY, deliver).catch(() => undefined);
  else deliver();
  return cancel;
}
