/**
 * Live read-aloud plays the remote track as it streams, so a wrong reading
 * cannot be taken back. The guard follows the reader's own output transcript
 * word by word against the script and reports the first point where the
 * reader clearly stops reading it, so playback can be muted within a word or
 * two and a fresh reading can resume from that sentence.
 */

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function normalize(token: string): string {
  return token.normalize('NFKC').toLowerCase().replace(/['’]/gu, '');
}

export function transcriptWords(text: string): string[] {
  return (text.match(WORD) ?? []).map(normalize).filter(Boolean);
}

export interface ScriptGuardOptions {
  /** Consecutive words outside the script before the reading counts as abandoned. */
  tolerance?: number;
  /** Script words the reader may skip or paraphrase before the guard loses its place. */
  lookahead?: number;
  /** Spoken words allowed while a number is being read out ("1,234" → many words). */
  numericTolerance?: number;
}

export interface ScriptGuard {
  /** Feed the accumulated output transcript. Only complete words are judged. */
  feed(transcript: string): void;
  /** The reader has clearly stopped reading the script. */
  readonly diverged: boolean;
  /** Characters of the script confirmed spoken so far. */
  readonly position: number;
  /** Every script word has been reached. */
  readonly complete: boolean;
  /** Readable (non-numeric) script words not reached yet. */
  readonly remainingWords: number;
  /** Where a fresh reading should start: the sentence holding the first unconfirmed word. */
  readonly resumeAt: number;
}

export function createScriptGuard(script: string, options: ScriptGuardOptions = {}): ScriptGuard {
  const tolerance = options.tolerance ?? 3;
  const lookahead = options.lookahead ?? 4;
  const numericTolerance = options.numericTolerance ?? 24;
  const expected: { word: string; end: number }[] = [];
  for (const match of script.matchAll(WORD)) {
    const word = normalize(match[0]);
    if (word) expected.push({ word, end: match.index + match[0].length });
  }
  let position = 0;
  let misses = 0;
  let consumed = 0;
  let diverged = false;
  const isNumeric = (entry: { word: string }) => /\p{N}/u.test(entry.word);
  // Numbers, dates and prices are spoken as many words that never match their
  // digits, so the window looks past them to the next few readable words.
  const window = () => {
    const entries: { word: string; index: number }[] = [];
    for (let index = position + 1, readable = 0; index < expected.length && readable < lookahead; index++) {
      entries.push({ word: expected[index].word, index });
      if (!isNumeric(expected[index])) readable++;
    }
    return entries;
  };
  const numeric = () => expected.slice(position, position + lookahead + 1).some(isNumeric);
  return {
    feed(transcript) {
      const spoken = transcriptWords(transcript);
      // The transcript grows by appending. Its last word may still be growing,
      // so it is judged only once something follows it.
      const complete = /[\p{L}\p{N}]$/u.test(transcript) ? spoken.length - 1 : spoken.length;
      for (; consumed < complete && !diverged; consumed++) {
        const word = spoken[consumed];
        if (position < expected.length && expected[position].word === word) { position++; misses = 0; continue; }
        const skipped = window().find(entry => entry.word === word);
        if (skipped) { position = skipped.index + 1; misses = 0; continue; }
        if (++misses >= (numeric() ? numericTolerance : tolerance)) diverged = true;
      }
    },
    get diverged() { return diverged; },
    get position() { return position ? expected[position - 1].end : 0; },
    get complete() { return position >= expected.length; },
    get remainingWords() { return expected.slice(position).filter(entry => !isNumeric(entry)).length; },
    get resumeAt() {
      // Punctuation directly after the last confirmed word closes its sentence.
      const spoken = this.position;
      const boundary = [...script.matchAll(/(?:[.!?。！？]["'”’»）)\]]*|\n)(?:\s+|$)/gu)].filter(match => match.index <= spoken).at(-1);
      return boundary ? Math.min(boundary.index + boundary[0].length, script.length) : 0;
    },
  };
}
