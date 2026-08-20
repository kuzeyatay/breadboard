// What the model is told at each stage of a Vox Director run.
//
// The craft in these prompts is not written here. It is read out of the clone,
// at run time, from the two reference files upstream maintains:
//
//   references/beat-layer.md   the STORY layer — narrative arcs, hook and
//                              pacing rules, shot sizes, the flat-safe camera
//                              vocabulary, the anti-monotony rule
//   references/prompt-guide.md the LOOK layer — the five-part image prompt
//                              structure, the vocabulary that fills it, and the
//                              common Vox constraints
//
// Restating them in TypeScript would have been shorter and would have started
// rotting the day the clone was next pulled. `docs/HYPERFRAMES_INTEGRATION.md`
// makes the same choice for the same reason: the video knowledge stays where
// upstream put it, and updating the clone updates the agent.

import fs from "node:fs";
import { referenceFile } from "./runtime.ts";
import { beatCountForDuration } from "./identity.ts";
import type { VoxDirectorRequest } from "./identity.ts";
import type { VoxProduction, VoxShot, VoxStyle } from "./types.ts";

const MAX_SECTION_CHARS = 7_000;
const cache = new Map<string, string>();

function readReference(root: string, file: string): string {
  const key = `${root}::${file}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let text = "";
  try {
    text = fs.readFileSync(referenceFile(root, file), "utf8");
  } catch {
    text = "";
  }
  cache.set(key, text);
  return text;
}

/** For tests and for a clone that has just been updated underneath a server. */
export function clearReferenceCache(): void {
  cache.clear();
}

/**
 * One `## …` section of a reference file, trimmed to a budget.
 *
 * Whole files would be better craft and worse economics: `prompt-guide.md` is
 * 20 KB and only two of its five sections decide anything at planning time.
 * A section that cannot be found returns empty rather than the whole file, so a
 * renamed heading costs one weaker prompt instead of a 20 KB one.
 */
export function referenceSection(root: string, file: string, heading: RegExp): string {
  const text = readReference(root, file);
  if (!text) return "";
  const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line));
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^##\s/.test(lines[index])) break;
    body.push(lines[index]);
  }
  const joined = body.join("\n").trim();
  return joined.length > MAX_SECTION_CHARS
    ? `${joined.slice(0, MAX_SECTION_CHARS).trimEnd()}\n[…]`
    : joined;
}

function tagged(tag: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `<${tag}>\n${trimmed}\n</${tag}>` : "";
}

function join(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && String(part).trim())).join("\n\n");
}

// ---------------------------------------------------------------------------
// Stage 1 — the beat map
// ---------------------------------------------------------------------------

export const BEAT_MAP_SYSTEM = [
  "You are the Vox Director's story editor. You turn one topic into the beat map for a",
  "short narration-driven editorial explainer, told as a sequence of paper-collage posters",
  "that come alive.",
  "",
  "You are not writing a film with characters, scenes or dialogue. You are writing an",
  "argument: a narrator carries one idea, and each beat is one poster that makes one",
  "point. Narration is what a person says out loud, so it is plain spoken English with no",
  "stage directions, no speaker labels and no markdown.",
  "",
  "Two rules override everything else. The headline on beat one has to earn the next three",
  "seconds on its own. And nothing is set up that is not then paid off.",
].join("\n");

export function beatMapUserPrompt(input: {
  request: VoxDirectorRequest;
  cloneRoot: string;
  conversation?: string;
  previousProduction?: string;
}): string {
  const { request } = input;
  const beats = beatCountForDuration(request.duration);
  // The narrator's pace, from the clone's own table: ~75 words for 30 seconds.
  const words = Math.round(request.duration * 2.4);

  return join([
    input.conversation ? tagged("CONVERSATION_SO_FAR", input.conversation) : "",
    tagged("TOPIC", request.brief),
    input.previousProduction ? tagged("THE_FILM_YOU_ARE_REVISING", input.previousProduction) : "",
    tagged(
      "STORY_LAYER_FROM_THE_SKILL",
      [
        referenceSection(input.cloneRoot, "beat-layer.md", /Narrative Arc Library/i),
        referenceSection(input.cloneRoot, "beat-layer.md", /Hook · Pacing · Beat-count|Hook .* Pacing/i),
        referenceSection(input.cloneRoot, "beat-layer.md", /Shot-Pattern Library/i),
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    [
      "Write the beat map for this topic.",
      "",
      `- Target runtime: about ${request.duration} seconds, which is roughly ${words} words of narration in total.`,
      `- Plan ${beats.min} to ${beats.max} beats. Every beat is one poster idea and one sentence or two of narration.`,
      "- Give each beat two shots when its narration runs past about four seconds: a wide establishing shot that carries the headline, then a detail cut-in that does not. The narration plays across both; only the picture cuts. A beat whose narration is short takes one shot.",
      "- No shot runs longer than seven seconds, and the shots of one beat must add up to about the time its narration needs.",
      "- Pick the arc that fits the topic, using the heuristic in the story layer above.",
      "- Beat one is the hook and its headline must land in under three seconds. Never spend beat one on setup.",
      "- Headlines are two or three words, in capitals, and they are baked into the poster, so they must be short enough to read at a glance.",
      "- Vary `cameraMove` between adjacent beats, alternating families (scale, translate, static), and save `static` for the payoff beat. Every shot's move must come from the flat-safe vocabulary above and nothing else.",
      "- `elementMotion` is where the energy is. Write what actually moves in that scene — several things at once — as rigid paper: cut-outs slide, flap, scatter, pop. Never melting, morphing or warping. A hero element flying across the frame is a punch for one key beat, not for every shot.",
      "- `scene` describes the poster as separate cut-out pieces with clear edges, because that is what makes it a collage rather than a painting.",
      "- `background` is one bold flat paper colour for the beat, named in plain words.",
      request.style
        ? `- The look has already been asked for: "${request.style}". Write scenes that suit it.`
        : "",
      "",
      "Do not ask any questions. Nobody is there to answer them; decide and commit.",
    ]
      .filter(Boolean)
      .join("\n"),
  ]);
}

// ---------------------------------------------------------------------------
// Stage 2 — the look
// ---------------------------------------------------------------------------

export const STYLE_SYSTEM = [
  "You are the Vox Director's art director. You choose the visual idiom one film is made",
  "in, from the skill's own theme library or by composing one out of its dimensions.",
  "",
  "Match the topic, not the language. An English film about Chinese history should still",
  "look Chinese. One house style used for every topic is the failure mode this stage",
  "exists to prevent.",
].join("\n");

export function styleUserPrompt(input: {
  request: VoxDirectorRequest;
  title: string;
  arc: string;
  beatSummary: string;
  cloneRoot: string;
  themes: Record<string, Record<string, string>>;
}): string {
  const themeLines = Object.entries(input.themes).map(
    ([name, preset]) =>
      `- ${name}: ${preset.idiom ?? ""} · palette ${preset.palette ?? ""} · type ${
        preset.type_style ?? ""
      } · finish ${preset.finish ?? ""} · mood ${preset.mood ?? ""} · motion ${
        preset.motion_style ?? ""
      }`,
  );

  return join([
    tagged("TOPIC", input.request.brief),
    tagged("FILM", `Title: ${input.title}\nArc: ${input.arc}\n\n${input.beatSummary}`),
    tagged("THEME_PRESETS_FROM_THE_SKILL", themeLines.join("\n")),
    tagged(
      "LOOK_LAYER_FROM_THE_SKILL",
      referenceSection(input.cloneRoot, "prompt-guide.md", /Image prompt/i),
    ),
    [
      "Choose the look.",
      "",
      "- Prefer a named preset when one fits the topic's era, culture and tone. Return its exact name as `theme`, and copy its idiom, palette, type style, finish and mood into the other fields.",
      "- If none fits, set `theme` to \"custom\" and compose one by picking a term from each dimension in the look layer above. A custom theme must still name a real medium, a real type style and a limited palette.",
      "- `motionStyle` is the amplitude the whole film moves at: calm, punchy, or max.",
      "- `captionStyle` is \"white\" for a clean subtitle, or \"paper\" for cut-out paper letters. Use \"paper\" only when the film is playful enough to carry it.",
      "- `rationale` is one sentence on why this look suits this topic. It is shown to the person who asked.",
      input.request.style
        ? `\nThe person asked for: "${input.request.style}". Honour it — either as the preset name if it is one, or as the idiom of a custom theme.`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ]);
}

// ---------------------------------------------------------------------------
// Stage 3 — the element / motion plan
// ---------------------------------------------------------------------------

export const MOTION_SYSTEM = [
  "You are the Vox Director's motion designer. You decide which pieces of each finished",
  "poster get cut out and animated, where they come from, and when they land.",
  "",
  "The engine that renders this is local and literal: every piece you name is cut from the",
  "poster at the box you give, and flown back to the exact place it was cut from, over a",
  "blurred copy of the poster. So the assembled frame reconstructs the original poster —",
  "which is the whole trick. A box in the wrong place animates a rectangle of background.",
  "",
  "Boxes are on a 0-1000 grid laid over the poster: [x0, y0, x1, y1], left, top, right,",
  "bottom, with x0 < x1 and y0 < y1. 0,0 is the top-left corner.",
].join("\n");

export function motionUserPrompt(input: {
  cloneRoot: string;
  style: VoxStyle;
  /**
   * What the posters really are. A generated collage has a subject to cut out;
   * a title card is a flat graphic with a headline, a torn band and scattered
   * paper shapes, and planning six figure cut-outs over one only animates
   * rectangles of background.
   */
  posterKind: "collage" | "title-card";
  shots: Array<{ key: string; duration: number; scene: string; elementMotion: string; title: string; hasTitle: boolean; cameraMove: string }>;
}): string {
  const shotLines = input.shots.map((shot) =>
    [
      `### shot ${shot.key} — ${shot.duration.toFixed(1)}s, camera ${shot.cameraMove}`,
      shot.hasTitle
        ? `The headline "${shot.title}" is baked across the upper third of this poster.`
        : "This is a detail cut-in. It carries no headline.",
      `Poster: ${shot.scene}`,
      shot.elementMotion ? `Planned motion: ${shot.elementMotion}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return join([
    tagged("FILM_LOOK", `${input.style.theme} — ${input.style.idiom}. Motion amplitude: ${input.style.motionStyle}.`),
    tagged(
      "LOCAL_ENGINE_FROM_THE_SKILL",
      referenceSection(input.cloneRoot, "local-engine.md", /Two stages/i) ||
        referenceSection(input.cloneRoot, "local-engine.md", /./),
    ),
    tagged(
      "THE_POSTERS_YOU_ARE_PLANNING_OVER",
      input.posterKind === "collage"
        ? "Each poster is a generated paper collage: layered cut-out figures and props with torn edges, over one bold flat background colour, with the headline baked across the upper third."
        : "Each poster is a flat graphic title card, not a generated collage: one bold flat background, a torn paper band across the upper third, the headline over that band, and a few scattered paper shapes in the lower half. There are no figures to cut out, so plan the headline and at most one band or shape that is really there.",
    ),
    tagged("SHOTS", shotLines.join("\n\n")),
    [
      "Plan the pieces for every shot listed, keyed by the shot key exactly as given.",
      "",
      input.posterKind === "collage"
        ? "- Two to four pieces per shot. Six is the ceiling and it is rarely the right answer: a poster whose every region is flying reads as noise."
        : "- One or two pieces per shot on these cards: the headline, and at most one band or shape that is really there. A third piece would be a rectangle of empty background.",
      "- On a shot with a headline, the headline is almost always one of the pieces. Put its box around the upper third where the words sit — roughly [60, 40, 940, 400] on the grid — and bring it in with `slap`, which is the paper snap.",
      "- The other pieces are the subjects and props the poster description names. Place each box where that thing would sit in the composition you were given.",
      "- `mode` is `crop` for text blocks, bands and strips, and `cutout` for a figure or object that should fly with its own silhouette. Cutout only works on a piece sitting on flat colour; a piece over a busy area should be `crop`.",
      "- `entrance`: `fly_in` travels from off-screen, `slap` snaps in place from oversize, `drop` bounces down, `pop_settle` focuses in place. Vary them within a shot.",
      "- `start` is seconds into this shot. Stagger them — the first around 0.15s, the rest a few tenths apart — and leave at least a second of the shot after the last piece has landed.",
      "- `cameraZoom` is a slow push over the shot: 1.0 holds still, 1.06 is a gentle push, 1.2 is strong. Match it to the camera move you were given, and keep it at 1.0 for a static payoff.",
      "- `confetti` is drifting paper scraps over the whole shot. Use it on energetic beats, not on every one.",
      "- `starburst` is a rotating paper burst behind everything. At most one shot in the film gets it.",
      "",
      "Name each piece after the thing it actually is in that poster — the subject, the prop, the strip of type — in one lower-case word. `headline` is the one fixed name, for the baked headline. No paths, no spaces, no punctuation.",
    ].join("\n"),
  ]);
}

// ---------------------------------------------------------------------------
// Reading a stored film back, so a follow-up revises it
// ---------------------------------------------------------------------------

export function summariseProductionForModel(production: VoxProduction): string {
  const beats = production.beats
    .map(
      (beat) =>
        `${beat.id}. "${beat.title}" — ${beat.narration}`,
    )
    .join("\n");
  return [
    `Title: ${production.title}`,
    `Logline: ${production.logline}`,
    `Arc: ${production.arc}, ending ${production.ending}`,
    `Look: ${production.style.theme} — ${production.style.idiom}`,
    `Runtime: about ${Math.round(production.duration)}s in ${production.beats.length} beats`,
    "",
    beats,
  ].join("\n");
}

/** The beat map as the art director and the motion designer need to read it. */
export function summariseBeatsForModel(
  beats: Array<{ id: number; title: string; narration: string; background: string; shots: VoxShot[] }>,
): string {
  return beats
    .map((beat) =>
      [
        `${beat.id}. "${beat.title}" (${beat.background}) — ${beat.narration}`,
        ...beat.shots.map((shot) => `   ${shot.key}: ${shot.shotSize} ${shot.cameraMove} — ${shot.scene}`),
      ].join("\n"),
    )
    .join("\n");
}
