export type VoiceCue = 'open' | 'enable' | 'stop' | 'close';

const tones: Record<VoiceCue, readonly number[]> = {
  open: [440, 660], enable: [740], stop: [370], close: [660, 440],
};

/** Quiet earcons with their own output: never interrupt speech or own the mic. */
export function playVoiceCue(cue: VoiceCue): void {
  if (typeof window === 'undefined') return;
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const output = context;
    const play = () => {
      if (output.state === 'closed') return;
      const start = output.currentTime;
      for (const [index, frequency] of tones[cue].entries()) {
        const oscillator = output.createOscillator();
        const gain = output.createGain();
        const at = start + index * 0.09;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.035, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.075);
        oscillator.connect(gain);
        gain.connect(output.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.08);
      }
    };
    if (output.state === 'suspended') void output.resume().then(play).catch(() => {});
    else play();
    // Close even if autoplay was refused; never play a delayed stale cue.
    setTimeout(() => { void output.close().catch(() => {}); }, 250);
  } catch { void context?.close().catch(() => {}); }
}
