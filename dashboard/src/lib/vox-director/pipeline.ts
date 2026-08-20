// The staged production.
//
//   beat map -> look -> poster prompts -> posters -> element plan -> motion
//            -> narration -> music -> assembly -> a validated MP4
//
// Every model stage is validated before the next one consumes it, and every
// rendering stage degrades rather than stopping the film — except narration,
// which is the one thing a narrated explainer cannot do without.
//
// Nothing here reaches api.atlascloud.ai, and nothing here needs an API key.
// The reasoning is ChatMock, the drawing is the repository's ComfyUI, the voice
// is the repository's Voicebox, the motion is the clone's Python, and the
// assembly is the clone's ffmpeg stage.

import fs from "node:fs";
import {
  canvasSize,
  drawPoster,
  drawTitleCards,
  parseDriverJson,
  planImageBackend,
  posterSize,
  type PosterTarget,
} from "./image-backend.ts";
import { planKey, renderShotMotion, snapHeadline } from "./motion-backend.ts";
import {
  narrateBeat,
  prepareMusicBed,
  resolveNarrationVoice,
} from "./audio-backend.ts";
import { chooseStyle, planMotion, resolveStyle, writeBeatMap, type ModelTarget } from "./model-client.ts";
import { summariseBeatsForModel } from "./prompts.ts";
import { runVoxDriver, resolvePython, resolveVoxDirectorRoot } from "./runtime.ts";
import {
  relativeInWorkspace,
  resolveInWorkspace,
  writeJsonFile,
  writeSpec,
} from "./workspace.ts";
import { VOX_PRODUCTION_SCHEMA_VERSION } from "./schemas.ts";
import { writeUpstreamBeatsDocument } from "./beats-document.ts";
import { productionDuration, productionShots } from "./types.ts";
import type { VoxBeat, VoxProduction, VoxShot, VoxStyle } from "./types.ts";
import type { VoxDirectorRequest } from "./identity.ts";

const FPS = 24;
/**
 * How many posters one element-planning call covers.
 *
 * Small on purpose. The plan for a poster is a nested structure of boxes,
 * entrances and timings, and asking for ten at once produced an answer that
 * fit the schema and matched none of the shots.
 */
const MOTION_PLAN_BATCH = 4;
/** Upstream's own tail: a beat holds half a second past its last word. */
const TAIL_SECONDS = 0.5;

export class VoxPipelineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VoxPipelineError";
    this.code = code;
  }
}

export interface PipelineHooks {
  emit: (type: string, payload?: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** Store a finished poster as an image artifact, when a conversation exists. */
  storePoster?: (input: {
    key: string;
    absolutePath: string;
    title: string;
    prompt: string;
    backend: string;
  }) => Promise<string | null>;
}

export interface ProduceInput {
  runId: string;
  userId: number;
  request: VoxDirectorRequest;
  target: ModelTarget;
  hooks: PipelineHooks;
  conversationContext?: string;
  previousProduction?: string;
  /** ComfyUI checkpoint the user chose in settings, when they chose one. */
  checkpoint: string | null;
  steps: number;
  cfg: number;
  /** Voicebox profile the user chose in settings, when they chose one. */
  voiceProfileId: string | null;
  musicTrack: string | null;
}

function aborted(hooks: PipelineHooks): boolean {
  return Boolean(hooks.signal?.aborted);
}

export async function produceFilm(input: ProduceInput): Promise<VoxProduction> {
  const clone = resolveVoxDirectorRoot();
  if (!clone) {
    throw new VoxPipelineError(
      "clone_missing",
      "The vox-director clone was not found next to the dashboard, so its collage method and local engine are unavailable.",
    );
  }
  const python = resolvePython(clone.root);
  if (!python) {
    throw new VoxPipelineError(
      "python_missing",
      "No Python interpreter was found, and the local motion engine and assembly stage both need one.",
    );
  }
  const cwd = resolveInWorkspace(input.runId, ".");
  const { hooks, request } = input;

  // ---- 1. the beat map ----------------------------------------------------
  hooks.emit("plan.started", { duration: request.duration, aspectRatio: request.aspectRatio });
  const draft = await writeBeatMap(input.target, {
    request,
    cloneRoot: clone.root,
    ...(input.conversationContext ? { conversation: input.conversationContext } : {}),
    ...(input.previousProduction ? { previousProduction: input.previousProduction } : {}),
  });
  if (aborted(hooks)) throw new VoxPipelineError("aborted", "The run was stopped.");

  const beats: VoxBeat[] = draft.beats.map((beat, beatIndex) => {
    const id = beatIndex + 1;
    return {
      id,
      title: beat.title.toUpperCase().slice(0, 60),
      narration: beat.narration,
      background: beat.background,
      feel: beat.feel,
      hook: beat.hook ?? "",
      narrationSeconds: 0,
      narrationRelativePath: null,
      shots: beat.shots.map((shot, shotIndex) => {
        const letter = /^[a-z]$/i.test(shot.id) ? shot.id.toLowerCase() : "abc"[shotIndex] ?? "a";
        return {
          id: letter,
          key: `${id}${letter}`,
          duration: Math.min(9, Math.max(1.5, shot.duration)),
          shotSize: shot.shotSize,
          cameraMove: shot.cameraMove,
          scene: shot.scene,
          elementMotion: shot.elementMotion,
          // The headline shows once per beat; upstream is explicit that a
          // detail cut-in carries no title.
          title: shotIndex === 0 ? shot.title || true : false,
          imagePrompt: "",
          negativePrompt: "",
          poster: null,
          motionPlan: null,
          clipBackend: null,
          clipRelativePath: null,
          clipNote: "",
        } satisfies VoxShot;
      }),
    } satisfies VoxBeat;
  });

  hooks.emit("plan.completed", {
    title: draft.title,
    logline: draft.logline,
    arc: draft.arc,
    beatCount: beats.length,
    shotCount: beats.reduce((sum, beat) => sum + beat.shots.length, 0),
    headlines: beats.map((beat) => beat.title),
  });

  // ---- 2. the look --------------------------------------------------------
  hooks.emit("style.started", {});
  const themes = await readThemes({ python, cwd, runId: input.runId, hooks });
  const styleChoice = await chooseStyle(input.target, {
    request,
    title: draft.title,
    arc: draft.arc,
    beatSummary: summariseBeatsForModel(beats),
    cloneRoot: clone.root,
    themes,
  });
  const style: VoxStyle = resolveStyle(styleChoice, themes);
  hooks.emit("style.completed", {
    theme: style.theme,
    idiom: style.idiom,
    palette: style.palette,
    mood: style.mood,
    rationale: style.rationale,
  });
  if (aborted(hooks)) throw new VoxPipelineError("aborted", "The run was stopped.");

  // ---- 3. the poster prompts, composed by the clone's own composer ---------
  await composePrompts({
    python,
    cwd,
    runId: input.runId,
    aspectRatio: request.aspectRatio,
    style,
    beats,
    hooks,
  });

  // ---- 4. the posters -----------------------------------------------------
  const shots = beats.flatMap((beat) => beat.shots.map((shot) => ({ beat, shot })));
  hooks.emit("keyframes.started", { count: shots.length });

  const plan = await planImageBackend({
    images: request.images,
    configuredCheckpoint: input.checkpoint,
  });
  hooks.emit("keyframes.planned", { backend: plan.backend, checkpoint: plan.checkpoint, reason: plan.reason });

  const imageNotes: string[] = plan.reason ? [plan.reason] : [];
  const fallbackTargets: PosterTarget[] = [];
  let comfyExhausted = plan.backend !== "comfyui";

  for (const [index, entry] of shots.entries()) {
    if (aborted(hooks)) throw new VoxPipelineError("aborted", "The run was stopped.");
    const target: PosterTarget = {
      key: entry.shot.key,
      prompt: entry.shot.imagePrompt,
      title: entry.beat.title,
      background: entry.beat.background,
      withTitle: entry.shot.title,
    };
    if (comfyExhausted) {
      fallbackTargets.push(target);
      continue;
    }
    hooks.emit("keyframe.started", { key: entry.shot.key, index: index + 1, total: shots.length });
    const drawn = await drawPoster({
      runId: input.runId,
      plan,
      target,
      aspectRatio: request.aspectRatio,
      seed: request.seed,
      steps: input.steps,
      cfg: input.cfg,
      ...(hooks.signal ? { signal: hooks.signal } : {}),
    });
    if (drawn.ok) {
      entry.shot.poster = drawn.result.poster;
      hooks.emit("keyframe.completed", {
        key: entry.shot.key,
        index: index + 1,
        total: shots.length,
        backend: drawn.result.poster.backend,
      });
    } else {
      fallbackTargets.push(target);
      imageNotes.push(`${entry.shot.key}: ${drawn.failure.reason}`);
      hooks.emit("keyframe.failed", { key: entry.shot.key, reason: drawn.failure.reason });
      if (drawn.failure.exhausted) {
        comfyExhausted = true;
        imageNotes.push("ComfyUI stopped answering, so the remaining posters are title cards.");
      }
    }
  }

  if (fallbackTargets.length) {
    const cards = await drawTitleCards({
      runId: input.runId,
      python,
      cwd,
      aspectRatio: request.aspectRatio,
      style,
      seed: request.seed,
      targets: fallbackTargets,
      ...(hooks.signal ? { signal: hooks.signal } : {}),
    });
    if (!cards.ok) {
      throw new VoxPipelineError(
        "no_posters",
        `No posters could be produced: ${cards.reason} ${imageNotes.join(" ")}`.trim(),
      );
    }
    const byKey = new Map(cards.posters.map((poster) => [poster.key, poster.poster]));
    for (const entry of shots) {
      if (!entry.shot.poster) {
        const poster = byKey.get(entry.shot.key);
        if (poster) entry.shot.poster = poster;
      }
    }
  }

  const missing = shots.filter((entry) => !entry.shot.poster);
  if (missing.length === shots.length) {
    throw new VoxPipelineError(
      "no_posters",
      `No posters could be produced. ${imageNotes.join(" ")}`.trim(),
    );
  }

  // Posters become ordinary image artifacts, so each is independently viewable
  // and reusable rather than living only inside one run directory.
  if (hooks.storePoster) {
    for (const entry of shots) {
      if (!entry.shot.poster) continue;
      try {
        const artifactId = await hooks.storePoster({
          key: entry.shot.key,
          absolutePath: resolveInWorkspace(input.runId, entry.shot.poster.relativePath),
          title: `${draft.title} — ${entry.beat.title} (${entry.shot.key})`,
          prompt: entry.shot.imagePrompt,
          backend: entry.shot.poster.backend,
        });
        entry.shot.poster.artifactId = artifactId;
      } catch {
        // A poster that could not be filed is still a poster the film uses.
      }
    }
  }

  hooks.emit("keyframes.completed", {
    drawn: shots.filter((entry) => entry.shot.poster?.backend.startsWith("comfyui")).length,
    cards: shots.filter((entry) => entry.shot.poster?.backend === "title-card").length,
    total: shots.length,
  });

  // ---- 5. the element / motion plan ---------------------------------------
  //
  // Planned in small batches rather than one call for the whole film. Asking for
  // ten posters at once is a long structured answer, and the first live run came
  // back with plans that matched no shot at all — which cost every shot its
  // element-level motion and left the film on the scrapbook fallback. A batch
  // that fails now costs its own four shots and says so.
  hooks.emit("motion.started", { count: shots.length, backend: request.motion });
  const motionPlans = new Map<string, ReturnType<typeof normalisePlan>>();
  const planNotes: string[] = [];
  for (let index = 0; index < shots.length; index += MOTION_PLAN_BATCH) {
    if (aborted(hooks)) throw new VoxPipelineError("aborted", "The run was stopped.");
    const batch = shots.slice(index, index + MOTION_PLAN_BATCH);
    try {
      const planned = await planMotion(input.target, {
        cloneRoot: clone.root,
        style,
        posterKind: plan.backend === "comfyui" ? "collage" : "title-card",
        shots: batch.map((entry) => ({
          key: entry.shot.key,
          duration: entry.shot.duration,
          scene: entry.shot.scene,
          elementMotion: entry.shot.elementMotion,
          title: entry.beat.title,
          hasTitle: entry.shot.title,
          cameraMove: entry.shot.cameraMove,
        })),
      });
      // The key is the only thing tying a plan back to its poster, and a model
      // writes it back as "1a", " 1A" or "shot 1a" without meaning anything
      // different by it. Matching on the digits and the letter is what stops a
      // stray space from silently costing a shot its motion.
      const wanted = new Map(batch.map((entry) => [planKey(entry.shot.key), entry.shot.key]));
      let matched = 0;
      for (const entry of planned.shots) {
        const shotKey = wanted.get(planKey(entry.key));
        if (!shotKey) continue;
        matched += 1;
        motionPlans.set(shotKey, normalisePlan(entry.plan));
      }
      if (matched === 0) {
        // Naming what came back is the difference between a note someone can act
        // on and one that only says something went wrong.
        planNotes.push(
          `plans came back keyed ${planned.shots
            .map((entry) => entry.key)
            .slice(0, 6)
            .join(", ")}, which match no shot in this batch.`,
        );
      }
    } catch (error) {
      planNotes.push(
        `${batch[0].shot.key}-${batch[batch.length - 1].shot.key}: ${
          error instanceof Error ? error.message : "the element plan could not be produced"
        }`,
      );
    }
  }
  for (const entry of shots) {
    entry.shot.motionPlan = snapHeadline(
      motionPlans.get(entry.shot.key) ?? null,
      entry.shot.poster?.titleBox ?? null,
    );
  }
  if (motionPlans.size < shots.length) {
    // Never silent: a film that fell back to whole-poster motion looks duller
    // than it was meant to, and the only way anyone finds out is being told.
    planNotes.push(
      `${shots.length - motionPlans.size} of ${shots.length} posters got no element plan, so those shots use whole-poster motion.`,
    );
  }
  if (planNotes.length) {
    hooks.emit("motion.planUnavailable", { reason: planNotes.join(" ") });
  }
  hooks.emit("motion.planned", { planned: motionPlans.size, total: shots.length });

  // ---- 6. the clips -------------------------------------------------------
  const canvas = canvasSize(request.aspectRatio);
  const poster = posterSize(request.aspectRatio);
  const backendCounts = new Map<string, number>();
  const motionNotes: string[] = [];

  for (const [index, entry] of shots.entries()) {
    if (aborted(hooks)) throw new VoxPipelineError("aborted", "The run was stopped.");
    if (!entry.shot.poster) continue;
    hooks.emit("beat_motion.started", {
      key: entry.shot.key,
      index: index + 1,
      total: shots.length,
      beatId: entry.beat.id,
    });
    const rendered = await renderShotMotion({
      runId: input.runId,
      python,
      cwd,
      key: entry.shot.key,
      posterRelativePath: entry.shot.poster.relativePath,
      posterWidth: entry.shot.poster.width || poster.width,
      posterHeight: entry.shot.poster.height || poster.height,
      width: canvas.width,
      height: canvas.height,
      fps: FPS,
      seconds: entry.shot.duration,
      plan: entry.shot.motionPlan,
      preferred: request.motion,
      index,
      ...(hooks.signal ? { signal: hooks.signal } : {}),
    });
    if (rendered.ok) {
      entry.shot.clipBackend = rendered.result.backend;
      entry.shot.clipRelativePath = rendered.result.relativePath;
      entry.shot.clipNote = rendered.result.note;
      backendCounts.set(rendered.result.backend, (backendCounts.get(rendered.result.backend) ?? 0) + 1);
      if (rendered.result.note) motionNotes.push(`${entry.shot.key}: ${rendered.result.note}`);
      hooks.emit("beat_motion.completed", {
        key: entry.shot.key,
        index: index + 1,
        total: shots.length,
        backend: rendered.result.backend,
      });
    } else {
      motionNotes.push(`${entry.shot.key}: ${rendered.failure.reason}`);
      hooks.emit("beat_motion.failed", { key: entry.shot.key, reason: rendered.failure.reason });
    }
  }

  const rendered = shots.filter((entry) => entry.shot.clipRelativePath);
  if (rendered.length === 0) {
    throw new VoxPipelineError(
      "no_clips",
      `No shot could be rendered. ${motionNotes.slice(0, 3).join(" ")}`.trim(),
    );
  }
  hooks.emit("motion.completed", {
    rendered: rendered.length,
    total: shots.length,
    backends: Object.fromEntries(backendCounts),
  });

  // ---- 7. narration -------------------------------------------------------
  hooks.emit("audio.started", {});
  const voice = await resolveNarrationVoice({
    userId: input.userId,
    preferredProfileId: input.voiceProfileId,
    ...(hooks.signal ? { signal: hooks.signal } : {}),
  });
  if (!voice.ok) {
    // Narration is the one stage that does not degrade: a narrated explainer
    // with no narration is not a lesser film, it is the wrong one.
    throw new VoxPipelineError("no_narration", voice.reason);
  }
  hooks.emit("narration.voice", { name: voice.voice.name, engine: voice.voice.engine });

  for (const beat of beats) {
    if (aborted(hooks)) throw new VoxPipelineError("aborted", "The run was stopped.");
    const clip = await narrateBeat({
      runId: input.runId,
      beatId: beat.id,
      text: beat.narration,
      voice: voice.voice,
      ...(hooks.signal ? { signal: hooks.signal } : {}),
    });
    if (!clip.ok) {
      throw new VoxPipelineError(
        "no_narration",
        `Beat ${beat.id} could not be narrated: ${clip.reason}`,
      );
    }
    beat.narrationRelativePath = clip.clip.relativePath;
    beat.narrationSeconds = clip.clip.seconds;
    hooks.emit("narration.beat", {
      beatId: beat.id,
      seconds: Math.round(clip.clip.seconds * 10) / 10,
      total: beats.length,
    });
  }
  hooks.emit("narration.completed", {
    beats: beats.length,
    seconds: Math.round(beats.reduce((sum, beat) => sum + beat.narrationSeconds, 0)),
    voice: voice.voice.name,
  });

  // ---- 8. music -----------------------------------------------------------
  const runtimeSeconds = beats.reduce((total, beat) => {
    const planned = beat.shots.reduce((sum, shot) => sum + shot.duration, 0);
    return total + Math.max(planned, beat.narrationSeconds + TAIL_SECONDS);
  }, 0);
  const bed = await prepareMusicBed({
    runId: input.runId,
    python,
    cwd,
    seconds: runtimeSeconds,
    music: request.music,
    cloneRoot: clone.root,
    suppliedTrack: input.musicTrack,
    ...(hooks.signal ? { signal: hooks.signal } : {}),
  });
  hooks.emit("audio.completed", { music: bed.source, reason: bed.reason });
  if (!bed.relativePath) {
    throw new VoxPipelineError("no_audio_bed", bed.reason);
  }

  // ---- 9. assembly --------------------------------------------------------
  hooks.emit("assembly.started", { shots: rendered.length });
  const production: VoxProduction = {
    id: input.runId,
    title: draft.title,
    brief: request.brief,
    logline: draft.logline,
    arc: draft.arc,
    ending: draft.ending,
    language: draft.language || "en",
    duration: request.duration,
    aspectRatio: request.aspectRatio,
    style,
    seed: request.seed,
    beats,
    renderPlan: {
      imageBackend: plan.backend,
      imageBackendReason: imageNotes.join(" ").slice(0, 2_000),
      posterCount: shots.filter((entry) => entry.shot.poster).length,
      motionBackend: dominantBackend(backendCounts, request.motion),
      motionBackendReason: motionNotes.join(" ").slice(0, 2_000),
      narrationBackend: `voicebox:${voice.voice.engine}`,
      narrationVoice: voice.voice.name,
      narrationBackendReason: "",
      musicSource: bed.source,
      musicReason: bed.reason,
      video: null,
      videoReason: "",
    },
    runId: input.runId,
    revisions: [],
    createdAt: new Date().toISOString(),
  };

  writeUpstreamBeatsDocument(input.runId, production, bed.relativePath);
  const assembled = await assemble({ python, cwd, runId: input.runId, hooks });
  if (!assembled.ok) {
    production.renderPlan.videoReason = assembled.reason;
    throw new VoxPipelineError("assembly_failed", assembled.reason);
  }

  production.renderPlan.video = {
    artifactId: null,
    relativePath: relativeInWorkspace(input.runId, assembled.final),
    filename: `${safeFilename(draft.title)}.mp4`,
    durationSeconds: assembled.duration,
    width: assembled.width,
    height: assembled.height,
    shotCount: rendered.length,
    sizeBytes: assembled.size,
  };
  hooks.emit("assembly.completed", {
    durationSeconds: Math.round(assembled.duration * 10) / 10,
    width: assembled.width,
    height: assembled.height,
    sizeBytes: assembled.size,
  });

  writeJsonFile(input.runId, "production.json", {
    schemaVersion: VOX_PRODUCTION_SCHEMA_VERSION,
    ...production,
  });
  return production;
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

function normalisePlan(plan: {
  elements: Array<{
    name: string;
    bbox: [number, number, number, number];
    mode: "crop" | "cutout";
    entrance: "fly_in" | "slap" | "drop" | "pop_settle";
    from: "L" | "R" | "T" | "B";
    start: number;
    spin: number;
  }>;
  cameraZoom: number;
  cameraShake: boolean;
  confetti: boolean;
  starburst: boolean;
}) {
  return {
    elements: plan.elements,
    cameraZoom: plan.cameraZoom,
    cameraShake: plan.cameraShake,
    confetti: plan.confetti,
    starburst: plan.starburst,
  };
}

function dominantBackend(counts: Map<string, number>, requested: string): string {
  let best = requested === "auto" ? "local" : requested;
  let seen = -1;
  for (const [backend, count] of counts) {
    if (count > seen) {
      best = backend;
      seen = count;
    }
  }
  return best;
}

async function readThemes(input: {
  python: string;
  cwd: string;
  runId: string;
  hooks: PipelineHooks;
}): Promise<Record<string, Record<string, string>>> {
  const specPath = writeSpec(input.runId, "themes", {});
  const run = await runVoxDriver({
    python: input.python,
    operation: "themes",
    specPath,
    cwd: input.cwd,
    timeoutMs: 90_000,
    ...(input.hooks.signal ? { signal: input.hooks.signal } : {}),
  });
  const parsed = parseDriverJson(run.stdout);
  if (!run.ok || !parsed?.ok || typeof parsed.themes !== "object" || parsed.themes === null) {
    throw new VoxPipelineError(
      "themes_unavailable",
      "The clone's theme library could not be read, so there is no look to choose from.",
    );
  }
  return parsed.themes as Record<string, Record<string, string>>;
}

async function composePrompts(input: {
  python: string;
  cwd: string;
  runId: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  style: VoxStyle;
  beats: VoxBeat[];
  hooks: PipelineHooks;
}): Promise<void> {
  const shots = input.beats.flatMap((beat) =>
    beat.shots.map((shot) => ({
      key: shot.key,
      scene: shot.scene,
      title: beat.title,
      background: beat.background,
      withTitle: shot.title,
    })),
  );
  const specPath = writeSpec(input.runId, "prompts", {
    aspect: input.aspectRatio,
    style: {
      idiom: input.style.idiom,
      palette: input.style.palette,
      typeStyle: input.style.typeStyle,
      finish: input.style.finish,
    },
    shots,
  });
  const run = await runVoxDriver({
    python: input.python,
    operation: "prompts",
    specPath,
    cwd: input.cwd,
    timeoutMs: 90_000,
    ...(input.hooks.signal ? { signal: input.hooks.signal } : {}),
  });
  const parsed = parseDriverJson(run.stdout);
  if (!run.ok || !parsed?.ok || !Array.isArray(parsed.prompts)) {
    throw new VoxPipelineError(
      "prompts_unavailable",
      "The clone's collage prompt composer could not be run, so there are no poster prompts.",
    );
  }
  const byKey = new Map(
    (parsed.prompts as Array<Record<string, unknown>>).map((entry) => [
      String(entry.key ?? ""),
      String(entry.prompt ?? ""),
    ]),
  );
  for (const beat of input.beats) {
    for (const shot of beat.shots) {
      shot.imagePrompt = byKey.get(shot.key) ?? "";
      shot.negativePrompt = "";
    }
  }
  input.hooks.emit("prompts.completed", { count: byKey.size });
}


async function assemble(input: {
  python: string;
  cwd: string;
  runId: string;
  hooks: PipelineHooks;
}): Promise<
  | { ok: true; final: string; duration: number; width: number; height: number; size: number }
  | { ok: false; reason: string }
> {
  const specPath = writeSpec(input.runId, "assemble", {
    root: resolveInWorkspace(input.runId, "."),
    projectDir: ".",
  });
  // ffmpeg is chatty when it is unhappy, and every line here becomes an SSE
  // frame, so the stream carries enough to diagnose a failed render and stops.
  let progressLines = 0;
  const run = await runVoxDriver({
    python: input.python,
    operation: "assemble",
    specPath,
    cwd: input.cwd,
    timeoutMs: 20 * 60_000,
    ...(input.hooks.signal ? { signal: input.hooks.signal } : {}),
    onLine: (line) => {
      progressLines += 1;
      if (progressLines > 40) return;
      input.hooks.emit("assembly.progress", { line: line.slice(0, 300) });
    },
  });
  const parsed = parseDriverJson(run.stdout);
  if (!run.ok || !parsed?.ok) {
    return {
      ok: false,
      reason: String(
        parsed?.error ??
          (run.timedOut
            ? "The final render timed out."
            : `The final render failed. ${run.stderr.split("\n").slice(-3).join(" ").slice(0, 400)}`),
      ),
    };
  }
  const final = String(parsed.final ?? "");
  const duration = Number(parsed.duration ?? 0);
  const size = Number(parsed.size ?? 0);
  // "Done" means rendered: a run only reports a film when ffprobe can read a
  // real video stream of real length out of the file it just wrote.
  if (!final || !fs.existsSync(final) || duration <= 0.5 || size <= 0 || parsed.codec !== "h264") {
    return {
      ok: false,
      reason:
        "The final render produced a file that ffprobe could not read as an H.264 video, so the film is not usable.",
    };
  }
  return {
    ok: true,
    final,
    duration,
    width: Number(parsed.width ?? 0),
    height: Number(parsed.height ?? 0),
    size,
  };
}

export function safeFilename(title: string): string {
  return (
    title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "vox-director-film"
  );
}

/** Everything a chat reply needs to say about a finished film. */
export function describeProduction(production: VoxProduction): {
  runtime: number;
  shotCount: number;
  posterCount: number;
} {
  return {
    runtime: Math.round(productionDuration(production)),
    shotCount: productionShots(production).length,
    posterCount: production.renderPlan.posterCount,
  };
}
