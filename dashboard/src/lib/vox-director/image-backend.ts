// Drawing the collage posters.
//
// One poster per shot, through Breadboard's existing ComfyUI integration —
// `lib/comfyui/service.ts`, the same local diffusion server the image studio
// and the Socials Manager render with. There is no second process manager and
// no second HTTP client here; `renderComfyUiImage` already starts a managed
// clone if that is allowed, validates the checkpoint against the live list, and
// hands back bytes plus the resolved settings.
//
// When ComfyUI cannot draw, the run says so and falls back to the deterministic
// title cards the Python driver renders — which is also exactly what
// `--no-images` asks for. What it never does is quietly produce nothing and
// call the film finished.

import fs from "node:fs";
import path from "node:path";
import { ComfyUiError } from "../comfyui/client.ts";
import { resolveComfyUiConfig } from "../comfyui/config.ts";
import { comfyUiStatus, renderComfyUiImage } from "../comfyui/service.ts";
import { resolveInWorkspace, relativeInWorkspace, writeSpec } from "./workspace.ts";
import { runVoxDriver } from "./runtime.ts";
import type { VoxPosterRef, VoxStyle } from "./types.ts";

/** ComfyUI's negative prompt for this look: the ways a collage poster goes wrong. */
export const VOX_NEGATIVE_PROMPT =
  "3d render, cgi, photorealistic, smooth gradient, blurry, deformed, extra limbs, " +
  "watermark, signature, low quality, jpeg artifacts, muddy colours, cluttered background";

export interface PosterTarget {
  key: string;
  prompt: string;
  title: string;
  background: string;
  withTitle: boolean;
}

export interface ImagePlan {
  /** "comfyui" when a server answered and had a checkpoint; "title-card" otherwise. */
  backend: "comfyui" | "title-card";
  checkpoint: string;
  /** Why the plan is what it is. Reported on the card and stored in the film. */
  reason: string;
}

/**
 * Diffusion likes sizes near a megapixel and hates 1920×1080. Posters are drawn
 * at a shape the checkpoint can actually compose in, and the motion stage scales
 * them onto the film's canvas — which it has to do anyway, because a poster and
 * a frame are not the same thing.
 */
export function posterSize(aspectRatio: "16:9" | "9:16" | "1:1"): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 768, height: 1344 };
  if (aspectRatio === "1:1") return { width: 1024, height: 1024 };
  return { width: 1344, height: 768 };
}

/** The film's own canvas, matching what the clone's assembly stage renders at. */
export function canvasSize(aspectRatio: "16:9" | "9:16" | "1:1"): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

/**
 * Decide once, before the first poster, whether ComfyUI can draw.
 *
 * Asking per poster is how ViMax's first version failed forty times in a row
 * with one reason each. The state machine in `comfyUiStatus()` already answers
 * this in one sentence, so it is asked once and the answer carries the run.
 */
export async function planImageBackend(input: {
  images: boolean;
  configuredCheckpoint: string | null;
}): Promise<ImagePlan> {
  if (!input.images) {
    return {
      backend: "title-card",
      checkpoint: "",
      reason:
        "--no-images was set, so the posters are the deterministic paper title cards rather than generated collages.",
    };
  }
  const config = resolveComfyUiConfig();
  let status: Awaited<ReturnType<typeof comfyUiStatus>>;
  try {
    status = await comfyUiStatus(config);
  } catch (error) {
    return {
      backend: "title-card",
      checkpoint: "",
      reason: `ComfyUI could not be reached (${
        error instanceof Error ? error.message : "unknown error"
      }), so the posters are the deterministic paper title cards.`,
    };
  }
  if (status.state !== "ready") {
    return {
      backend: "title-card",
      checkpoint: "",
      reason: `${status.message} The posters are the deterministic paper title cards instead.`,
    };
  }
  const available = status.capabilities?.checkpoints ?? [];
  const checkpoint =
    input.configuredCheckpoint && available.includes(input.configuredCheckpoint)
      ? input.configuredCheckpoint
      : available[0] ?? "";
  return {
    backend: "comfyui",
    checkpoint,
    reason:
      input.configuredCheckpoint && checkpoint !== input.configuredCheckpoint
        ? `ComfyUI no longer has "${input.configuredCheckpoint}", so the posters were drawn with ${checkpoint}.`
        : "",
  };
}

export interface PosterResult {
  key: string;
  poster: VoxPosterRef;
}

export interface PosterFailure {
  key: string;
  reason: string;
  /** True when the provider is out for the whole run, not just this poster. */
  exhausted: boolean;
}

/**
 * Draw one poster with ComfyUI and write it into the run's workspace.
 *
 * The seed is derived from the run's seed and the shot key when one was fixed,
 * so `--seed 1234` renders the same film twice; without one, ComfyUI picks and
 * the resolved value is recorded, which is the only thing that makes the poster
 * reproducible afterwards.
 */
export async function drawPoster(input: {
  runId: string;
  plan: ImagePlan;
  target: PosterTarget;
  aspectRatio: "16:9" | "9:16" | "1:1";
  seed: number | null;
  steps: number;
  cfg: number;
  signal?: AbortSignal;
}): Promise<{ ok: true; result: PosterResult } | { ok: false; failure: PosterFailure }> {
  const { width, height } = posterSize(input.aspectRatio);
  const seed = input.seed === null ? null : shotSeed(input.seed, input.target.key);
  try {
    const rendered = await renderComfyUiImage(
      {
        checkpoint: input.plan.checkpoint,
        prompt: input.target.prompt,
        negativePrompt: VOX_NEGATIVE_PROMPT,
        steps: input.steps,
        cfg: input.cfg,
        width,
        height,
        seed,
      },
      input.signal ? { signal: input.signal } : {},
    );
    const relative = `keyframes/poster_${safeKey(input.target.key)}.png`;
    const absolute = resolveInWorkspace(input.runId, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, rendered.buffer);
    return {
      ok: true,
      result: {
        key: input.target.key,
        poster: {
          artifactId: null,
          relativePath: relative,
          width: rendered.options.width,
          height: rendered.options.height,
          backend: `comfyui:${rendered.options.checkpoint}`,
          // A drawn poster's headline is wherever the model put it, so there is
          // no box to hand the motion stage.
          titleBox: null,
          render: {
            prompt: rendered.options.prompt,
            negativePrompt: rendered.options.negativePrompt,
            checkpoint: rendered.options.checkpoint,
            seed: rendered.options.seed,
            steps: rendered.options.steps,
            cfg: rendered.options.cfg,
            samplerName: rendered.options.samplerName,
            scheduler: rendered.options.scheduler,
            width: rendered.options.width,
            height: rendered.options.height,
          },
        },
      },
    };
  } catch (error) {
    const comfy = error instanceof ComfyUiError ? error : null;
    // A server that has gone away, been switched off, or lost its models is out
    // for the rest of the run; asking again once per poster only multiplies one
    // failure by the shot count.
    const exhausted = Boolean(
      comfy &&
        /disabled|not_installed|unavailable|no_models|stopped|installing/.test(comfy.code ?? ""),
    );
    return {
      ok: false,
      failure: {
        key: input.target.key,
        reason: error instanceof Error ? error.message : "ComfyUI could not draw this poster.",
        exhausted,
      },
    };
  }
}

/**
 * Render the deterministic paper title cards for a set of shots.
 *
 * One driver call for all of them: the cards are cheap, and a Python start per
 * poster would cost more than the drawing.
 */
export async function drawTitleCards(input: {
  runId: string;
  python: string;
  cwd: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  style: VoxStyle;
  seed: number | null;
  targets: PosterTarget[];
  signal?: AbortSignal;
}): Promise<{ ok: true; posters: PosterResult[] } | { ok: false; reason: string }> {
  if (input.targets.length === 0) return { ok: true, posters: [] };
  const { width, height } = canvasSize(input.aspectRatio);
  const specPath = writeSpec(input.runId, "posters", {
    root: resolveInWorkspace(input.runId, "."),
    outDir: "keyframes",
    width,
    height,
    seed: input.seed ?? 0,
    style: { palette: input.style.palette, idiom: input.style.idiom },
    shots: input.targets.map((target) => ({
      key: target.key,
      title: target.title,
      background: target.background,
      withTitle: target.withTitle,
    })),
  });
  const run = await runVoxDriver({
    python: input.python,
    operation: "posters",
    specPath,
    cwd: input.cwd,
    timeoutMs: 10 * 60_000,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const parsed = parseDriverJson(run.stdout);
  if (!run.ok || !parsed?.ok) {
    return {
      ok: false,
      reason:
        (parsed?.error as string | undefined) ||
        (run.timedOut ? "The title cards timed out." : "The title cards could not be rendered."),
    };
  }
  const made = Array.isArray(parsed.posters) ? (parsed.posters as Array<Record<string, unknown>>) : [];
  return {
    ok: true,
    posters: made.map((entry) => ({
      key: String(entry.key ?? ""),
      poster: {
        artifactId: null,
        relativePath: relativeInWorkspace(input.runId, String(entry.path ?? "")),
        width: Number(entry.width ?? width),
        height: Number(entry.height ?? height),
        backend: "title-card",
        titleBox: readTitleBox(entry.titleBox),
        render: null,
      },
    })),
  };
}

/** The headline box a title card reported, when it drew one. */
function readTitleBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const box = value.map((entry) => Number(entry));
  if (box.some((entry) => !Number.isFinite(entry))) return null;
  return [box[0], box[1], box[2], box[3]];
}

export function parseDriverJson(stdout: string): Record<string, unknown> | null {
  // The driver prints progress to stderr and exactly one JSON object to stdout,
  // but a Python warning can still land in front of it, so the last line that
  // parses is the answer.
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith("{"));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

/** A per-shot seed derived from the film's, so one flag fixes the whole film. */
export function shotSeed(seed: number, key: string): number {
  let hash = seed >>> 0;
  for (const character of key) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function safeKey(key: string): string {
  return (key.replace(/[^a-z0-9_-]/gi, "-").slice(0, 48) || "shot");
}
