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
