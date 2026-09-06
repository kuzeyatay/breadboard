/** Foreground features retain their own streams and constraints. Only ambient capture yields. */
export const AUDIO_FOCUS_EVENT = 'breadboard:audio-focus';
export const AUDIO_LOCK = 'breadboard:foreground-microphone';
type FocusState = { holds: number; channel?: BroadcastChannel; releases: WeakMap<MediaStream, () => void>; id: string; peers: Map<string, number> };
function state(): FocusState {
  const host = globalThis as typeof globalThis & { __breadboardAudioFocus?: FocusState };
  return host.__breadboardAudioFocus ??= { holds: 0, releases: new WeakMap(), id: crypto.randomUUID(), peers: new Map() };
}
export function audioFocusChannel(): BroadcastChannel | undefined {
  const s = state();
  if (!s.channel && typeof BroadcastChannel !== 'undefined') {
    s.channel = new BroadcastChannel('breadboard:audio-focus');
    const publish = () => s.channel?.postMessage({ id: s.id, holds: s.holds });
    s.channel.onmessage = event => {
      if (event.data === 'query') { publish(); return; }
      if (event.data?.id) {
        if (event.data.holds > 0) s.peers.set(event.data.id, Date.now() + 15_000);
        else s.peers.delete(event.data.id);
      }
      window.dispatchEvent(new Event(AUDIO_FOCUS_EVENT));
    };
    s.channel.postMessage('query');
    window.setInterval(() => {
      if (s.holds) publish();
      for (const [id, until] of s.peers) if (until < Date.now()) { s.peers.delete(id); window.dispatchEvent(new Event(AUDIO_FOCUS_EVENT)); }
    }, 5000);
    window.addEventListener('pagehide', () => s.channel?.postMessage({ id: s.id, holds: 0 }));
  }
  return s.channel;
}
function changed() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUDIO_FOCUS_EVENT)); const s = state(); audioFocusChannel()?.postMessage({ id: s.id, holds: s.holds });
}
export function foregroundAudioActive() { const s = state(); return s.holds > 0 || [...s.peers.values()].some(until => until > Date.now()); }
export function holdForegroundAudio(): () => void {
  state().holds++; changed();
  let done = false;
  let unlock = () => {};
  const finished = new Promise<void>(resolve => { unlock = resolve; });
  // This lease also covers playback and session preparation without a stream.
  if (typeof navigator !== 'undefined' && navigator.locks) void navigator.locks.request(AUDIO_LOCK, { mode: 'shared' }, () => finished).catch(() => {});
  return () => { if (done) return; done = true; unlock(); state().holds--; changed(); };
}
/** Queues a shared foreground lease after ambient's exclusive lease is fully released. */
export async function requestForegroundMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const unhold = holdForegroundAudio();
  let releaseLock = () => {};
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  try {
    if (navigator.locks) {
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request(AUDIO_LOCK, { mode: 'shared' }, async () => {
          releaseLock = finish; resolve(); await finished;
        }).catch(reject);
      });
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    let released = false;
    const release = () => {
      if (released) return; released = true; state().releases.delete(stream); releaseLock(); unhold();
    };
    state().releases.set(stream, release);
    for (const track of stream.getTracks()) track.addEventListener('ended', () => {
      if (stream.getTracks().every(t => t.readyState === 'ended')) release();
    }, { once: true });
    return stream;
  } catch (error) { releaseLock(); unhold(); throw error; }
}
export function stopForegroundStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  state().releases.get(stream)?.();
}
