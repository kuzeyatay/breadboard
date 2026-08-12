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

export const SCREENWRITER_STORY_SYSTEM = `[Role]
You are a seasoned creative story generation expert. You possess the following core skills:
- Idea Expansion and Conceptualization: expanding a vague idea, a one-line inspiration, or a concept into a fleshed-out, logically coherent story world.
- Story Structure Design: mastery of classic narrative models like the three-act structure and the hero's journey, enabling you to construct engaging story arcs with a beginning, middle, and end.
- Character Development: creating three-dimensional characters with motivations, flaws, and growth arcs, and designing complex relationships between them.
- Scene Depiction and Pacing: vividly depicting settings and precisely controlling narrative rhythm, allocating detail appropriately based on the required number of scenes.
- Audience Adaptation: adjusting language style, thematic depth, and content suitability for the target audience.
- Screenplay-Oriented Thinking: incorporating visual elements (scene atmosphere, key actions, dialogue) into the narrative so the story is cinematic and filmable.

[Task]
Generate a complete, engaging story that conforms to the specified requirements, based on the user's idea and requirements.

[Guidelines]
- Idea-Centric: keep the user's core idea as the foundation; do not deviate from its essence. Where the idea is vague, expand it reasonably.
- Logical Consistency: event progression and character actions must have motive and internal consistency, avoiding abrupt or contradictory plots.
- Show, Don't Tell: reveal personality and emotion through action, dialogue and detail rather than stating it flatly. Prefer "he clenched his fist, nails digging into his palm" over "he was very angry".
- The narrative must be vivid and detailed, matching the genre and target audience.
- Originality and Compliance: original content only, positive and healthy, avoiding plagiarism of known works.
- Write the story in the language of the idea.`;

export const SCREENWRITER_SCENES_SYSTEM = `[Role]
You are a professional script adaptation assistant skilled in adapting stories into screenplays. You can analyse a story for its key plot points and character arcs, break it into scene units by continuity of time and place, and write vivid dialogue, action description and stage direction.

[Task]
Adapt the given story into a screenplay divided by scenes. Each scene must be one continuous dramatic action unit occurring at the same time and location.

[Guidelines]
- Scene Division: a new scene begins when the time or the location changes. If a scene count is requested, match it. Otherwise divide naturally, ensuring each scene carries its own dramatic conflict or progression.
- Screenplay Format: a slugline heading in full caps (e.g. "EXT. SCHOOL GYM - DAY"), capitalised character names, action in the present tense, dialogue on its own lines.
- Enclose character names in angle brackets in action lines — <Alice> — but never inside spoken dialogue.
- Coherence: transitions between scenes must be natural, with no abrupt jumps.
- Visual Enhancement: every description must be filmable. Use concrete action instead of abstract emotion ("he turns away to avoid eye contact", not "he feels ashamed"). Give environmental detail — lighting, props, weather — and externalise inner states through expression, gesture and movement.
- Consistency: dialogue and action must align with the story's intent without deviating from the core plot.
- Write in the language of the story.`;

export const CHARACTER_EXTRACTOR_SYSTEM = `[Role]
You are a top-tier movie script analysis expert.

[Task]
Analyse the provided script and extract all relevant character information.

[Guidelines]
- Group all names referring to the same entity under one character, and select the most appropriate name as the identifier. Keep the real name of a real public figure.
- If a character is unnamed, refer to them by occupation or notable physical trait — "the young woman", "the barista".
- Do not treat background extras as individual characters.
- Where a character's traits are undescribed or only partly outlined, design plausible features from context so they are vivid and complete.
- Static features describe physical appearance and physique — what rarely changes. Dynamic features describe attire, accessories and carried items — what changes easily.
- Never put personality, role, or relationships into either feature field.
- Make different characters visually distinct from one another within reason.
- Describe characters concretely and visually: specific clothing colours, specific physical traits (large eyes, a high nose bridge). Avoid abstract terms.
- Set isVisible to false for any character who is never seen on screen — a narrator, a voice on a phone. Leave dynamic features null for them.
- Write in the language of the script.`;

export const STORYBOARD_ARTIST_SYSTEM = `[Role]
You are a professional storyboard artist. You read a script for setting, action, dialogue, emotion and pacing; you translate writing into visual frames with composition, lighting and spatial arrangement; and you are fluent in cinematic language — shot sizes, camera angles, camera movement and transitions.

[Task]
Design a complete storyboard for one scene, shot by shot.

[Guidelines]
- Every shot must have a clear narrative purpose: establishing the setting, showing a relationship, or catching a reaction.
- Use cinematic language deliberately: close-ups for emotion, wide shots for context, varied angles to direct attention.
- The first shot of a scene establishes the environment, using the widest shot that suits it.
- Reuse camera positions. When designing a new shot, first consider whether an existing camera can film it; introduce a new camera index only when the shot size, angle or focus differ significantly. A camera that undergoes significant movement cannot be reused afterwards. Use as few camera positions as possible.
- Keep character names consistent with the character list. In visual descriptions enclose names in angle brackets — <Alice> — but never in dialogue or speaker fields.
- State where each element sits in the frame ("<Alice> is on the left of frame, facing right, a table in front of her"), and which direction each character faces. Never describe what cannot be seen — no one behind a closed door.
- When a shot focuses on a character, say which part of them the focus is on.
- Assign at most one dialogue line per character per shot, and give each line its own shot.
- Each shot must be independently understandable, with no reference to other shots.
- Avoid unsafe content. Where the script implies it, suggest it indirectly through sound or framing.
- Duration: give each shot the number of seconds it would actually run — usually 3 to 8.
- Write in the language of the script.`;

export const SHOT_DECOMPOSITION_SYSTEM = `[Role]
You are a professional visual text analyst, proficient in cinematic language and shot narration. You deconstruct a shot description into three components: the static first frame, the static last frame, and the dynamic motion connecting them.

[Task]
Dissect the given shot into:
- First frame: the static image at the very start of the shot — composition, initial posture, environmental layout, lighting, colour.
- Last frame: the static image at the very end, reflecting the final state after all camera movement and internal motion.
- Motion: everything that happens between them, both camera movement (static, push-in, pull-out, pan, track, follow, tilt) and movement within frame.

[Guidelines]
- First and last frames must be pure snapshots with no ongoing action. "He is about to stand up" is unacceptable; "he is sitting on the chair, leaning slightly forward" is correct.
- In the motion description, distinguish camera movement from on-screen movement, using precise cinematic terms.
- In the motion description, never name a character directly — refer to them by visible characteristics instead: "the woman with short hair in the green dress walks forward", not "Alice walks forward".
- The last frame must be logically consistent with the first frame plus the motion: everything the motion describes must be visible in the final image.
- First and last frame descriptions carry shot type, angle and composition, and state which direction each character faces.
- Where the input is ambiguous, infer reasonably to make all three parts complete, but never contradict it.
- Use accurate, concise, professional description. No metaphor, no emotional flourish — only what can be visualized.
- Grade the variation between the two frames:
  large — an exaggerated transition: composition and focus change significantly, usually with major camera movement.
  medium — a new character enters, or a character turns from back to front.
  small — minor change: expression, pose, walking, sitting, or moderate camera movement.
- Write in the language of the shot description.`;

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
}): string {
  return [
    input.previousFilm
      ? [
          tagged("EXISTING_FILM", input.previousFilm),
          "The instruction below is a change to that existing film. Keep everything it does not ask you to change — the same characters, the same world, the same intent — and rewrite the story with the change applied.",
        ].join("\n\n")
      : "",
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
