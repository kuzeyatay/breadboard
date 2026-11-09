import { createScriptGuard, type ScriptGuard } from './script-guard.ts';
import { numericSpeechScript, numericSpeechTranscript } from './numeric-script.ts';

/** A locally spelled numeric script has no words that may be skipped. Stop on
 * the first confirmed extra/wrong word, retaining the same exact final check.
 * Conversation permits one existing acknowledgement; its partial tokens are
 * held until identifiable, never counted as numeric answer progress. */
export function createNumericReadingGuard(script: string, language: string, conversation = false): ScriptGuard & {
  feed(transcript: string, final?: boolean): void;
} {
  const guard = createScriptGuard(script, { lookahead: 0, tolerance: 1, numericTolerance: 1, language });
  return {
    feed(transcript, final = false) {
      const leading = transcript.trimStart().toLowerCase();
      if (!final && conversation && /^en(?:-|$)/i.test(language)
          && ['mm-hmm', 'okay'].some(acknowledgement => acknowledgement.startsWith(leading))) return;
      // A digit token can expand from "105" to "1052". Spelling its current
      // prefix would prematurely commit "one hundred" instead of "one
      // thousand". Hold that entire token until a separator or completion.
      const stable = !final ? transcript.replace(/[+-]?\d[\d,.]*$/u, '') : transcript;
      // Keep the same token expansion when text follows a numeral. Converting
      // only a standalone "21" and later leaving "21 units" unchanged would
      // change the already consumed token indices and hide the extra word.
      const reading = numericSpeechTranscript(stable, language, conversation)
        .replace(/(?<![\p{L}\p{N}])[+-]?\d+(?:,\d{3})*(?:\.\d+)?(?![\p{L}\p{N}])/gu,
          value => numericSpeechScript(value, language));
      // Conversion can remove trailing whitespace. Preserve the boundary used
      // to distinguish a completed word from a token still being streamed.
      const boundary = final || /\s$/u.test(transcript) ? ' ' : '';
      guard.feed(reading + boundary);
    },
    get diverged() { return guard.diverged; },
    get position() { return guard.position; },
    get complete() { return guard.complete; },
    get remainingWords() { return guard.remainingWords; },
    get resumeAt() { return guard.resumeAt; },
  };
}
