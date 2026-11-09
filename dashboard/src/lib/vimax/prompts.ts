// The ViMax crew, as prompts.
//
// Ported from the cloned ViMax repository (HKUDS/ViMax, MIT) — `agents/
// screenwriter.py`, `agents/character_extractor.py`, `agents/storyboard_artist.py`.
// The role framing and the craft rules are kept close to the originals on
// purpose: they are the part of ViMax that makes a film hold together — the
// separation of static from dynamic character features, the insistence on
// filmable description, camera reuse, and the decomposition of a shot into a
// first frame, a motion, and a last frame.
//
// What changed is the transport, not the method. Upstream asks langchain for a
// pydantic parse; here each stage is a forced tool call whose arguments are
// validated by `schemas.ts`, so the format instructions the originals inject
// are supplied by the tool schema instead of by prose.

import { PROMPT_FILM_STORY as SCREENWRITER_STORY_SYSTEM } from "../system-prompts/feature-defaults.ts";
export { SCREENWRITER_STORY_SYSTEM };

import { PROMPT_FILM_SCENES as SCREENWRITER_SCENES_SYSTEM } from "../system-prompts/feature-defaults.ts";
export { SCREENWRITER_SCENES_SYSTEM };

import { PROMPT_FILM_CHARACTERS as CHARACTER_EXTRACTOR_SYSTEM } from "../system-prompts/feature-defaults.ts";
export { CHARACTER_EXTRACTOR_SYSTEM };

import { PROMPT_FILM_STORYBOARD as STORYBOARD_ARTIST_SYSTEM } from "../system-prompts/feature-defaults.ts";
export { STORYBOARD_ARTIST_SYSTEM };

import { PROMPT_FILM_SHOTS as SHOT_DECOMPOSITION_SYSTEM } from "../system-prompts/feature-defaults.ts";
export { SHOT_DECOMPOSITION_SYSTEM };

/** Character list rendered the way ViMax renders `CharacterInScene.__str__`. */
export function charactersBlock(
  characters: Array<{
    idx: number;
    identifier: string;
    isVisible: boolean;
    staticFeatures: string;
    dynamicFeatures: string | null;
  }>,
): string {
  if (characters.length === 0) return "(no characters identified yet)";
  return characters
    .map((character) =>
      [
        `${character.idx}. ${character.identifier}${character.isVisible ? "[visible]" : "[not visible]"}`,
        `static features: ${character.staticFeatures || "-"}`,
        `dynamic features: ${character.dynamicFeatures || "-"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function tagged(tag: string, value: string): string {
  return `<${tag}>\n${value.trim()}\n</${tag}>`;
}

/**
 * `previousFilm` turns a second prompt in the same conversation into a genuine
 * revision. The run forks the existing artifact either way, so the screenwriter
 * has to be shown what is being revised — otherwise a follow-up would write an
 * unrelated story and store it as the next version of the old film.
 */
export function storyUserPrompt(input: {
  idea: string;
  userRequirement: string;
  previousFilm?: string;
  /**
   * The chat the brief was written in. Its own tagged section rather than
   * part of <IDEA>: an earlier message explains what the idea refers to, and
   * a transcript folded into the idea would become the subject of the film.
   */
  conversation?: string;
}): string {
  return [
    input.previousFilm
      ? [
          tagged("EXISTING_FILM", input.previousFilm),
          "The instruction below is a change to that existing film. Keep everything it does not ask you to change — the same characters, the same world, the same intent — and rewrite the story with the change applied.",
        ].join("\n\n")
      : "",
    input.conversation ? tagged("CONVERSATION_SO_FAR", input.conversation) : "",
    tagged("IDEA", input.idea),
    tagged("USER_REQUIREMENT", input.userRequirement || "(none)"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function scenesUserPrompt(input: { story: string; userRequirement: string }): string {
  return [
    tagged("STORY", input.story),
    tagged("USER_REQUIREMENT", input.userRequirement || "(none)"),
  ].join("\n\n");
}

export function charactersUserPrompt(script: string): string {
  return tagged("SCRIPT", script);
}

export function storyboardUserPrompt(input: {
  script: string;
  charactersText: string;
  userRequirement: string;
}): string {
  return [
    tagged("SCRIPT", input.script),
    tagged("CHARACTERS", input.charactersText),
    tagged("USER_REQUIREMENT", input.userRequirement || "(none)"),
  ].join("\n\n");
}

export function decompositionUserPrompt(input: {
  visualDescription: string;
  charactersText: string;
}): string {
  return [
    tagged("VISUAL_DESC", input.visualDescription),
    tagged("CHARACTERS", input.charactersText),
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Image prompts
// ---------------------------------------------------------------------------

/**
 * A character reference portrait. ViMax generates these first and feeds them
 * back as reference images so a face survives from shot to shot; the same
 * reasoning holds here, where the portrait is what the storyboard frames are
 * drawn against.
 */
export function portraitPrompt(input: {
  character: { identifier: string; staticFeatures: string; dynamicFeatures: string | null };
  style: string;
}): string {
  return [
    `Character reference sheet for "${input.character.identifier}", drawn in ${input.style} style.`,
    "A single full-body figure, front-facing, standing in a neutral pose against a plain uncluttered backdrop, evenly lit, no text and no labels.",
    `Appearance: ${input.character.staticFeatures}`,
    input.character.dynamicFeatures ? `Wearing: ${input.character.dynamicFeatures}` : "",
    "The face and build must be specific and memorable enough to redraw consistently in later frames.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A storyboard frame, drawn from the shot's first-frame description. */
export function framePrompt(input: {
  frameDescription: string;
  sceneHeading: string;
  atmosphere: string;
  style: string;
  aspectRatio: string;
  characters: Array<{ identifier: string; staticFeatures: string; dynamicFeatures: string | null }>;
}): string {
  const cast = input.characters.length
    ? input.characters
        .map(
          (character) =>
            `- ${character.identifier}: ${character.staticFeatures}${
              character.dynamicFeatures ? `; wearing ${character.dynamicFeatures}` : ""
            }`,
        )
        .join("\n")
    : "";
  return [
    `Storyboard frame in ${input.style} style, ${input.aspectRatio} aspect ratio, cinematic composition, no text, no watermarks, no letterboxing.`,
    `Setting: ${input.sceneHeading}${input.atmosphere ? ` — ${input.atmosphere}` : ""}`,
    cast ? `Characters that must match their descriptions exactly:\n${cast}` : "",
    `Frame: ${input.frameDescription}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The prompt a video generator would receive for this shot. ViMax renders a
 * shot by animating from its first frame along the motion description, so this
 * is assembled even when no video backend is configured: it is what makes the
 * stored production renderable later, by upstream ViMax or anything else.
 */
export function videoPromptForShot(input: {
  motion: string;
  firstFrameDescription: string;
  lastFrameDescription: string;
  audioDescription: string;
  style: string;
  durationSeconds: number;
}): string {
  return [
    `${input.style} style, ${Math.round(input.durationSeconds)} seconds.`,
    `Start frame: ${input.firstFrameDescription}`,
    `Motion: ${input.motion}`,
    input.lastFrameDescription ? `End frame: ${input.lastFrameDescription}` : "",
    input.audioDescription ? `Audio: ${input.audioDescription}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
