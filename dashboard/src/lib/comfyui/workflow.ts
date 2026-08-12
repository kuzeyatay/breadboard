// The one workflow Breadboard submits, and the rules for the numbers in it.
//
// ComfyUI's real interface is a node graph, and the point of the Advanced tab
// is not to rebuild that graph editor inside a post studio — it is to expose
// the handful of knobs that change what the picture looks like: which model,
// what to say, what not to say, how long to think, how closely to obey, how
// big, and which noise to start from.
//
// The graph itself is the stock text-to-image chain (checkpoint → two text
// encodes → sampler → decode → save), with node ids as strings because that is
// what ComfyUI's API format uses.

import type { ComfyUiPrompt } from "./client.ts";

export interface ComfyUiRenderOptions {
  checkpoint: string;
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  width: number;
  height: number;
  /** Null asks for a fresh one, which is what "surprise me" means here. */
  seed: number | null;
}

export const COMFYUI_LIMITS = {
  steps: { min: 1, max: 150, default: 25 },
  cfg: { min: 0, max: 30, default: 7 },
  // ComfyUI's own latent node steps by 8; anything else is silently rounded
  // down inside the graph, which would make the studio lie about the size.
  size: { min: 256, max: 2048, step: 8, default: 1024 },
} as const;

export const COMFYUI_DEFAULT_NEGATIVE =
  "text, watermark, signature, logo, blurry, low quality, deformed";

const MAX_PROMPT_LENGTH = 4_000;
const SEED_CEILING = 2 ** 32;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to ComfyUI's latent step so the requested size is the delivered size. */
function toLatentSize(value: number): number {
  const { min, max, step } = COMFYUI_LIMITS.size;
  return clamp(Math.round(value / step) * step, min, max);
}

/**
 * Coerce whatever arrived over the wire into a render this server will accept.
 *
 * Everything is clamped rather than rejected — a slider that arrives at 900
 * steps is a mistake worth correcting, not a request worth failing, and the
 * one thing that genuinely cannot be guessed (the checkpoint) is validated
 * against the live model list by the caller.
 */
export function normalizeRenderOptions(
  raw: Partial<Record<keyof ComfyUiRenderOptions, unknown>>,
  fallback: { checkpoint: string; samplerName: string; scheduler: string },
): ComfyUiRenderOptions {
  const text = (value: unknown, otherwise: string): string =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_PROMPT_LENGTH) : otherwise;
  const number = (value: unknown, otherwise: number): number => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : otherwise;
  };

  const seedRaw = raw.seed;
  const seed =
    seedRaw === null || seedRaw === undefined || seedRaw === ""
      ? null
      : clamp(Math.floor(number(seedRaw, 0)), 0, SEED_CEILING - 1);

  return {
    checkpoint: text(raw.checkpoint, fallback.checkpoint),
    prompt: text(raw.prompt, ""),
    negativePrompt: text(raw.negativePrompt, COMFYUI_DEFAULT_NEGATIVE),
    steps: Math.round(
      clamp(
        number(raw.steps, COMFYUI_LIMITS.steps.default),
        COMFYUI_LIMITS.steps.min,
        COMFYUI_LIMITS.steps.max,
      ),
    ),
    cfg:
      Math.round(
        clamp(number(raw.cfg, COMFYUI_LIMITS.cfg.default), COMFYUI_LIMITS.cfg.min, COMFYUI_LIMITS.cfg.max) *
          10,
      ) / 10,
    samplerName: text(raw.samplerName, fallback.samplerName),
    scheduler: text(raw.scheduler, fallback.scheduler),
    width: toLatentSize(number(raw.width, COMFYUI_LIMITS.size.default)),
    height: toLatentSize(number(raw.height, COMFYUI_LIMITS.size.default)),
    seed,
  };
}

/** The seed actually sent, so the result can record which one made the picture. */
export function resolveSeed(seed: number | null): number {
  return seed ?? Math.floor(Math.random() * SEED_CEILING);
}

export function buildTextToImageWorkflow(
  options: ComfyUiRenderOptions & { seed: number },
  filenamePrefix = "breadboard",
): ComfyUiPrompt {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: options.checkpoint },
    },
    "2": {
      class_type: "EmptyLatentImage",
      inputs: { width: options.width, height: options.height, batch_size: 1 },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: options.prompt, clip: ["1", 1] },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: options.negativePrompt, clip: ["1", 1] },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: options.seed,
        steps: options.steps,
        cfg: options.cfg,
        sampler_name: options.samplerName,
        scheduler: options.scheduler,
        denoise: 1,
        model: ["1", 0],
        positive: ["3", 0],
        negative: ["4", 0],
        latent_image: ["2", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["6", 0] },
    },
  };
}
