/**
 * Voice mode — the hands-free conversation behind the composer's microphone.
 *
 * Turn-taking, narration scheduling and the hand-drawn geometry can be
 * exercised without a microphone, an audio context, or a browser.
 */

/**
 * Two taps inside this window open voice mode instead of starting dictation.
 * A single tap is therefore held for the same span before it records, which is
 * short enough to stay imperceptible next to the permission round trip.
 */
export const VOICE_DOUBLE_TAP_MS = 280;

export function isDoubleTap(previousTapAt: number | null, tapAt: number): boolean {
  if (previousTapAt === null) return false;
  const gap = tapAt - previousTapAt;
  return gap >= 0 && gap <= VOICE_DOUBLE_TAP_MS;
}

/* ---------------------------------------------------------------------------
   Turn taking
   --------------------------------------------------------------------------- */

/** Loudness (0-1 RMS) has to clear this much above the room to count as speech. */
const SPEECH_MARGIN = 3.2;
const SILENCE_MARGIN = 1.9;
/** Floors, so a dead-silent room cannot make every breath a sentence. */
const MIN_SPEECH_LEVEL = 0.024;
const MIN_SILENCE_LEVEL = 0.014;

/**
 * Quiet time that ends a turn once the speaker has actually said something.
 *
 * This is the whole feel of the screen: too short and it takes the turn away
 * mid-thought, which is far worse than waiting. People stop for well over a
 * second in the middle of a sentence — to find a word, to draw breath, to pick
 * up a half-finished clause — so the hold is longer than a natural pause and
 * only a real handover ends the turn.
 */
export const VOICE_SILENCE_HOLD_MS = 2_200;
/** Shorter than this is a cough, a click, or a chair — not a question. */
export const VOICE_MIN_SPEECH_MS = 320;
/** A single turn never runs longer than this, however long the sentence is. */
export const VOICE_MAX_TURN_MS = 45_000;
/** Nothing said at all for this long: stop holding the turn open. */
export const VOICE_NO_SPEECH_MS = 25_000;

export interface VoiceTurnState {
  /** The speaker has crossed the speech threshold at least once this turn. */
  readonly heardSpeech: boolean;
  readonly speechMs: number;
  readonly silenceMs: number;
  readonly elapsedMs: number;
  /** Rolling estimate of the room, so a noisy café does not read as speech. */
  readonly noiseFloor: number;
}

export function initialVoiceTurn(): VoiceTurnState {
  return { heardSpeech: false, speechMs: 0, silenceMs: 0, elapsedMs: 0, noiseFloor: 0.008 };
}

export function speechThreshold(noiseFloor: number): number {
  return Math.max(MIN_SPEECH_LEVEL, noiseFloor * SPEECH_MARGIN);
}

export function silenceThreshold(noiseFloor: number): number {
  return Math.max(MIN_SILENCE_LEVEL, noiseFloor * SILENCE_MARGIN);
}

/** Folds one analysed audio frame into the turn. `level` is 0-1 RMS. */
export function advanceVoiceTurn(
  state: VoiceTurnState,
  level: number,
  frameMs: number,
): VoiceTurnState {
  const loud = level >= speechThreshold(state.noiseFloor);
  const quiet = level <= silenceThreshold(state.noiseFloor);
  return {
    heardSpeech: state.heardSpeech || loud,
    speechMs: loud ? state.speechMs + frameMs : state.speechMs,
    silenceMs: quiet ? state.silenceMs + frameMs : 0,
    elapsedMs: state.elapsedMs + frameMs,
    // Only quiet frames move the floor, and slowly, so a long sentence never
    // drags the threshold up over the speaker's own voice.
    noiseFloor: quiet ? state.noiseFloor * 0.94 + level * 0.06 : state.noiseFloor,
  };
}

export type VoiceTurnVerdict =
  /** Keep the microphone open. */
  | 'listening'
  /** A complete utterance is in the buffer — transcribe and send it. */
  | 'send'
  /** Nobody said anything. Nothing to send. */
  | 'silent';

export function voiceTurnVerdict(state: VoiceTurnState): VoiceTurnVerdict {
  if (state.heardSpeech && state.speechMs >= VOICE_MIN_SPEECH_MS) {
    if (state.silenceMs >= VOICE_SILENCE_HOLD_MS) return 'send';
    if (state.elapsedMs >= VOICE_MAX_TURN_MS) return 'send';
    return 'listening';
  }
  if (state.elapsedMs >= VOICE_NO_SPEECH_MS) return 'silent';
  return 'listening';
}

/** Root-mean-square loudness of one PCM frame, as a 0-1 number. */
export function frameLevel(samples: Float32Array | number[]): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    sum += sample * sample;
  }
  if (samples.length === 0) return 0;
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/* ---------------------------------------------------------------------------
   Conversation
   --------------------------------------------------------------------------- */

export interface VoiceMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** Completed, user-visible narration shown in the thinking dropdown. */
  readonly progressNotes?: readonly string[];
  readonly delegatedAgentPreamble?: string;
}

export interface VoiceNarration {
  readonly text: string;
  readonly kind: 'progress' | 'answer';
}

/** One spoken turn: sealed progress notes first, then its settled answer. */
export function createVoiceNarrationQueue(options: {
  startIndex: number;
  speak: (item: VoiceNarration, signal: AbortSignal) => Promise<void>;
  onIdle: (answered: boolean) => void;
  onError: (error: unknown, item: VoiceNarration) => void;
}) {
  const controller = new AbortController();
  const pending: VoiceNarration[] = [];
  const seen = new Set<string>();
  let running = false;
  let answerQueued = false;

  async function drain() {
    if (running || controller.signal.aborted || !pending.length) return;
    running = true;
    let answered = false;
    try {
      while (pending.length && !controller.signal.aborted) {
        const item = pending.shift()!;
        try {
          await options.speak(item, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          options.onError(error, item);
        }
        answered = item.kind === 'answer';
      }
    } finally {
      running = false;
      if (!controller.signal.aborted) options.onIdle(answered);
    }
  }

  return {
    get speaking() { return running; },
    update(messages: readonly VoiceMessage[], busy: boolean): boolean {
      if (controller.signal.aborted || answerQueued) return answerQueued;
      let latest: VoiceMessage | undefined;
      for (let index = options.startIndex; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role !== 'assistant') continue;
        latest = message;
        for (const note of [...(message.progressNotes ?? []), message.delegatedAgentPreamble ?? '']) {
          const text = note.trim();
          const key = `${index}:${text}`;
          if (!text || seen.has(key)) continue;
          seen.add(key);
          pending.push({ text, kind: 'progress' });
        }
      }
      if (!busy && latest?.content.trim()) {
        answerQueued = true;
        pending.push({ text: latest.content.trim(), kind: 'answer' });
      }
      void drain();
      return answerQueued;
    },
    cancel() {
      pending.length = 0;
      controller.abort();
    },
  };
}

/** The answer voice mode should read out: the newest assistant message. */
export function latestAssistantReply(messages: readonly VoiceMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const content = message.content.trim();
    return content ? content : null;
  }
  return null;
}

/** Voice mode can only speak an answer once, so turns are keyed by position. */
export function replyKey(messages: readonly VoiceMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return `${index}`;
  }
  return null;
}

const MAX_SPOKEN_CHARACTERS = 1_400;

/**
 * Markdown reads badly out loud: fences become "backtick backtick backtick",
 * tables become punctuation soup, and link targets are noise. Strip the syntax
 * down to the sentences a person would actually say.
 */
export function speakableText(markdown: string): string {
  const spoken = markdown
    // Fenced code and math blocks are described, not read.
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (formula omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (spoken.length <= MAX_SPOKEN_CHARACTERS) return spoken;
  // Cut on a sentence boundary rather than mid-word.
  const clipped = spoken.slice(0, MAX_SPOKEN_CHARACTERS);
  const lastStop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  return lastStop > MAX_SPOKEN_CHARACTERS * 0.5 ? clipped.slice(0, lastStop + 1) : clipped;
}

export type VoiceStage =
  | 'opening'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'unavailable'
  | 'blocked';

const STAGE_LABELS: Record<VoiceStage, string> = {
  opening: 'Getting voice ready',
  listening: 'Listening',
  transcribing: 'Catching that',
  thinking: 'Thinking',
  speaking: 'Answering',
  paused: 'Paused',
  unavailable: 'Voice unavailable',
  blocked: 'Microphone blocked',
};

export function stageLabel(stage: VoiceStage): string {
  return STAGE_LABELS[stage];
}

/* ---------------------------------------------------------------------------
   Hand-drawn geometry
   --------------------------------------------------------------------------- */

/** Small deterministic PRNG, so a drawn shape is reproducible from a seed. */
export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A closed circle drawn the way a hand draws one: the radius wanders a little
 * and the curve never quite closes on itself the same way twice.
 */
export function inkRingPath(
  seed: number,
  cx: number,
  cy: number,
  radius: number,
  wobble = 0.045,
  points = 14,
): string {
  const random = seededRandom(seed);
  const knots: Array<[number, number]> = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const drift = 1 + (random() - 0.5) * 2 * wobble;
    knots.push([cx + Math.cos(angle) * radius * drift, cy + Math.sin(angle) * radius * drift]);
  }

  // Catmull-Rom through the knots, converted to cubic beziers, so the wobble
  // stays smooth instead of turning the ring into a polygon.
  const at = (index: number) => knots[(index + knots.length) % knots.length];
  let path = `M ${round(knots[0][0])} ${round(knots[0][1])}`;
  for (let index = 0; index < knots.length; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    path += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(x2)} ${round(y2)}`;
  }
  return `${path} Z`;
}

/**
 * An open, slightly uneven line — the rule a hand draws under a phrase. Drawn
 * in a 0-100 by 0-10 box so it can be stretched under any caption width.
 */
export function inkUnderlinePath(seed: number, points = 8): string {
  const random = seededRandom(seed);
  const step = 100 / points;
  let path = `M 0 ${round(5 + (random() - 0.5) * 2)}`;
  for (let index = 1; index <= points; index += 1) {
    const x = step * index;
    const y = 5 + (random() - 0.5) * 3.4;
    const controlX = x - step / 2;
    const controlY = 5 + (random() - 0.5) * 4.2;
    path += ` Q ${round(controlX)} ${round(controlY)} ${round(x)} ${round(y)}`;
  }
  return path;
}

/**
 * The same circle sketched a few more times, each pass a little different. Drawn
 * one after another they read as a hand going round the line again rather than
 * as separate rings.
 */
export function scribbleRings(cx: number, cy: number, radius: number, count = 3): string[] {
  return Array.from({ length: count }, (_, index) =>
    inkRingPath(31 + index * 17, cx, cy, radius * (1 - index * 0.018), 0.06 + index * 0.012, 15 + index),
  );
}

export interface HaloRing {
  readonly id: string;
  /** The same circle, drawn by a different hand. */
  readonly path: string;
  /** How far out a loud voice carries this ring, as a fraction of the radius. */
  readonly spread: number;
  readonly opacity: number;
  readonly width: number;
}

/**
 * The circle's answer to a voice.
 *
 * An earlier version unwrapped the ring into a nine-strand ribbon while someone
 * talked. It was a lot of movement in the one place the eye is already resting,
 * and the thing the screen is *about* — the circle — left while you were
 * speaking. So the circle stays, and it is answered instead by a few more
 * passes of itself: at rest each ring lies exactly on the drawn line, and the
 * louder the voice the further out they are carried. There is nothing to see
 * until you speak, and what you see then is the same line breathing rather than
 * a second shape arriving.
 */
export function haloRings(cx: number, cy: number, radius: number, count = 3): HaloRing[] {
  return Array.from({ length: count }, (_, index) => {
    // Each ring further out than the last, and fainter and finer for it, so the
    // halo fades into the room rather than ending on a hard outer edge.
    const rank = count > 1 ? index / (count - 1) : 0;
    return {
      id: `halo-${index}`,
      path: inkRingPath(71 + index * 23, cx, cy, radius, 0.03 + index * 0.012, 16 + index),
      spread: round(0.06 + rank * 0.11),
      opacity: round(0.34 - rank * 0.18),
      width: round(1.6 - rank * 0.7),
    };
  });
}
