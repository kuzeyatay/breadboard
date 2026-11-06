/** Shared by the PDF reader and the desktop's isolated Find toolbar. */
export function createFindMissFeedback() {
  let pending: string | null = null;
  let context: AudioContext | null = null;
  let lastPlayed = -Infinity;

  const prepare = () => {
    if (typeof window === "undefined") return;
    // Unlock in the input/click/keyboard gesture, before async search finishes.
    try {
      if (!context || context.state === "closed") {
        context = new window.AudioContext({ latencyHint: "interactive" });
      }
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    } catch { /* Search still works when audio is unavailable. */ }
  };

  const cancel = () => { pending = null; };
  const dispose = () => {
    cancel();
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    context = null;
  };

  return {
    prepare,
    begin(query: string) {
      pending = query.trim() ? query : null;
      if (pending) prepare();
    },
    settle(query: string, matches: number, final = true) {
      if (!final || pending === null || pending !== query) return;
      pending = null;
      const audio = context;
      if (matches !== 0 || !audio || audio.state !== "running" || document.hidden) return;
      const now = performance.now();
      if (now - lastPlayed < 250) return;
      lastPlayed = now;
      try {
        // A quiet, rounded descending buzz: original synthesis, no system asset.
        const start = audio.currentTime;
        for (const frequency of [180, 184]) {
          const tone = audio.createOscillator();
          const gain = audio.createGain();
          tone.type = "triangle";
          tone.frequency.setValueAtTime(frequency, start);
          tone.frequency.exponentialRampToValueAtTime(frequency * 0.72, start + 0.16);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.055, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
          tone.connect(gain).connect(audio.destination);
          tone.onended = () => { tone.disconnect(); gain.disconnect(); };
          tone.start(start);
          tone.stop(start + 0.19);
        }
      } catch { /* Never interrupt Find because an audio device disappeared. */ }
    },
    cancel,
    dispose,
  };
}
