// When a turn about music should select the Audio Analysis skill on its own.
//
// The skill's tools are gated on the skill being selected for the turn, and
// typing `/audio-analysis` is the wrong burden for the only sentence anyone
// actually writes: "what's the tempo of this?" with a song attached. Without
// the skill the model has a filename and no way to hear anything, so it answers
// from what it remembers about the artist — which is the failure this module
// exists to prevent, and the worst kind, because it sounds right.
//
// The rule is Watch-shaped rather than Image-to-3D-shaped. An attached picture
// usually is not the subject of the turn; an attached *song* almost always is.
// So an attached track selects the skill unless the words say the file is being
// handled rather than listened to.
//
// Same shape as the other intent modules: pure text in, possibly-prefixed text
// out, with `automatic` recorded on the turn so the choice is auditable.

import type { HermesSurface } from "./config.ts";

/** The first-party skill directory name, which is also its slash command. */
export const AUDIO_ANALYSIS_SKILL = "audio-analysis";

/**
 * Wanting something *done to* the file rather than *heard in* it. Only these
 * keep an attached track from selecting the skill, because a false negative
 * costs the whole answer while a false positive costs one skill block.
 */
const HANDLING_ONLY =
  /\b(?:just\s+)?(?:save|store|keep|upload|attach|move|copy|rename|delete|remove|archive|zip|unzip|compress|convert|re-?encode|transcode|publish|post|schedule|share|send|email|download)\b/i;

/**
 * Asking what is *said* rather than what is played. Whisper transcribes; the
 * analyzer measures a waveform and has no idea what the words are. Selecting
 * this skill for "transcribe this voice memo" would answer a question about
 * language with a key and a tempo.
 */
const SPEECH_ONLY =
  /\b(?:transcribe|transcription|transcript|subtitles?|captions?|what\s+(?:do(?:es)?|did)\s+(?:he|she|they|it|the\s+\w+)\s+say|dictat|voice\s*(?:memo|note)|speech\s*-?\s*to\s*-?\s*text)\b/i;

/**
 * Asking about music, without a file yet in hand. This is the test a request
 * has to pass when the track came from an earlier message rather than this one
 * — "and the second one?" should keep the skill, "thanks, that's all" should
 * not.
 */
const MUSIC_REQUEST =
  /(?:\?|\b(?:analy[sz]e|analysis|assess|bpm|tempo|key|pitch|chord|harmon(?:y|ic)|melod(?:y|ic)|rhythm|groove|beat|time\s+signature|loud(?:ness)?|lufs|dynamics?|dynamic\s+range|clip(?:ping)?|master(?:ing|ed)?|mix(?:ing|ed|down)?|eq|equali[sz]|frequenc|spectrum|spectral|bass|treble|brightness|muddy|mud|harsh|boomy|stereo|mono|phase|width|panning|reference|compare|section|structure|intro|verse|chorus|bridge|drop|breakdown|arrangement|timbre|texture|sounds?|sonic|listen|hear|track|song|mix|master|record(?:ing)?|produc(?:tion|ed)|describe|critique|review|feedback|what|how|why|which|where|when)\b)/i;

/** A link is not prose; it is stripped before any test so a URL cannot match one. */
const ANY_URL = /\bhttps?:\/\/\S+/gi;

export interface AudioAnalysisIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  /** An analyzable track came with this message. */
  hasAudioAttachment: boolean;
  /** An analyzable track came with an earlier message in this conversation. */
  hasRecentAudioAttachment?: boolean;
}

/**
 * Whether the analyzer is actually installed is not decided here. The caller
 * resolves the selection and falls back to the plain text when the skill turns
 * out to be unavailable — the same answer this module would give, and one fewer
 * place that has to know what the analyzer needs to run.
 */
export function audioAnalysisCommandText(
  input: AudioAnalysisIntentInput,
): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const prose = text.replace(ANY_URL, " ");
  const available =
    input.authenticated &&
    // Both conversational surfaces: nothing here needs a workspace, because the
    // stored file is resolved server-side from the conversation. Quartz is
    // excluded because it is the public frontend.
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  // An explicit command already says what the turn is; never argue with it.
  const eligible = available && !text.startsWith("/");
  const automatic =
    eligible &&
    !SPEECH_ONLY.test(prose) &&
    (input.hasAudioAttachment
      ? !HANDLING_ONLY.test(prose) || MUSIC_REQUEST.test(prose)
      : input.hasRecentAudioAttachment === true &&
        Boolean(text) &&
        MUSIC_REQUEST.test(prose));
  return {
    text: automatic ? `/${AUDIO_ANALYSIS_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
