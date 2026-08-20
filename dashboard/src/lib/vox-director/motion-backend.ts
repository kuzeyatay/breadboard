// Making a poster move, through the clone's own local engine.
//
// `vox-director/scripts/motion.py` is the piece of upstream that is real,
// working, offline software: layers with keyframe tracks, the fly-in / slap /
// drop / pop-settle entrances with their paper overshoot, sway and pulse
// breathing, procedural confetti and starburst, and a camera that pushes and
// takes an impact shake on each entrance. What it has never had is a way to
// decide *what* to cut out of a poster — upstream says so plainly: "the
// per-video layout is manual (until an LLM auto-layout layer exists)".
//
// This is that layer's other half. The plan comes from ChatMock, is validated
// in `schemas.ts`, and arrives here as a bounded description; this module turns
// it into two driver calls and never lets a model choose a path, a command or a
// flag. `docs/ADDING_AN_AGENT.md` §20's rule — spawn argument arrays, no
// interpolation — is kept by there being nothing to interpolate: the driver
// reads a JSON spec written inside the run's own workspace.

import { parseDriverJson, safeKey } from "./image-backend.ts";
import { relativeInWorkspace, resolveInWorkspace, writeSpec } from "./workspace.ts";
import { runVoxDriver } from "./runtime.ts";
import type { VoxMotionBackend } from "./identity.ts";
import type { VoxElement, VoxMotionPlan } from "./types.ts";

/** One shot's render is bounded: a Pillow frame loop that never returns is a hung run. */
const MOTION_TIMEOUT_MS = 12 * 60_000;
const CLIP_TIMEOUT_MS = 4 * 60_000;

/**
 * The renderers to try, in order, for a requested backend.
 *
 * Asking for Ken Burns means Ken Burns — a person who chose the fast renderer
 * did not ask to wait for a frame loop first — so a named backend only ever
 * degrades downward, never up.
 */
export function motionChain(
  preferred: VoxMotionBackend,
): Array<MotionRenderResult["backend"]> {
  if (preferred === "kenburns") return ["kenburns", "still"];
  if (preferred === "scrapbook") return ["scrapbook", "kenburns", "still"];
  return ["local", "scrapbook", "kenburns", "still"];
}

/**
 * A shot key, however a model chose to write it back.
 *
 * Asked for "1a" the model has answered "1a", " 1A" and "shot 1a", all meaning
 * the same poster, and the last of those cost four shots their element motion
 * before the mismatch was visible. So the key is reduced to the only two things
 * that identify a shot — the beat number and the shot letter — and anything
 * that carries neither matches nothing, which is the correct outcome.
 */
export function planKey(value: string): string {
  const number = /\d+/.exec(value);
  if (!number) return "";
  const beat = Number.parseInt(number[0], 10);
  // The shot letter is a word on its own — "1a", "1-a", "beat 1 shot b" — so a
  // single letter that is part of a longer word ("shot") is not it.
  const letter = /(?:^|[\s\-_])([a-z])(?![a-z])/i.exec(
    value.slice(number.index + number[0].length),
  );
  return `${beat}${(letter?.[1] ?? "a").toLowerCase()}`;
}

/**
 * Cut the whole headline, not the model's guess at where it is.
 *
 * Breadboard drew the title cards, so it knows the exact band the headline
 * occupies. The first live run planned a box over only its first line: the
 * second line stayed on the backdrop, was blurred as a landing zone, and read
 * as a ghost under the sharp piece that flew in over it. Where the real box is
 * known it wins, and where it is not — a poster a model drew — the plan stands.
 */
export function snapHeadline(
  plan: VoxMotionPlan | null,
  titleBox: [number, number, number, number] | null,
): VoxMotionPlan | null {
  if (!plan || !titleBox) return plan;
  let snapped = false;
  const elements = plan.elements.map((element) => {
    if (snapped || element.name.toLowerCase() !== "headline") return element;
    snapped = true;
    return { ...element, bbox: titleBox, mode: "crop" as const };
  });
  return snapped ? { ...plan, elements } : plan;
}

export interface MotionRenderInput {
  runId: string;
  python: string;
  cwd: string;
  key: string;
  /** Poster to animate, relative to the run workspace. */
  posterRelativePath: string;
  posterWidth: number;
  posterHeight: number;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  plan: VoxMotionPlan | null;
  /** Which renderer to try first. `auto` means the whole chain. */
  preferred: VoxMotionBackend;
  /** Alternate the Ken Burns direction, as upstream's own fallback does. */
  index: number;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
}

export interface MotionRenderResult {
  key: string;
  backend: "local" | "scrapbook" | "kenburns" | "still";
  relativePath: string;
  /** Why this is not the renderer that was asked for, when it is not. */
  note: string;
}

export interface MotionRenderFailure {
  key: string;
  reason: string;
}

/**
 * Render one shot, degrading rather than failing.
 *
 * The chain is the one section 21 of the task asks for and the one upstream's
 * own notes imply: element-level motion, then the lighter scrapbook assembler,
 * then the pure-ffmpeg Ken Burns, then a held frame. Each step down is recorded
 * on the shot, so a film that fell back says so instead of quietly looking
 * duller than it was meant to.
 */
export async function renderShotMotion(
  input: MotionRenderInput,
): Promise<{ ok: true; result: MotionRenderResult } | { ok: false; failure: MotionRenderFailure }> {
  const notes: string[] = [];
  const wanted = motionChain(input.preferred);

  for (const backend of wanted) {
    if (backend === "local" && (!input.plan || input.plan.elements.length === 0)) {
      notes.push("no element plan was produced for this poster");
      continue;
    }
    const attempt =
      backend === "local"
        ? await renderLocal(input)
        : await renderSimple(input, backend);
    if (attempt.ok) {
      return {
        ok: true,
        result: {
          key: input.key,
          backend,
          relativePath: attempt.relativePath,
          note: notes.join("; "),
        },
      };
    }
    notes.push(`${backend}: ${attempt.reason}`);
    if (input.signal?.aborted) break;
  }

  return { ok: false, failure: { key: input.key, reason: notes.join("; ") } };
}

async function renderLocal(
  input: MotionRenderInput,
): Promise<{ ok: true; relativePath: string } | { ok: false; reason: string }> {
  const plan = input.plan as VoxMotionPlan;
  const elementsDir = `elements/${safeKey(input.key)}`;

  // Stage one: cut the pieces and build the blurred backdrop.
  const cutSpec = writeSpec(input.runId, `elements-${safeKey(input.key)}`, {
    root: resolveInWorkspace(input.runId, "."),
    poster: input.posterRelativePath,
    outDir: elementsDir,
    width: input.width,
    height: input.height,
    elements: plan.elements.map(describeElement),
  });
  const cut = await runVoxDriver({
    python: input.python,
    operation: "elements",
    specPath: cutSpec,
    cwd: input.cwd,
    timeoutMs: CLIP_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onLine: input.onProgress } : {}),
  });
  const cutResult = parseDriverJson(cut.stdout);
  if (!cut.ok || !cutResult?.ok) {
    return {
      ok: false,
      reason: String(cutResult?.error ?? (cut.timedOut ? "cutting the pieces timed out" : "the pieces could not be cut")),
    };
  }

  const cutElements = Array.isArray(cutResult.elements)
    ? (cutResult.elements as Array<Record<string, unknown>>)
    : [];
  const byName = new Map(cutElements.map((entry) => [String(entry.name ?? ""), entry]));
  const posterSize = (cutResult.poster ?? {}) as { width?: number; height?: number };

  const layers = plan.elements
    .map((element) => {
      const cutOut = byName.get(safeName(element.name));
      if (!cutOut || !cutOut.path) return null;
      return {
        name: safeName(element.name),
        path: relativeInWorkspace(input.runId, String(cutOut.path)),
        center: cutOut.center,
        entrance: element.entrance,
        from: element.from,
        start: element.start,
        spin: element.spin,
      };
    })
    .filter(Boolean);

  if (layers.length === 0) {
    return { ok: false, reason: "none of the planned pieces could be cut from the poster" };
  }

  const out = `motion/clip_${safeKey(input.key)}.mp4`;
  const motionSpec = writeSpec(input.runId, `motion-${safeKey(input.key)}`, {
    root: resolveInWorkspace(input.runId, "."),
    backdrop: relativeInWorkspace(input.runId, String(cutResult.backdrop ?? "")),
    out,
    width: input.width,
    height: input.height,
    fps: input.fps,
    seconds: input.seconds,
    posterWidth: posterSize.width ?? input.posterWidth,
    posterHeight: posterSize.height ?? input.posterHeight,
    cameraZoom: plan.cameraZoom,
    cameraShake: plan.cameraShake,
    confetti: plan.confetti,
    starburst: plan.starburst,
    elements: layers,
  });
  const rendered = await runVoxDriver({
    python: input.python,
    operation: "motion",
    specPath: motionSpec,
    cwd: input.cwd,
    timeoutMs: MOTION_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onLine: input.onProgress } : {}),
  });
  const result = parseDriverJson(rendered.stdout);
  if (!rendered.ok || !result?.ok) {
    return {
      ok: false,
      reason: String(result?.error ?? (rendered.timedOut ? "the frame loop timed out" : "the clip could not be encoded")),
    };
  }
  return { ok: true, relativePath: out };
}

async function renderSimple(
  input: MotionRenderInput,
  backend: "scrapbook" | "kenburns" | "still",
): Promise<{ ok: true; relativePath: string } | { ok: false; reason: string }> {
  const out = `motion/clip_${safeKey(input.key)}.mp4`;
  const specPath = writeSpec(input.runId, `${backend}-${safeKey(input.key)}`, {
    root: resolveInWorkspace(input.runId, "."),
    poster: input.posterRelativePath,
    out,
    width: input.width,
    height: input.height,
    fps: input.fps,
    seconds: input.seconds,
    // Upstream alternates push-in and push-out shot by shot so a run of
    // Ken Burns clips does not read as one long drift.
    zoomIn: input.index % 2 === 0,
    tilt: [-2.5, 2.0, -2.0, 2.5, -1.5, 2.2][input.index % 6],
  });
  const rendered = await runVoxDriver({
    python: input.python,
    operation: backend,
    specPath,
    cwd: input.cwd,
    timeoutMs: CLIP_TIMEOUT_MS,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onProgress ? { onLine: input.onProgress } : {}),
  });
  const result = parseDriverJson(rendered.stdout);
  if (!rendered.ok || !result?.ok) {
    return {
      ok: false,
      reason: String(result?.error ?? (rendered.timedOut ? "timed out" : "ffmpeg could not render it")),
    };
  }
  return { ok: true, relativePath: out };
}

function describeElement(element: VoxElement): Record<string, unknown> {
  return {
    name: safeName(element.name),
    bbox: normaliseBox(element.bbox),
    mode: element.mode,
  };
}

/** Names become file names. Anything else is not a name, it is an attempt. */
export function safeName(value: string): string {
  return (value.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "piece").toLowerCase();
}

/**
 * A box the driver can act on.
 *
 * The schema already refuses a box that is inverted or too small, so this only
 * has to hold the ordering invariant against a repaired value and keep every
 * corner on the grid.
 */
export function normaliseBox(
  box: [number, number, number, number],
): [number, number, number, number] {
  const clamp = (value: number) => Math.max(0, Math.min(1000, Math.round(value)));
  const x0 = clamp(Math.min(box[0], box[2]));
  const x1 = clamp(Math.max(box[0], box[2]));
  const y0 = clamp(Math.min(box[1], box[3]));
  const y1 = clamp(Math.max(box[1], box[3]));
  return [x0, y0, x1, y1];
}
