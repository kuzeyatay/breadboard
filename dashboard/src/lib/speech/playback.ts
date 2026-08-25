let activeAudio: HTMLAudioElement | null = null;
let activeUrl: string | null = null;
let activeFinished: (() => void) | null = null;

export function stopSpeechPlayback(): void {
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
  finished?.();
}

export async function playSpeechBlob(blob: Blob, onFinished: () => void): Promise<void> {
  stopSpeechPlayback();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeAudio = audio;
  activeUrl = url;
  activeFinished = onFinished;
  const finish = () => {
    if (activeAudio !== audio) return;
    stopSpeechPlayback();
  };
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", finish, { once: true });
  try {
    await audio.play();
  } catch (error) {
    finish();
    throw error;
  }
}
