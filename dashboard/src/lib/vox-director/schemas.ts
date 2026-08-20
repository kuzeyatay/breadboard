// Zod schemas for every structure a language model is allowed to produce in a
// Vox Director run, plus the structural check a stored production must pass.
//
// Nothing a model returns reaches the pipeline until it has passed through this
// module. That matters more here than in a text-only agent: a beat map decides
// how many subprocesses run, an element plan decides what pixels get cropped
// out of a poster, and a duration decides how many frames Pillow draws. Every
// one of those is a number a model can get wrong, so each is bounded here
// rather than checked at the point it is used.

import { z } from "zod";
import type { VoxProduction } from "./types.ts";

export const VOX_PRODUCTION_SCHEMA_VERSION = 1;

export type SchemaResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: string[] };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): SchemaResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: `${label} did not match its schema.`,
    issues: describeIssues(result.error),
  };
}

const boundedText = (max: number) => z.string().trim().max(max);

/** The clone's hard-constrained flat-safe camera vocabulary. */
export const VOX_CAMERA_MOVES = [
  "static",
  "push_in",
  "pull_out",
  "pan",
  "tilt",
  "parallax",
  "element",
] as const;

export const VOX_SHOT_SIZES = ["EST_WIDE", "WIDE", "MEDIUM", "CLOSE", "DETAIL"] as const;

/** The narrative arcs in `vox-director/references/beat-layer.md` §1. */
export const VOX_ARCS = [
  "hook_payoff",
  "pas",
  "bab",
  "aida",
  "storybrand",
  "how_it_works",
  "timeline",
  "man_in_hole",
  "story_spine",
  "origin",
  "myth_buster",
  "listicle",
  "three_act",
  "story_circle",
] as const;

export const VOX_HOOKS = [
  "mistake_callout",
  "pain_point",
  "surprising_stat",
  "direct_question",
  "urgent_warning",
  "secret_reveal",
  "experiment_story",
  "pattern_interrupt",
  "outcome_tease",
] as const;

export const VOX_ENDINGS = ["hard_cut", "quick_cta", "loop_close"] as const;

// ---------------------------------------------------------------------------
// Stage 1 — the beat map
// ---------------------------------------------------------------------------

const shotDraftSchema = z.object({
  id: boundedText(4).default("a"),
  // Upstream's cadence rule: shots run 3-6s and never exceed ~7s, beyond which
  // the motion has nowhere to go and the poster reads as dead air.
  duration: z.number().min(1).max(9),
  shotSize: z.enum(VOX_SHOT_SIZES).catch("MEDIUM"),
  cameraMove: z.enum(VOX_CAMERA_MOVES).catch("push_in"),
  scene: boundedText(1_200).min(1),
  elementMotion: boundedText(700).default(""),
  title: z.boolean().default(false),
});

const beatDraftSchema = z.object({
  title: boundedText(60).min(1),
  narration: boundedText(700).min(1),
  background: boundedText(120).default("warm ochre"),
  feel: boundedText(120).default(""),
  hook: z.enum(VOX_HOOKS).nullish().transform((value) => value ?? null),
  shots: z.array(shotDraftSchema).min(1).max(3),
});

export const beatMapSchema = z.object({
  title: boundedText(160).min(1),
  logline: boundedText(400).default(""),
  arc: z.enum(VOX_ARCS).catch("hook_payoff"),
  ending: z.enum(VOX_ENDINGS).catch("hard_cut"),
  language: boundedText(16).default("en"),
  beats: z.array(beatDraftSchema).min(1).max(14),
});
export type BeatMapDraft = z.infer<typeof beatMapSchema>;

// ---------------------------------------------------------------------------
// Stage 2 — the look
// ---------------------------------------------------------------------------

export const styleChoiceSchema = z.object({
  /** A `styles.THEME_PRESETS` key, or "custom" when the dimensions are mixed. */
  theme: boundedText(60).min(1),
  idiom: boundedText(400).default(""),
  palette: boundedText(300).default(""),
  typeStyle: boundedText(200).default(""),
  finish: boundedText(300).default(""),
  mood: boundedText(160).default(""),
  motionStyle: z.enum(["calm", "punchy", "max"]).catch("punchy"),
  captionStyle: z.enum(["white", "paper"]).catch("white"),
  rationale: boundedText(500).default(""),
});
export type StyleChoice = z.infer<typeof styleChoiceSchema>;

// ---------------------------------------------------------------------------
// Stage 3 — the element / motion plan
// ---------------------------------------------------------------------------

/**
 * A box on the 0–1000 grid laid over the poster.
 *
 * Ordering is enforced rather than repaired: a box whose corners are the wrong
 * way round is a plan the model did not mean, and silently swapping them would
 * animate a rectangle nobody chose.
 */
const bboxSchema = z
  .tuple([
    z.number().min(0).max(1000),
    z.number().min(0).max(1000),
    z.number().min(0).max(1000),
    z.number().min(0).max(1000),
  ])
  .refine(([x0, y0, x1, y1]) => x1 - x0 >= 40 && y1 - y0 >= 40, {
    message: "each element box must be at least 40/1000 wide and tall, with x0<x1 and y0<y1",
  });

const elementSchema = z.object({
  // The name becomes a file name inside the run workspace, so it is restricted
  // to what can never escape a directory rather than sanitised after the fact.
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, "element names are letters, digits, dashes and underscores"),
  bbox: bboxSchema,
  mode: z.enum(["crop", "cutout"]).catch("crop"),
  entrance: z.enum(["fly_in", "slap", "drop", "pop_settle"]).catch("pop_settle"),
  from: z.enum(["L", "R", "T", "B"]).catch("R"),
  start: z.number().min(0).max(8).catch(0),
  spin: z.number().min(-20).max(20).catch(0),
});

export const motionPlanSchema = z.object({
  // Six pieces is where the clone's own proof act sat, and where a Pillow
  // frame loop still renders in seconds rather than minutes.
  elements: z.array(elementSchema).max(6),
  cameraZoom: z.number().min(1).max(1.3).catch(1.06),
  cameraShake: z.boolean().default(true),
  confetti: z.boolean().default(false),
  starburst: z.boolean().default(false),
});
export type MotionPlanDraft = z.infer<typeof motionPlanSchema>;

/**
 * One call plans a few posters, so the shot keys have to come back with them.
 *
 * `min(1)` is not decoration. An empty array satisfied every other rule here,
 * so a batch that answered with nothing passed validation, skipped the repair
 * it should have triggered, and quietly cost four posters their element motion.
 */
export const motionPlanBatchSchema = z.object({
  shots: z
    .array(
      z.object({
        key: boundedText(12).min(1),
        plan: motionPlanSchema,
      }),
    )
    .min(1)
    .max(28),
});
export type MotionPlanBatch = z.infer<typeof motionPlanBatchSchema>;

// ---------------------------------------------------------------------------
// The stored production
// ---------------------------------------------------------------------------

const posterRefSchema = z.object({
  artifactId: z.string().nullish().transform((value) => value ?? null),
  relativePath: z.string(),
  width: z.number(),
  height: z.number(),
  backend: z.string(),
  titleBox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .nullish()
    .transform((value) => value ?? null),
  render: z
    .object({
      prompt: z.string(),
      negativePrompt: z.string(),
      checkpoint: z.string(),
      seed: z.number(),
      steps: z.number(),
      cfg: z.number(),
      samplerName: z.string(),
      scheduler: z.string(),
      width: z.number(),
      height: z.number(),
    })
    .nullish()
    .transform((value) => value ?? null),
});

const storedMotionPlanSchema = z
  .object({
    elements: z.array(
      z.object({
        name: z.string(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        mode: z.enum(["crop", "cutout"]),
        entrance: z.enum(["fly_in", "slap", "drop", "pop_settle"]),
        from: z.enum(["L", "R", "T", "B"]),
        start: z.number(),
        spin: z.number(),
      }),
    ),
    cameraZoom: z.number(),
    cameraShake: z.boolean(),
    confetti: z.boolean(),
    starburst: z.boolean(),
  })
  .nullish()
  .transform((value) => value ?? null);

const storedShotSchema = z.object({
  id: z.string(),
  key: z.string(),
  duration: z.number(),
  shotSize: z.enum(VOX_SHOT_SIZES),
  cameraMove: z.enum(VOX_CAMERA_MOVES),
  scene: z.string(),
  elementMotion: z.string(),
  title: z.boolean(),
  imagePrompt: z.string(),
  negativePrompt: z.string(),
  poster: posterRefSchema.nullish().transform((value) => value ?? null),
  motionPlan: storedMotionPlanSchema,
  clipBackend: z
    .enum(["local", "scrapbook", "kenburns", "still"])
    .nullish()
    .transform((value) => value ?? null),
  clipRelativePath: z.string().nullish().transform((value) => value ?? null),
  clipNote: z.string().default(""),
});

const storedBeatSchema = z.object({
  id: z.number(),
  title: z.string(),
  narration: z.string(),
  background: z.string(),
  feel: z.string(),
  hook: z.string(),
  shots: z.array(storedShotSchema),
  narrationSeconds: z.number(),
  narrationRelativePath: z.string().nullish().transform((value) => value ?? null),
});

export const voxProductionSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string().min(1),
  title: z.string(),
  brief: z.string(),
  logline: z.string(),
  arc: z.string(),
  ending: z.string(),
  language: z.string(),
  duration: z.number(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  style: z.object({
    theme: z.string(),
    idiom: z.string(),
    palette: z.string(),
    typeStyle: z.string(),
    finish: z.string(),
    mood: z.string(),
    motionStyle: z.enum(["calm", "punchy", "max"]),
    rationale: z.string(),
    captionStyle: z.enum(["white", "paper"]),
  }),
  seed: z.number().nullish().transform((value) => value ?? null),
  beats: z.array(storedBeatSchema),
  renderPlan: z.object({
    imageBackend: z.string(),
    imageBackendReason: z.string().default(""),
    posterCount: z.number().int(),
    motionBackend: z.string(),
    motionBackendReason: z.string().default(""),
    narrationBackend: z.string(),
    narrationVoice: z.string().default(""),
    narrationBackendReason: z.string().default(""),
    musicSource: z.string().default("none"),
    musicReason: z.string().default(""),
    video: z
      .object({
        artifactId: z.string().nullish().transform((value) => value ?? null),
        relativePath: z.string(),
        filename: z.string(),
        durationSeconds: z.number(),
        width: z.number(),
        height: z.number(),
        shotCount: z.number().int(),
        sizeBytes: z.number(),
      })
      .nullish()
      .transform((value) => value ?? null),
    videoReason: z.string().default(""),
  }),
  runId: z.string(),
  revisions: z.array(z.string()).default([]),
  createdAt: z.string(),
});

/**
 * Structural check for a stored production, run when one is read back out of
 * artifact storage. A malformed production would open as a film that still
 * looked authoritative, so it is verified rather than trusted.
 */
export function parseStoredProduction(value: unknown): SchemaResult<VoxProduction> {
  const result = parseWithSchema(
    voxProductionSchema,
    value,
    "The stored Vox Director production",
  );
  if (!result.ok) return result;
  if (result.value.schemaVersion !== VOX_PRODUCTION_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported production schema version ${result.value.schemaVersion}.`,
      issues: [`expected ${VOX_PRODUCTION_SCHEMA_VERSION}`],
    };
  }
  return { ok: true, value: result.value as unknown as VoxProduction };
}
