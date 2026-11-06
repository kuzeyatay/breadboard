import type { SpeechSettings } from './settings';

const CHANNEL = 'breadboard:speech-settings';
type SpeechConfiguration = { userId?: string; settings: SpeechSettings };
let cached: SpeechConfiguration | null = null;
let expires = 0;
let pending: Promise<SpeechConfiguration> | null = null;
let channel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();

function listen() {
  if (typeof window === 'undefined' || channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => invalidateSpeechSettings();
}

export function invalidateSpeechSettings() {
  cached = null; expires = 0; pending = null;
  for (const listener of listeners) listener();
}
export function notifySpeechSettingsChanged() {
  listen(); invalidateSpeechSettings(); channel?.postMessage({ type: 'changed' });
}
export function onSpeechSettingsChanged(listener: () => void) {
  listen(); listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Share lookup across audio chunks; saved changes invalidate every open view. */
export async function loadSpeechSettings(signal?: AbortSignal) {
  listen(); signal?.throwIfAborted();
  if (cached && Date.now() < expires) return cached;
  const request = pending ??= fetch('/api/speech/settings', { cache: 'no-store' }).then(async response => {
    const body = await response.json();
    if (!response.ok || !body.settings) throw new Error(body.error || 'Speech settings are unavailable.');
    if (pending === request) { cached = body; expires = Date.now() + 10_000; }
    return body as SpeechConfiguration;
  });
  void request.finally(() => { if (pending === request) pending = null; }).catch(() => {});
  if (!signal) return request;
  return new Promise<SpeechConfiguration>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
