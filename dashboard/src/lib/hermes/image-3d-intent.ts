// When a turn about an attached picture should select the Image to 3D skill on
// its own.
//
// The skill's tool is gated on the skill being selected for the turn, and
// typing `/image-to-3d` is the wrong burden for the only sentence anyone
// actually writes: "convert this to 3D" with a picture attached. Nothing in
// that sentence names a skill, and without one the model has a picture it can
// describe and no way to reconstruct it — so it explains how the person could
// do it themselves, which is the failure this module exists to prevent.
//
// The rule is narrower than Watch's. An attached video is almost always the
// subject of the turn, but an attached picture usually is not: people paste
// screenshots to ask what is wrong with them. So a picture alone never selects
// this skill. The request has to actually ask for a three-dimensional thing.

import type { HermesSurface } from "./config.ts";

/** The first-party skill directory name, which is also its slash command. */
export const IMAGE_TO_3D_SKILL = "image-to-3d";

/**
 * The vocabulary of wanting an object rather than a picture. "3d" alone is not
 * enough — "3D printer", "3D movie" and "3D chart" are all ordinary chat — so a
 * bare dimension word has to sit next to a making verb or a subject noun.
 */
const MAKE_VERB =
  "(?:make|turn|convert|generate|create|build|reconstruct|produce|render|model|extrude|print|export|give\\s+me|i\\s+want|can\\s+you\\s+(?:make|turn|create|generate))";
const OBJECT_NOUN =
  "(?:3-?d(?:\\s+(?:model|mesh|object|asset|file|print|printable|scan|version|render))?|three-?dimensional|mesh|glb|gltf|obj\\s+file|stl|voxel|game\\s+asset|3-?d\\s+printable)";

/**
 * Asking for a 3D thing. Four shapes, because the same request is written all
 * four ways and missing one costs the whole turn:
 *
 *   "convert this image to 3d"     verb … noun
 *   "3d model of this please"      noun-first
 *   "can I get a mesh from this"   possession
 *   "/image-to-3d"                 handled by the caller, never here
 */
const RECONSTRUCT_REQUEST = new RegExp(
  [
    `\\b${MAKE_VERB}\\b[^.!?]{0,60}\\b${OBJECT_NOUN}\\b`,
    `\\b${OBJECT_NOUN}\\b[^.!?]{0,40}\\b(?:of|from|out\\s+of|based\\s+on)\\b`,
    `\\b(?:get|need|want|have)\\b[^.!?]{0,30}\\b${OBJECT_NOUN}\\b`,
    `^\\s*${OBJECT_NOUN}\\s*[.!?]?\\s*$`,
  ].join("|"),
  "i",
);

/**
 * Talking *about* 3D rather than asking for one. These are the phrases that
 * would otherwise turn a conversation into a five-minute GPU job: someone
 * asking how the feature works, or naming a 3D thing in passing.
 */
const DISCUSSION_ONLY =
  /\b(?:how\s+(?:do|does|would|can)\s+(?:i|you|it)\b|what\s+is\b|what'?s\s+the\s+difference|explain|compare|why\s+(?:do|does|is)\b|is\s+it\s+possible|tell\s+me\s+about|3-?d\s+(?:printer|printing\s+(?:service|business)|movie|film|glasses|chart|graph|plot|secure|touch))/i;

/** A link is not prose; it is stripped before any test so a URL cannot match one. */
const ANY_URL = /\bhttps?:\/\/\S+/gi;

export interface ImageTo3dIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  /** A reconstructable picture came with this message. */
  hasImageAttachment: boolean;
  /** A reconstructable picture came with an earlier message in this conversation. */
  hasRecentImageAttachment?: boolean;
}

/**
 * Whether the runtime is actually installed is not decided here. The caller
 * resolves the selection and falls back to the plain text when the skill turns
 * out to be unavailable — the same answer this module would give, and one fewer
 * place that has to know what Stable Fast 3D needs to run.
 */
export function imageTo3dCommandText(
  input: ImageTo3dIntentInput,
): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const prose = text.replace(ANY_URL, " ");
  const available =
    input.authenticated &&
    // Both conversational surfaces: unlike Watch, nothing here needs a
    // workspace — the picture is in the transcript and the mesh becomes an
    // artifact. Quartz is excluded because it is the public frontend.
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  // An explicit command already says what the turn is; never argue with it.
  const eligible = available && !text.startsWith("/");
  const automatic =
    eligible &&
    (input.hasImageAttachment || input.hasRecentImageAttachment === true) &&
    RECONSTRUCT_REQUEST.test(prose) &&
    !DISCUSSION_ONLY.test(prose);
  return {
    text: automatic ? `/${IMAGE_TO_3D_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
