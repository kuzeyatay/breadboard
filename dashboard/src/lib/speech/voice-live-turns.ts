/**
 * The small judgements voice mode makes about a live call, kept free of the
 * DOM so they can be tested directly: whether a sound over the reply was only
 * a backchannel, what a spoken answer to a permission ask means, when to make
 * a listening sound, and how long the call takes from voice to voice.
 */

const BACKCHANNEL_WORDS = new Set([
  // English
  'mm', 'mmm', 'mhm', 'mmhmm', 'hmm', 'hm', 'uh', 'huh', 'um', 'umm', 'er', 'ah', 'oh', 'ooh', 'aha',
  'yeah', 'yea', 'yep', 'yup', 'yes', 'ok', 'okay', 'kay', 'right', 'sure', 'cool', 'nice', 'wow',
  'great', 'alright', 'i', 'see', 'got', 'it', 'gotcha', 'true', 'indeed', 'exactly', 'ahem', 'ugh',
  // Noises a transcriber writes out: [cough], (laughs), *sneeze*
  'cough', 'coughs', 'coughing', 'laugh', 'laughs', 'laughing', 'laughter', 'sneeze', 'sneezes', 'sigh', 'sighs', 'noise', 'inaudible',
  // Dutch and Turkish, the other languages this call is spoken in
  'ja', 'jawel', 'oke', 'precies', 'klopt', 'evet', 'tamam', 'hı', 'hıhı', 'aynen', 'peki',
]);

/** "mm-hmm", "uh-huh", "hahaha", "ha ha": sounds rather than words. */
const SOUND_TOKEN = /^(?:(?:m+|h+m+|u+h+|a+h+)-?h+m+|uh-?huh|(?:ha|he|hi|ho)+h?|(?:a|e|i|o)?hem|m+h?m+)$/u;

/**
 * True when what was heard over a reply was a listener's noise ("mm-hmm",
 * "yeah", a laugh, a cough transcribed as nothing) rather than a turn. Only
 * meaningful while a reply is playing: outside one, "yeah" is an answer.
 */
export function isBackchannel(text: string): boolean {
  const words = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 4) return false;
  return words.every(word => BACKCHANNEL_WORDS.has(word.replace(/'/g, '')) || SOUND_TOKEN.test(word));
}

export type SpokenPermission = 'once' | 'always' | 'reject';

/**
 * A spoken answer to "Allow it?". Refusals are checked first, so "no, don't"
 * never reads as consent; "always" needs words that clearly widen the grant.
 * Anything unclear is null and the question is asked again.
 */
export function permissionAnswer(text: string, allowSession: boolean): SpokenPermission | null {
  const said = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  if (said.trim() === '') return null;
  if (/ (no|nope|nah|don't|do not|dont|deny|denied|reject|refuse|stop|cancel|never|not now|hayır|nee) /.test(said)) return 'reject';
  if (allowSession && / (always|every time|don't ask again|dont ask again|for (the|this) (session|chat)|from now on|similar) /.test(said)) return 'always';
  if (/ (yes|yeah|yep|yup|sure|ok|okay|allow|allowed|go ahead|do it|go for it|fine|please do|approve|approved|evet|tamam|ja) /.test(said)) return 'once';
  return null;
}

/** The sentence voice mode says when a tool asks for permission. */
export function permissionQuestion(description: string, allowSession: boolean): string {
  const ask = description.trim().replace(/[.?!]*$/, '') || 'An action needs your permission';
  return `${ask}. Allow it? Say yes${allowSession ? ', always' : ''} or no.`;
}

export const LISTENING_SOUND_MIN_SPEECH_MS = 3_000;
export const LISTENING_SOUND_PAUSE_MS = 700;
export const LISTENING_SOUND_GAP_MS = 8_000;

/**
 * When to make a quiet "mm-hmm" while someone talks: at a pause in a turn that
 * already holds three seconds of speech, once per pause, at most once every
 * eight seconds, and never right after a question.
 */
export function createListeningSounds(now: () => number = () => performance.now()) {
  let speechMs = 0;
  let quietMs = 0;
  let firedThisPause = false;
  let lastAt = -Infinity;
  return {
    reset() { speechMs = 0; quietMs = 0; firedThisPause = false; },
    push(loud: boolean, frameMs: number, options: { listening: boolean; question?: boolean }): boolean {
      if (!options.listening) { speechMs = 0; quietMs = 0; firedThisPause = false; return false; }
      if (loud) { speechMs += frameMs; quietMs = 0; firedThisPause = false; return false; }
      if (speechMs === 0) return false;
      quietMs += frameMs;
      if (firedThisPause || options.question || speechMs < LISTENING_SOUND_MIN_SPEECH_MS || quietMs < LISTENING_SOUND_PAUSE_MS) return false;
      if (now() - lastAt < LISTENING_SOUND_GAP_MS) return false;
      firedThisPause = true;
      lastAt = now();
      return true;
    },
  };
}

/** Median voice-to-voice time over the last few turns of a call, in ms. */
export function createLatencyMeter(size = 9) {
  const samples: number[] = [];
  let startedAt: number | null = null;
  return {
    /** The person stopped talking. */
    start(at: number) { startedAt = at; },
    /** The first audio of the reply began; returns the new median. */
    finish(at: number): number | null {
      if (startedAt === null) return null;
      const elapsed = at - startedAt;
      startedAt = null;
      if (!(elapsed > 0 && elapsed < 300_000)) return this.median();
      samples.push(elapsed);
      if (samples.length > size) samples.shift();
      return this.median();
    },
    cancel() { startedAt = null; },
    median(): number | null {
      if (!samples.length) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      const middle = sorted.length >> 1;
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    },
  };
}

export function formatLatency(ms: number | null): string {
  return ms === null ? '' : `${(ms / 1000).toFixed(1)} s`;
}

/** Scale a camera or screen frame so its long side is at most `max` pixels. */
export function frameSize(width: number, height: number, max = 1280): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
