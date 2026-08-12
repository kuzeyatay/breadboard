let activeAudio: HTMLAudioElement | null = null;
let activeUrl: string | null = null;
let activeFinished: (() => void) | null = null;

export function stopSpeechPlayback(): void {
  const finished = activeFinished;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  if (activeUrl) URL.revokeObjectURL(activeUrl);
  activeAudio = null;
  activeUrl = null;
  activeFinished = null;
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

