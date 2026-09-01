// When a turn about a video should select the Watch skill on its own.
//
// Watch is a first-party skill, so its tool is gated on the skill being selected
// for the turn — and until now the only way to select it was to type `/watch`.
// That is the wrong burden for the commonest case by far: somebody attaches a
// video and asks what is in it. Nothing about that sentence says "watch", and
// without the skill the model has a filename and no way to open it, so it either
// guesses from the name or says it cannot see videos.
//
// The rule this module encodes: an attached video, or a retained video selected
// in a Garden, makes the turn about that video unless the user's own words say
// the file is being handled rather than examined. A video *URL* is held to a
// stricter test, because a pasted link can be anything — there the request has
// to actually ask about the content.
//
// Same shape as the other intent modules: pure text in, possibly-prefixed text
// out, with `automatic` recorded on the turn so the choice is auditable.

import type { HermesSurface } from "./config.ts";

/**
 * Wanting something *done to* the file rather than *read out of* it. Only these
 * keep an attached video from selecting Watch, because a false negative here
 * costs the whole answer while a false positive costs one skill block.
 */
const HANDLING_ONLY =
  /\b(?:just\s+)?(?:save|store|keep|upload|attach|move|copy|rename|delete|remove|archive|zip|unzip|compress|shrink|convert|re-?encode|transcode|trim|crop|cut|split|merge|stitch|publish|post|schedule|share|send|email|download)\b/i;

/**
 * Asking what is in it. Deliberately wide: questions, inspect verbs, and the
 * vocabulary of the evidence Watch produces (timestamps, captions, what is on
 * screen).
 */
const CONTENT_REQUEST =
  /(?:\?|\b(?:analy[sz]e|assess|caption|check|compare|critique|describe|diagnose|examine|explain|identify|inspect|list|outline|read|recap|review|summari[sz]e|transcribe|walk\s+me\s+through|watch|what|when|where|which|who|why|how|tell\s+me|show\s+me|find|count|spot|notice|happens?|says?|said|shows?|shown|doing|wearing|wrong|timestamps?|subtitles?|captions?|transcript)\b)/i;

/**
 * Any link at all, so the tests above can be run on the user's own words. A
 * YouTube URL literally contains `/watch?v=` — read as prose it is both a
 * question mark and the word "watch", which would make every pasted link look
 * like a request to examine it.
 */
const ANY_URL = /\bhttps?:\/\/\S+/gi;

/** A link that is a video, or a page whose whole purpose is one. */
const VIDEO_URL =
  /https?:\/\/(?:[^\s<>"']*\b(?:youtube\.com\/(?:watch|shorts|live)|youtu\.be\/|vimeo\.com\/\d|dailymotion\.com\/video|twitch\.tv\/videos|tiktok\.com\/[^\s]*\/video|instagram\.com\/(?:reels?|p|tv)\/)\b[^\s<>"']*|[^\s<>"']+\.(?:mp4|mov|m4v|mkv|webm|avi|mpe?g)(?:\?[^\s<>"']*)?)/i;

export function hasVideoUrl(text: string): boolean {
  return VIDEO_URL.test(text);
}

export interface WatchIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  /** A video came with this message. */
  hasVideoAttachment: boolean;
  /** A video came with an earlier message in this same conversation. */
  hasRecentVideoAttachment?: boolean;
  /** A retained video recording is selected in the active Garden. */
  hasSelectedGardenVideo?: boolean;
}

/**
 * Whether the Watch runtime is actually installed is not decided here. The
 * caller resolves the selection and falls back to the plain text if the skill
 * turns out to be unavailable, which is the same answer this module would give
 * and one fewer place that has to know what Watch needs to run.
 */
export function watchCommandText(
  input: WatchIntentInput,
): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const prose = text.replace(ANY_URL, " ");
  const available =
    input.authenticated &&
    // Watch runs a local pipeline against the session workspace, so it exists
    // only where that workspace does. Garden Chat has one too, and exposes it
    // for retained videos that Breadboard has staged there server-side.
    (input.surface === "dashboard_terminal" ||
      (input.surface === "garden_chat" && input.hasSelectedGardenVideo === true));
  // An explicit command already says what the turn is; never argue with it.
  const eligible = available && !text.startsWith("/");
  const automatic = eligible &&
    (input.hasVideoAttachment || input.hasSelectedGardenVideo
      ? !HANDLING_ONLY.test(prose) || CONTENT_REQUEST.test(prose)
      : Boolean(text) &&
        CONTENT_REQUEST.test(prose) &&
        (hasVideoUrl(text) || input.hasRecentVideoAttachment === true));
  return {
    text: automatic ? `/watch ${input.text}` : input.text,
    automatic,
  };
}
