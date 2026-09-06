export interface LearnCompletionSnapshot {
  gardenId: string;
  jobId: string;
  status: string;
}

/**
 * Return a stable identity only for a single job's transition into success.
 * Initial hydration and switching between jobs or gardens must stay silent.
 */
export function learnCompletionChimeKey(
  previous: LearnCompletionSnapshot | null,
  current: LearnCompletionSnapshot | null,
): string | null {
  if (!previous || !current) return null;
  if (previous.gardenId !== current.gardenId) return null;
  if (previous.jobId !== current.jobId) return null;
  if (previous.status === "complete" || current.status !== "complete") {
    return null;
  }
  return `${current.gardenId}:${current.jobId}`;
}

/** Play a short, non-blocking success chime when the browser permits audio. */
export function playLearnCompletionChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const startAt = context.currentTime + 0.02;
    const notes = [523.25, 659.25, 783.99];

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * 0.16;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.65);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.68);
    });

    void context.resume().catch(() => undefined);
    window.setTimeout(() => void context.close().catch(() => undefined), 1500);
  } catch {
    // Completion must never be affected by unavailable or blocked audio.
  }
}
