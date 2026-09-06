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
  if (!await subscriptionSelected(signal)) return false;
  stopSpeechPlayback();
  const release = holdForegroundAudio();
  const operation = new AbortController();
  const joined = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
  const voice = await connectSubscriptionVoice({ signal: joined }).catch(error => { release(); throw error; });
  let finished = false;
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    release();
    if (activeSubscriptionStop === stop) activeSubscriptionStop = null;
    void voice.close();
    onFinished(error);
  };
  const stop = () => { operation.abort(); finish(); };
  activeSubscriptionStop = stop;
  void voice.speak(text).then(() => finish(), error => finish(joined.aborted ? undefined : error instanceof Error ? error : new Error("Subscription speech failed.")));
  return true;
}

export async function playSpeechBlob(blob: Blob, onFinished: (error?: Error) => void): Promise<void> {
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
  audio.addEventListener("ended", () => finish(), { once: true });
  audio.addEventListener("error", () => finish(new Error('The selected voice audio could not play.')), { once: true });
  try {
    await audio.play();
  } catch (error) {
    finish(error instanceof Error ? error : new Error('Voice playback failed.'));
    throw error;
  }
}
