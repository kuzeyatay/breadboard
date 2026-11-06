import { openDictationProvider } from './dictation-provider';
import { AUDIO_FOCUS_EVENT, audioFocusChannel, otherForegroundAudioActive } from './clap/audio-focus';
import { onSpeechSettingsChanged } from './settings-client';
import type { SubscriptionVoice } from './subscription-live';

type Connection = { voice: SubscriptionVoice; controller: AbortController; closing?: Promise<void>; releaseFocus?: () => void };
type Options = { idleMs?: number; otherAudio?: () => boolean; watchIdle?: (discard: () => void) => () => void; holdFocus?: () => () => void;
  prepare?: (signal: AbortSignal) => Promise<SubscriptionVoice> };

/** One muted input connection, either prepared without a microphone or returned
 * by a fully finalized hold. Unfinished transcripts are never reused. */
export function createDictationProviderCache(connect = openDictationProvider, options: Options = {}) {
  let idle: Connection | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  let retirement = Promise.resolve();
  let borrowed = 0;
  let preparing: { controller: AbortController; promise: Promise<boolean> } | undefined;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  function take() {
    clearTimeout(timer); unwatch?.(); unwatch = undefined;
    const entry = idle; idle = undefined; return entry;
  }
  function retire(entry?: Connection) {
    if (entry) {
      entry.controller.abort();
      retirement = Promise.all([retirement, entry.closing ??= entry.voice.close().finally(() => entry.releaseFocus?.())]).then(() => {}, () => {});
    }
    return retirement;
  }
  const clear = () => {
    const pending = preparing; pending?.controller.abort();
    return Promise.all([retire(take()), pending?.promise.catch(() => {})]).then(() => {});
  };
  function keep(entry: Connection) {
    void retire(take()); idle = entry;
    const ttl = options.idleMs ?? 20_000;
    if (Number.isFinite(ttl)) timer = setTimeout(() => { void clear(); }, ttl);
    unwatch = options.watchIdle?.(() => { void clear(); });
  }
  return {
    clear,
    watch(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async prepare(signal: AbortSignal): Promise<boolean> {
      signal.throwIfAborted();
      if (!options.prepare || borrowed || options.otherAudio?.()) return false;
      if (idle?.voice.isHealthy()) return true;
      if (idle) {
        await retire(take());
        // Let standby back off when a supposedly ready connection dies. A
        // foreground shortcut can still retry immediately through open().
        throw new Error('The background dictation connection ended.');
      }
      let job = preparing;
      if (!job) {
        const controller = new AbortController();
        job = { controller, promise: Promise.resolve(false) }; preparing = job;
        const owned = job;
        job.promise = (async () => {
          await retirement; controller.signal.throwIfAborted();
          const voice = await options.prepare!(controller.signal);
          if (controller.signal.aborted || options.otherAudio?.()) { await voice.close(); return false; }
          try {
            if (!voice.isHealthy()) throw new Error('The background dictation connection is unavailable.');
            voice.setListening(false); voice.setCallbacks({});
            keep({ voice, controller });
          } catch (error) { controller.abort(); await voice.close(); throw error; }
          return true;
        })().finally(() => { if (preparing === owned) preparing = undefined; });
      }
      const selected = job;
      const abort = () => selected.controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      try { signal.throwIfAborted(); return await selected.promise; }
      finally { signal.removeEventListener('abort', abort); }
    },
    async open(microphone: MediaStream, selected: Promise<boolean>, signal: AbortSignal,
      onTranscript?: (text: string, final?: boolean) => void, onDisconnect?: (error: Error) => void, onInputReady?: () => void): Promise<SubscriptionVoice | null> {
      borrowed++;
      let returned = false;
      const returnedToCache = () => { if (!returned) { returned = true; borrowed--; changed(); } };
      let entry: Connection | undefined;
      let ended = false, reusable = false;
      let releaseFocus: (() => void) | undefined;
      let controller: AbortController | undefined;
      const callbacks = {
        onTranscript: (text: string, final?: boolean) => { if (!ended && !signal.aborted) onTranscript?.(text, final); },
        onDisconnect: (error: Error) => { reusable = false; if (!ended && !signal.aborted) onDisconnect?.(error); },
      };
      const abort = () => { controller?.abort(); if (entry) void retire(entry); };
      try {
        if (!await selected) { await clear(); signal.throwIfAborted(); return await connect(microphone, Promise.resolve(false), signal, onTranscript, onDisconnect, onInputReady); }
        // A shortcut during warm-up adopts the same pending connection rather
        // than allocating a second session. A failed warm-up permits cold retry.
        await preparing?.promise.catch(() => {});
        await retirement; signal.throwIfAborted();
        entry = take();
        if (entry && !entry.voice.isHealthy()) { await retire(entry); entry = undefined; }
        releaseFocus = entry?.releaseFocus ?? options.holdFocus?.();
        controller = entry?.controller ?? new AbortController();
        signal.addEventListener('abort', abort, { once: true });
        signal.throwIfAborted();
        if (entry) {
          entry.voice.setListening(false);
          entry.voice.resetTranscript(); entry.voice.setCallbacks(callbacks);
          entry.voice.setMicrophone(microphone); entry.voice.setListening(true);
          onInputReady?.();
        } else {
          const voice = await connect(microphone, Promise.resolve(true), controller.signal,
            callbacks.onTranscript, callbacks.onDisconnect, () => { if (!ended && !signal.aborted) onInputReady?.(); });
          if (!voice) { releaseFocus?.(); signal.removeEventListener('abort', abort); return null; }
          entry = { voice, controller, releaseFocus };
        }
        signal.throwIfAborted();
        const owned = entry;
        return {
          ...owned.voice,
          async finishTranscript(finishOptions) {
            const text = await owned.voice.finishTranscript(finishOptions);
            reusable = finishOptions?.settleFinal === true && Boolean(text.trim()) && owned.voice.isHealthy();
            return text;
          },
          async close() {
            if (ended) return;
            ended = true; signal.removeEventListener('abort', abort);
            try {
              owned.voice.setListening(false); owned.voice.setCallbacks({});
              if (!reusable || signal.aborted || !owned.voice.isHealthy() || options.otherAudio?.()) { await retire(owned); return; }
              keep(owned);
            } finally { returnedToCache(); }
          },
        };
      } catch (error) {
        ended = true; signal.removeEventListener('abort', abort); controller?.abort();
        await retire(entry); if (!entry) releaseFocus?.(); throw error;
      } finally {
        if (!entry || ended) returnedToCache();
      }
    },
  };
}

const cache = createDictationProviderCache(openDictationProvider, {
  // Connect only after a shortcut, and retain a completed hold for at most 20s.
  otherAudio: otherForegroundAudioActive,
  watchIdle: discard => {
    if (typeof window === 'undefined') return () => {};
    audioFocusChannel();
    const focus = () => { if (otherForegroundAudioActive()) discard(); };
    const settings = onSpeechSettingsChanged(discard);
    window.addEventListener(AUDIO_FOCUS_EVENT, focus);
    window.addEventListener('pagehide', discard);
    return () => { settings(); window.removeEventListener(AUDIO_FOCUS_EVENT, focus); window.removeEventListener('pagehide', discard); };
  },
});
export const openHeldDictationProvider = cache.open;
export const closeHeldDictationProvider = cache.clear;
