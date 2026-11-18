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

let listeningClip: Promise<string | null> | null = null;

/**
 * Render the listening sound once in the chosen voice, so "mm-hmm" sounds like
 * the assistant rather than a beep. A provider that cannot (or a failure)
 * leaves the hummed fallback.
 */
export function prepareListeningSound(): void {
  if (typeof window === 'undefined' || listeningClip) return;
  listeningClip = fetch('/api/speech/synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Mm-hmm.', delivery: 'conversation' }),
  }).then(async response => {
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('audio/')) return null;
    return URL.createObjectURL(await response.blob());
  }).catch(() => null);
}

/** A quiet "mm-hmm" while the person pauses mid-thought. Never takes the mic. */
export function playListeningSound(): void {
  if (typeof window === 'undefined') return;
  void (listeningClip ?? Promise.resolve(null)).then(url => {
    if (url) {
      const audio = new Audio(url);
      audio.volume = 0.4;
      void audio.play().catch(() => humListening());
      return;
    }
    humListening();
  });
}

/** Two closed-mouth hums, rising then falling: the shape of "mm-hm". */
function humListening(): void {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const output = context;
    const play = () => {
      if (output.state === 'closed') return;
      const filter = output.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      filter.connect(output.destination);
      const hum = (at: number, length: number, from: number, to: number) => {
        const voice = output.createOscillator();
        const gain = output.createGain();
        voice.type = 'sawtooth';
        voice.frequency.setValueAtTime(from, at);
        voice.frequency.linearRampToValueAtTime(to, at + length);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.05, at + 0.03);
        gain.gain.setValueAtTime(0.05, at + length - 0.05);
        gain.gain.linearRampToValueAtTime(0, at + length);
        voice.connect(gain);
        gain.connect(filter);
        voice.start(at);
        voice.stop(at + length);
      };
      const start = output.currentTime;
      hum(start, 0.16, 150, 165);
      hum(start + 0.22, 0.22, 175, 135);
    };
    if (output.state === 'suspended') void output.resume().then(play).catch(() => {});
    else play();
    setTimeout(() => { void output.close().catch(() => {}); }, 700);
  } catch { void context?.close().catch(() => {}); }
}
