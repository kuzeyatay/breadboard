// Zod schemas for every structure a language model is allowed to produce in a
// ViMax run, plus the structural check a stored production must pass.
//
// ViMax's own pipeline validates each stage's output against a pydantic model
// before the next stage consumes it (`utils/robust_json_parser.py` wraps the
// parser precisely because models drift). The same rule holds here: nothing a
// model returns reaches the production until it has passed through this module,
// and a stored production is verified on the way back out of the artifact store
// rather than assumed to be well formed.

import { z } from "zod";
import { VIMAX_PRODUCTION_SCHEMA_VERSION } from "./types.ts";
import type { VimaxProduction } from "./types.ts";

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

// ---------------------------------------------------------------------------
// Stage outputs
// ---------------------------------------------------------------------------

/** Screenwriter, stage 1: the developed story. */
export const storySchema = z.object({
  title: boundedText(160).min(1),
  logline: boundedText(600).default(""),
  story: boundedText(24_000).min(1),
  /** The style the director settled on when the brief did not name one. */
  style: boundedText(120).default(""),
});
export type StoryDraft = z.infer<typeof storySchema>;

/** Script2Video: naming a screenplay the user supplied rather than writing one. */
export const scriptDescriptionSchema = z.object({
  title: boundedText(160).min(1),
  logline: boundedText(600).default(""),
  style: boundedText(120).default(""),
});
export type ScriptDescription = z.infer<typeof scriptDescriptionSchema>;

/** Screenwriter, stage 2: the story cut into scenes. */
export const sceneListSchema = z.object({
  scenes: z
    .array(
      z.object({
        heading: boundedText(200).default(""),
        location: boundedText(200).default(""),
        timeOfDay: boundedText(80).default(""),
        atmosphere: boundedText(600).default(""),
        script: boundedText(12_000).min(1),
      }),
    )
    .min(1)
    .max(12),
});
export type SceneList = z.infer<typeof sceneListSchema>;

/**
 * Character extractor. `isVisible` matters more than it looks: ViMax learned
 * that asking an image model for portraits of a narrator or a voice on a phone
 * fails repeatedly, so an invisible character is never drawn.
 */
export const characterListSchema = z.object({
  characters: z
    .array(
      z.object({
        identifier: boundedText(120).min(1),
        isVisible: z.boolean().default(true),
        staticFeatures: boundedText(2_000).default(""),
        dynamicFeatures: boundedText(2_000).nullish().transform((value) => value ?? null),
      }),
    )
    .max(24)
    .default([]),
});
export type CharacterList = z.infer<typeof characterListSchema>;

/** Storyboard artist: one scene's shots, before frame decomposition. */
export const storyboardSchema = z.object({
  shots: z
    .array(
      z.object({
        camIdx: z.number().int().min(0).max(64).catch(0),
        visualDescription: boundedText(4_000).min(1),
        audioDescription: boundedText(2_000).default(""),
        durationSeconds: z.number().min(1).max(20).catch(5),
        dialogue: z
          .array(
            z.object({
              speaker: boundedText(120).default(""),
              line: boundedText(1_200).default(""),
              emotion: boundedText(80).default(""),
            }),
          )
          .max(6)
          .default([]),
        narration: boundedText(1_200).nullish().transform((value) => value ?? null),
      }),
    )
    .min(1)
    .max(16),
});
export type Storyboard = z.infer<typeof storyboardSchema>;

/**
 * Visual decomposition: a shot split into its first frame, its motion and its
 * last frame. This is the seam a video model renders across, and the reason a
 * production stays renderable by upstream ViMax later.
 */
export const shotDecompositionSchema = z.object({
  firstFrameDescription: boundedText(4_000).min(1),
  firstFrameCharacterIdxs: z.array(z.number().int().min(0).max(63)).max(12).default([]),
  lastFrameDescription: boundedText(4_000).default(""),
  lastFrameCharacterIdxs: z.array(z.number().int().min(0).max(63)).max(12).default([]),
  motion: boundedText(4_000).default(""),
  variation: z.enum(["large", "medium", "small"]).catch("small"),
  variationReason: boundedText(1_200).default(""),
});
export type ShotDecomposition = z.infer<typeof shotDecompositionSchema>;

// ---------------------------------------------------------------------------
// Stored production
// ---------------------------------------------------------------------------

const imageRefSchema = z.object({
  artifactId: z.string().min(1),
  prompt: z.string().default(""),
  width: z.number().nullish().transform((value) => value ?? null),
  height: z.number().nullish().transform((value) => value ?? null),
});

const frameSchema = z.object({
  description: z.string(),
  visibleCharacterIdxs: z.array(z.number().int()),
  image: imageRefSchema.nullish().transform((value) => value ?? null),
});

export const vimaxProductionSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string().min(1),
  title: z.string().min(1),
  logline: z.string(),
  brief: z.string(),
  mode: z.enum(["idea2video", "script2video"]),
  style: z.string(),
  userRequirement: z.string(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  story: z.string(),
  characters: z.array(
    z.object({
      idx: z.number().int().min(0),
      identifier: z.string().min(1),
      isVisible: z.boolean(),
      staticFeatures: z.string(),
      dynamicFeatures: z.string().nullish().transform((value) => value ?? null),
      portrait: imageRefSchema.nullish().transform((value) => value ?? null),
    }),
  ),
  scenes: z.array(
    z.object({
      idx: z.number().int().min(0),
      isLast: z.boolean(),
      heading: z.string(),
      location: z.string(),
      timeOfDay: z.string(),
      atmosphere: z.string(),
      characterIdxs: z.array(z.number().int()),
      script: z.string(),
    }),
  ),
  shots: z.array(
    z.object({
      idx: z.number().int().min(0),
      sceneIdx: z.number().int().min(0),
      shotInScene: z.number().int().min(0),
      camIdx: z.number().int().min(0),
      isLast: z.boolean(),
      visualDescription: z.string(),
      audioDescription: z.string(),
      firstFrame: frameSchema,
      lastFrame: frameSchema,
      motion: z.string(),
      variation: z.enum(["large", "medium", "small"]),
      variationReason: z.string(),
      durationSeconds: z.number(),
      dialogue: z.array(
        z.object({ speaker: z.string(), line: z.string(), emotion: z.string() }),
      ),
      narration: z.string().nullish().transform((value) => value ?? null),
      videoPrompt: z.string(),
    }),
  ),
  // `imageBackendReason` and `video` arrived after the first films were stored,
  // so both are optional: an older production must still open rather than being
  // refused for a field it could not have had.
  renderPlan: z.object({
    imageBackend: z.enum(["breadboard-provider", "none"]),
    imageBackendReason: z.string().default(""),
    videoBackend: z.enum(["none", "ffmpeg-animatic"]).catch("none"),
    videoBackendReason: z.string(),
    video: z
      .object({
        artifactId: z.string().min(1),
        filename: z.string(),
        durationSeconds: z.number(),
        width: z.number(),
        height: z.number(),
        shotCount: z.number().int(),
      })
      .nullish()
      .transform((value) => value ?? null),
    totalDurationSeconds: z.number(),
    shotCount: z.number().int(),
    drawnFrameCount: z.number().int(),
  }),
  status: z.enum(["planned", "storyboarded", "rendered"]),
  createdAt: z.string(),
  revisions: z.array(z.string()).default([]),
});

/**
 * Structural check for a stored production, run when one is read back out of
 * artifact storage. A malformed production would render an empty film that
 * still looked authoritative, so it is verified rather than trusted.
 */
export function parseStoredProduction(value: unknown): SchemaResult<VimaxProduction> {
  const result = parseWithSchema(vimaxProductionSchema, value, "The stored ViMax production");
  if (!result.ok) return result;
  if (result.value.schemaVersion !== VIMAX_PRODUCTION_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported production schema version ${result.value.schemaVersion}.`,
      issues: [`expected ${VIMAX_PRODUCTION_SCHEMA_VERSION}`],
    };
  }
  return { ok: true, value: result.value as VimaxProduction };
}
