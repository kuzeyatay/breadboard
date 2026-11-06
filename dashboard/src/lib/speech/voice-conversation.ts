import type { GenerativeUiResource } from '../generative-ui/contracts.ts';
import { responseTextForSpeech } from './response-text.ts';

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
 * Leave room for breaths between words, without adding several seconds to
 * every exchange before transcription or model work can even begin.
 */
export const VOICE_SILENCE_HOLD_MS = 1_100;
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
  readonly clientMessageId?: string;
  /** Public words arriving before the final chat answer is committed. */
  readonly voiceStream?: { readonly text: string; readonly segment: number };
  /** Completed, user-visible narration shown in the thinking dropdown. */
  readonly progressNotes?: readonly string[];
  readonly delegatedAgentPreamble?: string;
  readonly uiResources?: GenerativeUiResource[];
}

/** A complete spoken sign-off or request to close voice mode, not a mention
 * of saying goodbye inside a task, quotation, or negated instruction. */
export function isVoiceExitRequest(value: string): boolean {
  const text = value.normalize('NFKC').toLowerCase()
    .replace(/\[(?:sigh|sighs|laughs|laughter|chuckles|breathes|breathing)\]/g, ' ')
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:okay|ok|alright|well|thanks|thank you|please|and|then|so)\s+)+/, '')
    .replace(/(?:\s+(?:please|thanks|thank you))+$/, '');
  const addressed = '(?: (?:bread|breadboard|assistant))?';
  return new RegExp(`^(?:bye(?: bye)?|goodbye|good night|see you(?: later)?|talk to you later|catch you later|thats all|that is all|im done|i am done)${addressed}$`).test(text)
    || /^(?:(?:you can|you may|can you|could you|would you) )?(?:please )?(?:close (?:yourself|voice(?: mode| assistant)?|the voice (?:mode|assistant)|this (?:voice )?(?:chat|conversation|window))|(?:end|exit|stop) (?:voice(?: mode)?|the voice (?:mode|assistant)|this (?:voice )?(?:chat|conversation)|the conversation))(?: now)?$/.test(text);
}

export interface VoiceTranscriptQuestion {
  readonly requestId: string;
  readonly question: string;
  readonly messageIndex: number;
  readonly contentBefore: string;
  readonly answer?: string;
}

/** A tool answer lives after the assistant's row in the host log, while that
 * same row keeps streaming. Split it at each question to preserve speaking order. */
export function voiceTranscriptMessages(
  messages: readonly VoiceMessage[],
  questions: readonly VoiceTranscriptQuestion[],
): VoiceMessage[] {
  const transcript: VoiceMessage[] = [];
  const append = (role: VoiceMessage['role'], content: string, uiResources?: GenerativeUiResource[]) => {
    if (content.trim() || uiResources?.length) {
      transcript.push({ role, content: content.trim(), ...(uiResources?.length ? { uiResources } : {}) });
    }
  };
  const appendQuestion = (question: VoiceTranscriptQuestion) => {
    if (transcript.at(-1)?.role !== 'assistant' || transcript.at(-1)?.content !== question.question.trim()) {
      append('assistant', question.question);
    }
    const answer = messages.find(message => message.clientMessageId === `clarify:${question.requestId}`)?.content ?? question.answer;
    if (answer) append('user', answer);
  };
  messages.forEach((message, index) => {
    if (questions.some(question => message.clientMessageId === `clarify:${question.requestId}`)) return;
    const interruptions = message.role === 'assistant' ? questions.filter(question => question.messageIndex === index) : [];
    let offset = 0;
    for (const question of interruptions) {
      const end = message.content.startsWith(question.contentBefore) ? question.contentBefore.length : offset;
      append(message.role, message.content.slice(offset, end));
      appendQuestion(question);
      offset = end;
    }
    // A resumed answer may be split around several questions. Its widgets
    // belong to the final fragment, including a resource-only response.
    append(message.role, message.content.slice(offset), message.role === 'assistant' ? message.uiResources : undefined);
  });
  for (const question of questions.filter(question => question.messageIndex < 0)) appendQuestion(question);
  return transcript;
}

export interface VoiceNarration {
  readonly text: string;
  readonly kind: 'progress' | 'answer';
  /** A streamed sentence is audible before the complete assistant turn is done. */
  readonly final?: boolean;
}

/** Only seal sentences outside unfinished Markdown/code/math. Never read a partial token. */
export function voiceSentenceBoundary(text: string): number {
  let end = 0;
  for (const match of text.matchAll(/[.!?](?:["'”’)]*)\s+|\n\n/g)) {
    const candidate = match.index! + match[0].length;
    const prefix = text.slice(0, candidate);
    if ((prefix.match(/```|~~~/g)?.length ?? 0) % 2 || (prefix.match(/\$\$/g)?.length ?? 0) % 2 || (prefix.match(/\$/g)?.length ?? 0) % 2) continue;
    if ((prefix.match(/\\\[/g)?.length ?? 0) !== (prefix.match(/\\\]/g)?.length ?? 0)) continue;
    if ((prefix.match(/\\\(/g)?.length ?? 0) !== (prefix.match(/\\\)/g)?.length ?? 0)) continue;
    if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|e\.g|i\.e)|\b[A-Z])\.\s*$/u.test(prefix)) continue;
    if (prefix.trim().length >= 24) { end = candidate; break; }
  }
  return end;
}

export const VOICE_PROGRESS_DELAY_MS = 1_500;
export const VOICE_PROGRESS_INTERVAL_MS = 12_000;
const VOICE_ANSWER_PHRASE_CHARACTERS = 480;
export const VOICE_ANSWER_COALESCE_MS = 240;

/** A brief public status, never raw reasoning, tool arguments or a log dump. */
function spokenProgress(note: string): string {
  const text = note.replace(/\s+/g, ' ').trim();
  if (!text || /^(?:thinking|working|processing|loading|please wait)[.\s…!]*$/i.test(text)
    || /```|^\s*[\[{]|https?:\/\//.test(text)) return '';
  if (text.length <= 220) return text;
  const boundary = voiceSentenceBoundary(text);
  return boundary && boundary <= 220 ? text.slice(0, boundary).trim() : '';
}

/** One spoken turn: occasional current progress and uninterrupted answer phrases. */
export function createVoiceNarrationQueue(options: {
  startIndex: number;
  /** A clarification resumes the same assistant message. Skip what it said
   * before the question, but keep watching that message for its continuation. */
  initialMessage?: VoiceMessage;
  streamAnswers?: boolean;
  speak: (item: VoiceNarration, signal: AbortSignal) => Promise<void>;
  onIdle: (answered: boolean) => void;
  onError: (error: unknown, item: VoiceNarration) => void;
}) {
  const controller = new AbortController();
  const pending: VoiceNarration[] = [];
  const seen = new Set<string>();
  for (const note of [...(options.initialMessage?.progressNotes ?? []), options.initialMessage?.delegatedAgentPreamble ?? '']) {
    const text = spokenProgress(note);
    if (text) seen.add(`${options.startIndex}:${text.toLocaleLowerCase()}`);
  }
  let running = false;
  let answerQueued = false;
  let hasWorked = false;
  let answerStarted = false;
  let progressCandidate = '';
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let phraseTimer: ReturnType<typeof setTimeout> | undefined;
  let nextProgressAt = Date.now() + VOICE_PROGRESS_DELAY_MS;
  const spokenPrefixes = new Map<string, string>();
  const latestSegments = new Map<number, number>();
  const streamKey = (index: number, message?: VoiceMessage) => {
    const segment = message?.voiceStream?.segment;
    if (segment !== undefined) latestSegments.set(index, segment);
    // A canonical refresh drops ephemeral stream fields. Keep the last known
    // segment so its final tail is neither lost nor spoken a second time.
    return String(index) + ':' + String(segment ?? latestSegments.get(index) ?? 0);
  };
  if (options.initialMessage?.voiceStream) {
    spokenPrefixes.set(streamKey(options.startIndex, options.initialMessage), options.initialMessage.voiceStream.text);
  }

  function clearProgress() {
    progressCandidate = '';
    clearTimeout(progressTimer);
    progressTimer = undefined;
    for (let index = pending.length - 1; index >= 0; index--) {
      if (pending[index].kind === 'progress') pending.splice(index, 1);
    }
  }

  function scheduleProgress() {
    if (!progressCandidate || progressTimer !== undefined || running || answerStarted || answerQueued || controller.signal.aborted) return;
    progressTimer = setTimeout(() => {
      progressTimer = undefined;
      if (!progressCandidate || answerStarted || answerQueued || controller.signal.aborted) return;
      pending.push({ text: progressCandidate, kind: 'progress' });
      progressCandidate = '';
      nextProgressAt = Date.now() + VOICE_PROGRESS_INTERVAL_MS;
      void drain();
    }, Math.max(0, nextProgressAt - Date.now()));
  }

  function queueAnswer(item: VoiceNarration) {
    answerStarted = true;
    clearProgress();
    const previous = pending.at(-1);
    // Speech arriving while an utterance plays becomes a connected phrase,
    // instead of opening a new synthesis request for every short sentence.
    if (previous?.kind === 'answer' && previous.text.length + item.text.length + 1 <= VOICE_ANSWER_PHRASE_CHARACTERS) {
      pending[pending.length - 1] = { ...item, text: [previous.text, item.text].filter(Boolean).join(' ') };
    } else pending.push(item);
  }

  function scheduleAnswer() {
    if (running || controller.signal.aborted || !pending.length) return;
    // A stream often delivers adjacent sentences in separate token batches.
    // Give a short opening phrase one bounded window to collect its neighbor,
    // avoiding another provider round trip in the middle of a short answer.
    // Complete answers and substantial phrases can start immediately.
    const first = pending[0];
    if (first.kind !== 'answer' || first.final !== false || first.text.length >= 160) {
      clearTimeout(phraseTimer);
      phraseTimer = undefined;
      void drain();
    } else if (phraseTimer === undefined) {
      phraseTimer = setTimeout(() => { phraseTimer = undefined; void drain(); }, VOICE_ANSWER_COALESCE_MS);
    }
  }

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
        answered = item.kind === 'answer' && item.final !== false;
      }
    } finally {
      running = false;
      if (!controller.signal.aborted) {
        options.onIdle(answered);
        scheduleProgress();
      }
    }
  }

  return {
    get speaking() { return running; },
    update(messages: readonly VoiceMessage[], busy: boolean): boolean {
      if (controller.signal.aborted || answerQueued) return answerQueued;
      hasWorked ||= busy;
      let latest: VoiceMessage | undefined;
      let latestIndex = -1;
      for (let index = options.startIndex; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role !== 'assistant') continue;
        latestIndex = index;
        const previous = index === options.startIndex ? options.initialMessage?.content : undefined;
        latest = previous && message.content.startsWith(previous)
          ? { ...message, content: message.content.slice(previous.length) }
          : message;
        for (const note of [...(message.progressNotes ?? []), message.delegatedAgentPreamble ?? '']) {
          const text = spokenProgress(note);
          const key = `${index}:${text.toLocaleLowerCase()}`;
          if (!text || seen.has(key)) continue;
          seen.add(key);
          if (busy && !answerStarted) progressCandidate = text;
        }
      }
      if (options.streamAnswers && latest) {
        const key = streamKey(latestIndex, latest);
        let prefix = spokenPrefixes.get(key) ?? '';
        const content = latest.voiceStream?.text ?? latest.content;
        // A rewritten prefix cannot be unspoken. Wait for finalization instead
        // of replaying content or guessing which revision the user heard.
        if (content.startsWith(prefix)) {
          let remaining = content.slice(prefix.length);
          for (let boundary = voiceSentenceBoundary(remaining); busy && boundary; boundary = voiceSentenceBoundary(remaining)) {
            queueAnswer({ text: remaining.slice(0, boundary).trim(), kind: 'answer', final: false });
            prefix += remaining.slice(0, boundary);
            spokenPrefixes.set(key, prefix);
            remaining = remaining.slice(boundary);
          }
        }
      }
      if (!busy && latest && (latest.content.trim() || latest.uiResources?.length)) {
        answerQueued = true;
        const prefix = spokenPrefixes.get(streamKey(latestIndex, latest)) ?? '';
        const text = latest.content.startsWith(prefix) ? latest.content.slice(prefix.length).trim() : '';
        queueAnswer({ text, kind: 'answer' });
      } else if (!busy && latest && hasWorked && !options.initialMessage) {
        // A finished run with no answer must not strand the microphone on
        // Thinking forever. Show the failure and return the floor to the user.
        answerQueued = true;
        const item: VoiceNarration = { text: '', kind: 'answer' };
        options.onError(new Error('Breadboard finished without an answer. You can try again.'), item);
        queueAnswer(item);
      }
      scheduleAnswer();
      scheduleProgress();
      return answerQueued;
    },
    cancel() {
      pending.length = 0;
      clearProgress();
      clearTimeout(phraseTimer);
      phraseTimer = undefined;
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

/**
 * Markdown reads badly out loud: fences become "backtick backtick backtick",
 * tables become punctuation soup, and link targets are noise. Strip the syntax
 * down to the sentences a person would actually say.
 */
export function speakableText(markdown: string, signal?: AbortSignal): Promise<string> {
  return responseTextForSpeech(markdown, { signal });
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
