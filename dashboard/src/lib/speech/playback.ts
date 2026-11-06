import { connectSubscriptionVoice, subscriptionSelected } from "./subscription-live";
import { holdForegroundAudio } from './clap/audio-focus';

let activeAudio: HTMLAudioElement | null = null;
let activeSubscriptionStop: (() => void) | null = null;
let activeUrl: string | null = null;
let activeFinished: ((error?: Error) => void) | null = null;
let releaseClapPlayback: (() => void) | null = null;

export function stopSpeechPlayback(): void { finishSpeechPlayback(); }

function finishSpeechPlayback(error?: Error): void {
  releaseClapPlayback?.(); releaseClapPlayback = null;
  const subscriptionStop = activeSubscriptionStop;
  activeSubscriptionStop = null;
  subscriptionStop?.();
  const audio = activeAudio;
  const url = activeUrl;
  const finished = activeFinished;
  // Clear ownership first. `load()` may dispatch media events, and their
  // once-listeners must see that this element has already been retired rather
  // than recursively running cleanup a second time.
  activeAudio = null;
  activeUrl = null;
  activeFinished = null;
  if (audio) {
    // Revoking the blob URL prevents another read, but Chromium can retain the
    // element's decoded audio until its media resource is explicitly emptied.
    // Every step is best-effort so one browser-state exception cannot skip URL
    // revocation or the caller's completion notification.
    try {
      audio.pause();
    } catch {}
    try {
      audio.currentTime = 0;
    } catch {}
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch {}
  }
  if (url) URL.revokeObjectURL(url);
  finished?.(error);
}

/** Start cloud audio directly from the remote track, without waiting for a blob. */
export async function playSubscriptionText(text: string, onFinished: (error?: Error) => void, signal?: AbortSignal): Promise<boolean> {
  stopSpeechPlayback();
  const operation = new AbortController();
  const joined = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
  let voice: Awaited<ReturnType<typeof connectSubscriptionVoice>> | undefined;
  let release: (() => void) | undefined;
  let finished = false;
  const finish = (error?: Error, notify = true) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', stop);
    release?.();
    if (activeSubscriptionStop === stop) activeSubscriptionStop = null;
    if (voice) void (voice.release?.(!error && !joined.aborted) ?? voice.close());
    if (notify) onFinished(error);
  };
  const stop = () => {
    if (finished) return;
    try { voice?.stopSpeaking?.(); }
    finally { operation.abort(); finish(); }
  };
  // Own cancellation before the first await. A superseded connection must
  // never become audible later or take ownership from its replacement.
  activeSubscriptionStop = stop;
  signal?.addEventListener('abort', stop, { once: true });
  if (joined.aborted) { stop(); return true; }
  try {
    const selected = await subscriptionSelected(joined);
    if (finished || joined.aborted) return true;
    if (!selected) { finish(undefined, false); return false; }
    release = holdForegroundAudio();
    voice = await connectSubscriptionVoice({ signal: joined });
    if (finished || joined.aborted) { await voice.close(); return true; }
  } catch (error) {
    if (finished || joined.aborted) return true;
    finish(undefined, false);
    throw error;
  }
  void (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await voice!.speak(text); return; }
      catch (error) {
        // Retry only when nothing heard would be repeated: a silent start, or a
        // live reading that strayed and says where to resume. Never replay
        // completed passages or an ambiguous POST.
        const meta = error && typeof error === 'object' ? error as { resumeAt?: unknown; safeToRetry?: unknown } : {};
        const resumeAt = typeof meta.resumeAt === 'number' ? meta.resumeAt : undefined;
        const silentStart = attempt === 0 && meta.safeToRetry === true;
        if (attempt > 1 || joined.aborted || (resumeAt === undefined && !silentStart)) throw error;
        await voice!.close();
        joined.throwIfAborted();
        if (resumeAt !== undefined) { text = text.slice(resumeAt); if (!text.trim()) return; }
        voice = await connectSubscriptionVoice({ signal: joined });
        if (joined.aborted) { await voice.close(); joined.throwIfAborted(); }
      }
    }
  })().then(() => finish(), error => finish(joined.aborted ? undefined : error instanceof Error ? error : new Error("Subscription speech failed.")));
  return true;
}

export async function playSpeechBlob(blob: Blob, onFinished: (error?: Error) => void, onProgress?: (progress: number) => void): Promise<void> {
  stopSpeechPlayback();
  releaseClapPlayback = holdForegroundAudio();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeAudio = audio;
  activeUrl = url;
  activeFinished = onFinished;
  const finish = (error?: Error) => {
    if (activeAudio !== audio) return;
    finishSpeechPlayback(error);
  };
  const reportProgress = () => {
    if (activeAudio === audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      onProgress?.(Math.min(1, audio.currentTime / audio.duration));
    }
  };
  audio.addEventListener("timeupdate", reportProgress);
  audio.addEventListener("durationchange", reportProgress);
  audio.addEventListener("ended", () => {
    if (activeAudio === audio) onProgress?.(1);
    finish();
  }, { once: true });
  audio.addEventListener("error", () => finish(new Error('The selected voice audio could not play.')), { once: true });
  try {
    await audio.play();
    reportProgress();
  } catch (error) {
    finish(error instanceof Error ? error : new Error('Voice playback failed.'));
    throw error;
  }
}

/** Play streaming MP3 immediately; other providers keep their existing audio decoder. */
export async function playSpeechResponse(response: Response, signal: AbortSignal, onProgress?: (progress: number) => void): Promise<void> {
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!response.body || mime !== 'audio/mpeg' || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
    const blob = await response.blob();
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const stop = () => { stopSpeechPlayback(); reject(signal.reason); };
      signal.addEventListener('abort', stop, { once: true });
      const finish = (error?: Error) => { signal.removeEventListener('abort', stop); if (error) reject(error); else resolve(); };
      void playSpeechBlob(blob, finish, onProgress).catch(finish);
    });
    return;
  }
  signal.throwIfAborted();
  stopSpeechPlayback();
  const media = new MediaSource();
  const reader = response.body.getReader();
  const url = URL.createObjectURL(media);
  const audio = new Audio(url);
  activeAudio = audio; activeUrl = url;
  releaseClapPlayback = holdForegroundAudio();
  let retired = false;
  const waits = new Set<(error: Error) => void>();
  const stop = () => { if (activeAudio === audio) finishSpeechPlayback(); };
  const waitFor = (target: EventTarget, name: string) => new Promise<void>((resolve, reject) => {
    const clean = () => { target.removeEventListener(name, done); target.removeEventListener('error', failed); waits.delete(cancel); };
    const done = () => { clean(); resolve(); };
    const cancel = (error: Error) => { clean(); reject(error); };
    const failed = () => cancel(new Error('The selected voice audio could not play.'));
    waits.add(cancel);
    target.addEventListener(name, done, { once: true });
    target.addEventListener('error', failed, { once: true });
  });
  await new Promise<void>((resolve, reject) => {
    activeFinished = error => {
      retired = true;
      signal.removeEventListener('abort', stop);
      void reader.cancel().catch(() => {});
      for (const cancel of [...waits]) cancel(new DOMException('Playback stopped', 'AbortError'));
      if (error) reject(error); else if (signal.aborted) reject(signal.reason); else resolve();
    };
    signal.addEventListener('abort', stop, { once: true });
    audio.addEventListener('ended', () => { onProgress?.(1); stop(); }, { once: true });
    audio.addEventListener('error', () => {
      if (activeAudio === audio) finishSpeechPlayback(new Error('The selected voice audio could not play.'));
    }, { once: true });
    audio.addEventListener('timeupdate', () => {
      if (!retired && Number.isFinite(audio.duration) && audio.duration > 0) onProgress?.(Math.min(1, audio.currentTime / audio.duration));
    });
    void (async () => {
      if (media.readyState !== 'open') await waitFor(media, 'sourceopen');
      if (retired) return;
      const buffer = media.addSourceBuffer('audio/mpeg');
      let playing = false;
      while (!retired) {
        const { value, done } = await reader.read();
        if (done) break;
        if (retired) return;
        const updated = waitFor(buffer, 'updateend');
        try { buffer.appendBuffer(new Uint8Array(value)); }
        catch (error) { void updated.catch(() => {}); throw error; }
        await updated;
        if (!playing && !retired) { playing = true; void audio.play().catch(error => { if (activeAudio === audio) finishSpeechPlayback(error); }); }
      }
      if (!retired && media.readyState === 'open') media.endOfStream();
      if (!playing && !retired) throw new Error('The voice provider returned empty audio.');
    })().catch(error => { if (activeAudio === audio) finishSpeechPlayback(error); });
  });
}
