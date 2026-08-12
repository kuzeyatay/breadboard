// The ViMax production pipeline.
//
//   story -> screenplay -> characters -> storyboard -> frames -> imagery -> film
//
// This is the shape of ViMax's own Idea2Video pipeline (`pipelines/
// idea2video_pipeline.py`): the screenwriter develops the idea, the script is
// cut into scenes, characters are extracted once so they stay consistent, each
// scene is storyboarded on its own, and every shot is decomposed into a first
// frame, a motion and a last frame before anything is drawn.
//
// Two deliberate differences from upstream. Scene storyboarding runs
// concurrently, because each scene is independent once the characters are
// fixed. And drawing is injected as a callback rather than imported, so the
// pipeline can be exercised end to end without a provider.

import { randomUUID } from "node:crypto";
import { videoPromptForShot, charactersBlock, framePrompt, portraitPrompt } from "./prompts.ts";
import {
  decomposeShot,
  describeScript,
  designStoryboard,
  developStory,
  extractCharacters,
  writeScenes,
  type ModelTarget,
} from "./model-client.ts";
import { VIMAX_PRODUCTION_SCHEMA_VERSION } from "./types.ts";
import type {
  VimaxCharacter,
  VimaxProduction,
  VimaxScene,
  VimaxShot,
} from "./types.ts";
import type { VimaxRequest } from "./identity.ts";

/** Ceilings that keep one run from turning into an unbounded image bill. */
const MAX_PORTRAITS = 8;
const MAX_DRAWN_FRAMES = 14;
const DEFAULT_STYLE = "Cinematic";

export interface DrawnImage {
  artifactId: string;
  width: number | null;
  height: number | null;
  /** The model that drew it, recorded on the film. */
  backend?: string;
}

/** Drawing one image either produced it, or explains why it did not. */
export type DrawResult =
  | { ok: true; image: DrawnImage }
  | { ok: false; reason: string; exhausted: boolean };

export interface PipelineHooks {
  emit(type: string, payload?: Record<string, unknown>): void;
  /**
   * Draw one image. Imagery is best-effort by design — a refused frame must
   * never cost the film, because the written production is already complete
   * without it — but a failure must always come back with its reason, and say
   * whether the provider is worth asking again.
   */
  drawImage?: (input: {
    prompt: string;
    title: string;
    kind: "portrait" | "frame";
    /** Reference image to edit from, when the frame has one obvious subject. */
    referenceArtifactId?: string | null;
  }) => Promise<DrawResult>;
  signal: AbortSignal;
}

function assertLive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("aborted");
}

function sceneScriptBundle(scenes: VimaxScene[]): string {
  return scenes
    .map((scene) => `${scene.heading || `SCENE ${scene.idx + 1}`}\n\n${scene.script}`)
    .join("\n\n---\n\n");
}

export async function produceFilm(input: {
  request: VimaxRequest;
  target: ModelTarget;
  hooks: PipelineHooks;
  /**
   * A summary of the film this run revises, when the conversation already has
   * one. The run forks that artifact, so the screenwriter is shown what is
   * being revised rather than writing something unrelated into its next version.
   */
  previousFilm?: string;
}): Promise<VimaxProduction> {
  const { request, target, hooks } = input;
  const { emit, signal } = hooks;

  // --- 1. Story ------------------------------------------------------------
  let title = "";
  let logline = "";
  let story = "";
  let style = request.style ?? "";

  if (request.mode === "idea2video") {
    emit("story.started", { revising: Boolean(input.previousFilm) });
    const draft = await developStory(target, {
      idea: request.brief,
      userRequirement: request.userRequirement,
      ...(input.previousFilm ? { previousFilm: input.previousFilm } : {}),
    });
    title = draft.title;
    logline = draft.logline;
    story = draft.story;
    style = request.style ?? (draft.style || DEFAULT_STYLE);
    emit("story.completed", { title, logline, wordCount: story.split(/\s+/).length });
  } else {
    emit("story.started", { mode: "script2video" });
    const described = await describeScript(target, request.brief);
    title = described.title;
    logline = described.logline;
    style = request.style ?? (described.style || DEFAULT_STYLE);
    emit("story.completed", { title, logline, wordCount: 0 });
  }
  assertLive(signal);

  // --- 2. Screenplay -------------------------------------------------------
  emit("scenes.started");
  const sceneList = await writeScenes(target, {
    story: request.mode === "idea2video" ? story : request.brief,
    userRequirement: request.userRequirement,
  });
  const scenes: VimaxScene[] = sceneList.scenes.map((scene, index) => ({
    idx: index,
    isLast: index === sceneList.scenes.length - 1,
    heading: scene.heading || `SCENE ${index + 1}`,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    atmosphere: scene.atmosphere,
    characterIdxs: [],
    script: scene.script,
  }));
  emit("scenes.completed", {
    sceneCount: scenes.length,
    headings: scenes.map((scene) => scene.heading),
  });
  assertLive(signal);

  // --- 3. Characters -------------------------------------------------------
  emit("characters.started");
  const script = sceneScriptBundle(scenes);
  const characterList = await extractCharacters(target, script);
  const characters: VimaxCharacter[] = characterList.characters.map((character, index) => ({
    idx: index,
    identifier: character.identifier,
    isVisible: character.isVisible,
    staticFeatures: character.staticFeatures,
    dynamicFeatures: character.isVisible ? character.dynamicFeatures : null,
    portrait: null,
  }));
  // A character belongs to a scene when the scene's script names them.
  for (const scene of scenes) {
    scene.characterIdxs = characters
      .filter((character) => scene.script.includes(character.identifier))
      .map((character) => character.idx);
  }
  emit("characters.completed", {
    characters: characters.map((character) => ({
      identifier: character.identifier,
      isVisible: character.isVisible,
    })),
  });
  assertLive(signal);

  const charactersText = charactersBlock(characters);

  // --- 4. Storyboard -------------------------------------------------------
  emit("storyboard.started", { sceneCount: scenes.length });
  const boards = await Promise.all(
    scenes.map(async (scene) => {
      const board = await designStoryboard(target, {
        script: `${scene.heading}\n\n${scene.script}`,
        charactersText,
        userRequirement: request.userRequirement,
      });
      emit("storyboard.scene", { sceneIdx: scene.idx, shotCount: board.shots.length });
      return { scene, board };
    }),
  );
  assertLive(signal);

  // --- 5. Shot decomposition ----------------------------------------------
  const shots: VimaxShot[] = [];
  for (const { scene, board } of boards) {
    for (const [shotInScene, planned] of board.shots.entries()) {
      shots.push({
        idx: shots.length,
        sceneIdx: scene.idx,
        shotInScene,
        camIdx: planned.camIdx,
        isLast: false,
        visualDescription: planned.visualDescription,
        audioDescription: planned.audioDescription,
        firstFrame: { description: "", visibleCharacterIdxs: [], image: null },
        lastFrame: { description: "", visibleCharacterIdxs: [], image: null },
        motion: "",
        variation: "small",
        variationReason: "",
        durationSeconds: planned.durationSeconds,
        dialogue: planned.dialogue,
        narration: planned.narration,
        videoPrompt: "",
      });
    }
  }
  if (shots.length === 0) throw new Error("no_shots_planned");
  shots[shots.length - 1].isLast = true;

  emit("frames.started", { shotCount: shots.length });
  await Promise.all(
    shots.map(async (shot) => {
      const decomposition = await decomposeShot(target, {
        visualDescription: shot.visualDescription,
        charactersText,
      });
      shot.firstFrame = {
        description: decomposition.firstFrameDescription,
        visibleCharacterIdxs: decomposition.firstFrameCharacterIdxs.filter(
          (idx) => idx < characters.length,
        ),
        image: null,
      };
      shot.lastFrame = {
        description: decomposition.lastFrameDescription,
        visibleCharacterIdxs: decomposition.lastFrameCharacterIdxs.filter(
          (idx) => idx < characters.length,
        ),
        image: null,
      };
      shot.motion = decomposition.motion;
      shot.variation = decomposition.variation;
      shot.variationReason = decomposition.variationReason;
      shot.videoPrompt = videoPromptForShot({
        motion: decomposition.motion,
        firstFrameDescription: decomposition.firstFrameDescription,
        lastFrameDescription: decomposition.lastFrameDescription,
        audioDescription: shot.audioDescription,
        style,
        durationSeconds: shot.durationSeconds,
      });
    }),
  );
  emit("frames.completed", { shotCount: shots.length });
  assertLive(signal);

  // --- 6. Imagery ----------------------------------------------------------
  let drawnFrameCount = 0;
  const draw = request.images ? hooks.drawImage : undefined;

  // The first reason drawing failed, kept so the film can say what happened
  // instead of arriving silently unillustrated.
  let imageFailure = "";
  let exhausted = false;

  if (draw) {
    const drawable = characters.filter((character) => character.isVisible).slice(0, MAX_PORTRAITS);
    emit("portraits.started", { count: drawable.length });
    // Portraits are drawn one at a time: they are the reference every frame is
    // built against, and a provider that is rate limiting is better slowed than
    // failed.
    for (const character of drawable) {
      if (exhausted) break;
      assertLive(signal);
      const prompt = portraitPrompt({ character, style });
      const drawn = await draw({
        prompt,
        title: `${character.identifier} — reference portrait`,
        kind: "portrait",
      });
      if (drawn.ok) {
        character.portrait = {
          artifactId: drawn.image.artifactId,
          prompt,
          width: drawn.image.width,
          height: drawn.image.height,
        };
        emit("portrait.drawn", {
          identifier: character.identifier,
          artifactId: drawn.image.artifactId,
        });
      } else {
        if (!imageFailure) imageFailure = drawn.reason;
        // A provider that has run out will refuse every remaining image too.
        // Asking it forty more times only makes the failure slower.
        if (drawn.exhausted) {
          exhausted = true;
          emit("imagery.unavailable", { reason: drawn.reason });
        }
      }
    }
    emit("portraits.completed", {
      drawn: characters.filter((character) => character.portrait).length,
    });

    const frameBudget = exhausted ? [] : shots.slice(0, MAX_DRAWN_FRAMES);
    emit("storyboardFrames.started", {
      count: frameBudget.length,
      skipped: shots.length - frameBudget.length,
    });
    for (const shot of frameBudget) {
      if (exhausted) break;
      assertLive(signal);
      const scene = scenes[shot.sceneIdx];
      const inFrame = shot.firstFrame.visibleCharacterIdxs
        .map((idx) => characters.find((character) => character.idx === idx))
        .filter((character): character is VimaxCharacter => Boolean(character));
      const prompt = framePrompt({
        frameDescription: shot.firstFrame.description,
        sceneHeading: scene?.heading ?? "",
        atmosphere: scene?.atmosphere ?? "",
        style,
        aspectRatio: request.aspectRatio,
        characters: inFrame,
      });
      // One subject with a portrait means the frame can be edited from that
      // portrait, which is what keeps a face the same face across shots.
      const reference =
        inFrame.length === 1 && inFrame[0].portrait ? inFrame[0].portrait.artifactId : null;
      const drawn = await draw({
        prompt,
        title: `Shot ${shot.idx + 1} — first frame`,
        kind: "frame",
        referenceArtifactId: reference,
      });
      if (drawn.ok) {
        shot.firstFrame.image = {
          artifactId: drawn.image.artifactId,
          prompt,
          width: drawn.image.width,
          height: drawn.image.height,
        };
        drawnFrameCount += 1;
        emit("frame.drawn", { shotIdx: shot.idx, artifactId: drawn.image.artifactId });
      } else {
        if (!imageFailure) imageFailure = drawn.reason;
        if (drawn.exhausted) {
          exhausted = true;
          emit("imagery.unavailable", { reason: drawn.reason });
        }
      }
    }
    emit("storyboardFrames.completed", {
      drawn: drawnFrameCount,
      ...(imageFailure ? { failure: imageFailure } : {}),
    });
  }

  // --- 7. The film ---------------------------------------------------------
  const totalDurationSeconds = shots.reduce((total, shot) => total + shot.durationSeconds, 0);
  const production: VimaxProduction = {
    schemaVersion: VIMAX_PRODUCTION_SCHEMA_VERSION,
    id: `vimax_${randomUUID().replaceAll("-", "")}`,
    title: title || "Untitled",
    logline,
    brief: request.brief,
    mode: request.mode,
    style: style || DEFAULT_STYLE,
    userRequirement: request.userRequirement,
    aspectRatio: request.aspectRatio,
    story,
    characters,
    scenes,
    shots,
    renderPlan: {
      imageBackend: drawnFrameCount > 0 ? "breadboard-provider" : "none",
      imageBackendReason: !request.images
        ? "Frames were not drawn: this run was started with --no-images."
        : imageFailure
          ? `No frames could be drawn. ${imageFailure}`
          : "",
      videoBackend: "none",
      videoBackendReason: "",
      totalDurationSeconds,
      shotCount: shots.length,
      drawnFrameCount,
    },
    status: drawnFrameCount > 0 ? "storyboarded" : "planned",
    createdAt: new Date().toISOString(),
    revisions: [request.brief],
  };
  return production;
}
