// When a turn asking for a video should select the Video skill on its own.
//
// "Make me a 20 second video about the launch" names no skill, and the render
// tool only opens for a turn that selected one. This is what makes Remotion the
// default: a request to make a video reaches it without a slash command.
//
// Text-only, like Diagram Design. A turn that carries a video file is about
// that file and belongs to Watch, which runs earlier in both chains; so does
// the interactive visualizer, which keeps anything meant to be played with.

import type { HermesSurface } from "./config.ts";

/**
 * Two skills share the renderer. Video makes flat motion graphics and is what a
 * plain request gets; Film is the 3D engine, chosen when the request asks for
 * depth, or when the turn continues a film.
 */
const WANTS_FILM = new RegExp("\\b(?:3-?d|three[\\s-]dimensional|cinematic|particles?|shaders?|volumetric|film)\\b", "i");

/**
 * A third skill, with its own renderer: Math Animation draws mathematics with
 * Manim. It takes a video request whose subject is mathematical, any request
 * that names Manim, and follow-ups to an animation it made.
 */
const MATH_SUBJECT =
  /\b(?:manim|3blue1brown|math(?:s|ematics?|ematical)?|calculus|derivatives?|integrals?|integration|differentiation|differential\s+equations?|algebra|geometry|trigonometr\w*|theorems?|equations?|fourier|taylor\s+series|matri(?:x|ces)|eigen\w+|linear\s+transformations?|probability|polynomials?|logarithms?|pythagor\w*|complex\s+numbers?|unit\s+circle|sine|cosine|riemann|prime\s+numbers?|fibonacci|fractals?)\b/i;

const NAMES_MANIM =
  /\b(?:with|using|use|in|via)\s+manim\b|\bmanim\s+(?:animation|video|scene|explainer)\b/i;

const MATH_CONTEXT = /\bmath(?:ematical)?\s+animation\b|\bmanim\b/i;

const VIDEO_NOUN =
  "(?:videos?|animations?|motion[\\s-]graphics?|title[\\s-]sequence|kinetic[\\s-]typography|animated\\s+(?:explainer|intro|logo|chart|infographic|title|text|ad|banner))";

// "video call", "video script" and friends are about something else.
const NOT_A_VIDEO =
  "(?!\\s+(?:calls?|games?|cards?|chat|player|editor|editing|conference|meeting|stream|scripts?|ideas?|titles?|thumbnails?|descriptions?|outline|storyboard|essay|files?|codec|library|tag|element|component))";

const MAKE_VERB =
  "(?:make|create|generate|build|produce|render|design|put\\s+together|whip\\s+up|give\\s+me|i\\s+(?:want|need|would\\s+like|'d\\s+like)|(?:can|could|would)\\s+you\\s+(?:make|create|generate|build|produce|render|design))";

// The noun has to be what is being made. "Make a summary of this video" has a
// preposition between the verb and the noun, so it stops the match.
const VERB_NOUN = new RegExp(
  `\\b${MAKE_VERB}\\s+(?:(?!(?:of|from|this|that|these|those|in|on|for|to|with|about)\\b)[\\w'%-]+\\s+){0,7}${VIDEO_NOUN}\\b${NOT_A_VIDEO}`,
  "i",
);

/** "turn this into a short video", "make my notes into an animation". */
const INTO_NOUN = new RegExp(
  `\\b(?:turn|make|convert|transform)\\s+[^.!?\\n]{1,60}?\\binto\\s+(?:a|an|one)\\s+(?:[\\w'-]+\\s+){0,3}${VIDEO_NOUN}\\b${NOT_A_VIDEO}`,
  "i",
);

/** "animate the logo", "animate how a request is routed". */
const ANIMATE = /\banimate\s+(?:a|an|the|this|that|these|my|our|how|what)\b/i;

/**
 * Footage a renderer of designed graphics cannot make, tools the person named
 * themselves, and work on a video that already exists.
 */
const SOMEONE_ELSES_JOB =
  /\b(?:veo|sora|runway|kling|pika|hyperframes|openmontage|vimax|photo-?realistic|realistic|live[\s-]action|footage|text[\s-]to[\s-]video|deepfake|talking\s+head|stock\s+(?:video|clips?)|youtube\s+shorts?|subtitles?|captions?|transcri(?:be|pt|ption))\b/i;

const DISCUSSION_ONLY =
  /\b(?:what\s+(?:is|are)\b|what'?s\s+the\s+difference|which\s+(?:tool|app|library|software|model)|how\s+(?:do|can|would|should)\s+(?:i|we|you|one)\b|tell\s+me\s+about\b|pros?\s+and\s+cons?)/i;

const INTERACTIVE_REQUEST =
  /\b(?:interactive|simulat(?:e|ion)|clickable|draggable|slider|playable|three\.?js|webgl)\b/i;

const ANY_URL = /\bhttps?:\/\/\S+/gi;

/** A short follow-up to a video that was just rendered: guidance is per turn. */
const REVISION_REQUEST =
  /^(?:(?:can|could|would|will|please)\s+you\s+|please\s+|now\s+)?(?:(?:make|move|swap|change|add|remove|drop|cut|shorten|lengthen|extend|slow|speed|recolo(?:u)?r|tweak|adjust|fix|redo|rerender|re-render|simplify|try|use)\b[^.!?]{0,100}|(?:try|do)\s+(?:it|that)\s+again)[?.!]*$/i;

const SOUND_COMMAND = /\b(?:music|songs?|soundtrack|sound|audio|narrat(?:ion|e|or)|voice-?over)\b/i;

const VIDEO_CONTEXT = /\b(?:film|preview)\b[\s\S]*\b(?:render(?:ed)?|scenes?|shots?|seconds?)\b|\b(?:videos?|animations?)\b[\s\S]*\b(?:render(?:ed)?|scenes?|seconds?)\b|\b(?:render(?:ed)?|scenes?)\b[\s\S]*\b(?:videos?|animations?)\b/i;

export interface VideoIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

export function shouldAutoSelectVideo(input: VideoIntentInput): boolean {
  const text = input.text.trim();
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  // An explicit command already says what the turn is.
  if (!available || !text || text.startsWith("/")) return false;
  const prose = text.replace(ANY_URL, " ");
  if (
    SOMEONE_ELSES_JOB.test(prose) ||
    DISCUSSION_ONLY.test(prose) ||
    INTERACTIVE_REQUEST.test(prose)
  ) {
    return false;
  }
  if (VERB_NOUN.test(prose) || INTO_NOUN.test(prose) || ANIMATE.test(prose) || NAMES_MANIM.test(prose)) return true;
  const latestAssistant = [...(input.priorMessages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");
  // "use this song <link>", "quieter music", "add a voiceover" after a video
  // are orders for its soundtrack, however they are phrased.
  return (
    (REVISION_REQUEST.test(prose) || SOUND_COMMAND.test(prose)) &&
    Boolean(latestAssistant) &&
    (VIDEO_CONTEXT.test(latestAssistant!.content) || MATH_CONTEXT.test(latestAssistant!.content))
  );
}

/** The caller resolves the selection and falls back to plain text if it is unavailable. */
export function videoCommandText(
  input: VideoIntentInput,
): { text: string; automatic: boolean; skill: "film" | "video" | "math-animation" } {
  const automatic = shouldAutoSelectVideo(input);
  const latestAssistant = [...(input.priorMessages ?? [])].reverse().find((message) => message.role === "assistant");
  const prose = input.text.replace(ANY_URL, " ");
  const previous = latestAssistant?.content ?? "";
  // A subject in this message wins; otherwise the turn continues whatever the
  // last reply made.
  const skill = MATH_SUBJECT.test(prose)
    ? "math-animation"
    : WANTS_FILM.test(prose)
      ? "film"
      : MATH_CONTEXT.test(previous)
        ? "math-animation"
        : /\bfilm\b/i.test(previous)
          ? "film"
          : "video";
  return {
    text: automatic ? `/${skill} ${input.text}` : input.text,
    automatic,
    skill,
  };
}
