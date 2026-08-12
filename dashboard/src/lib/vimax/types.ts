// The production a ViMax run builds, and the shape it is stored in.
//
// This is a port of the pydantic interfaces in the cloned ViMax repository
// (`vimax/interfaces/*.py`) — Scene, CharacterInScene, ShotDescription, Camera —
// kept structurally faithful so a production planned here stays legible to the
// upstream renderer: same decomposition of a shot into first frame, motion and
// last frame, same variation grades, same camera reuse across shots.
//
// The whole production is the artifact's source, so reopening a film never
// needs the model again, and a follow-up revision forks the same artifact.

export const VIMAX_PRODUCTION_SCHEMA_VERSION = 1;

/** A drawn frame, stored as its own image artifact and referenced by id. */
export interface VimaxImageRef {
  artifactId: string;
  /** The prompt the frame was drawn from, so a redraw is reproducible. */
  prompt: string;
  width: number | null;
  height: number | null;
}

/**
 * A character as ViMax models one: features that never change across the film
 * are separated from the ones that do, because the first are what keep a face
 * consistent between shots and the second are what a costume change may alter.
 */
export interface VimaxCharacter {
  idx: number;
  identifier: string;
  /** False for a voice-only or off-screen character — it is never drawn. */
  isVisible: boolean;
  staticFeatures: string;
  dynamicFeatures: string | null;
  /** The reference portrait every frame this character appears in is drawn from. */
  portrait: VimaxImageRef | null;
}

export interface VimaxScene {
  idx: number;
  isLast: boolean;
  /** Screenplay slugline, e.g. "EXT. SCHOOL GYM - DAY". */
  heading: string;
  location: string;
  timeOfDay: string;
  atmosphere: string;
  characterIdxs: number[];
  /** The scene's screenplay: action lines and dialogue. */
  script: string;
}

export type VimaxVariation = "large" | "medium" | "small";

export interface VimaxFrame {
  description: string;
  visibleCharacterIdxs: number[];
  image: VimaxImageRef | null;
}

export interface VimaxDialogueLine {
  speaker: string;
  line: string;
  emotion: string;
}

/**
 * One shot. `firstFrame`/`motion`/`lastFrame` is ViMax's decomposition: an
 * image model draws the first frame, and a video model animates towards the
 * last one along the motion description. Without a video backend the same
 * three fields still describe the shot completely, which is what the animatic
 * plays and what a later render would consume unchanged.
 */
export interface VimaxShot {
  /** Position in the finished film, across all scenes. */
  idx: number;
  sceneIdx: number;
  /** Position within its own scene, as the storyboard artist numbered it. */
  shotInScene: number;
  /** Camera position, reused across shots wherever ViMax's rules allow. */
  camIdx: number;
  isLast: boolean;
  visualDescription: string;
  audioDescription: string;
  firstFrame: VimaxFrame;
  lastFrame: VimaxFrame;
  motion: string;
  variation: VimaxVariation;
  variationReason: string;
  durationSeconds: number;
  dialogue: VimaxDialogueLine[];
  narration: string | null;
  /** Exactly what would be sent to a video generator to render this shot. */
  videoPrompt: string;
}

export type VimaxProductionStatus = "planned" | "storyboarded" | "rendered";

/**
 * Whether this production was rendered to video, and by what. ViMax's own
 * renderers need a paid image/video API and ffmpeg; Breadboard draws the
 * storyboard through its configured provider and plays the result as an
 * animatic, so a run always ends in something watchable and records honestly
 * which of the two it is.
 */
/** The encoded film, when one was produced. */
export interface VimaxVideoRef {
  artifactId: string;
  filename: string;
  durationSeconds: number;
  width: number;
  height: number;
  shotCount: number;
}

export interface VimaxRenderPlan {
  imageBackend: "breadboard-provider" | "none";
  /** Why the frames look the way they do — or why there are none. */
  imageBackendReason?: string;
  /**
   * What produced the video file. `ffmpeg-animatic` encodes the drawn frames
   * into a real MP4 with the storyboard's own timings; `none` means no video
   * file was produced, and the reason says why.
   */
  videoBackend: "none" | "ffmpeg-animatic";
  /** Why the video is what it is, in the user's words. */
  videoBackendReason: string;
  /** The video artifact, when one was encoded. */
  video?: VimaxVideoRef | null;
  totalDurationSeconds: number;
  shotCount: number;
  drawnFrameCount: number;
}

export interface VimaxProduction {
  schemaVersion: number;
  id: string;
  title: string;
  logline: string;
  /** The user's seed: an idea, or the screenplay in script2video mode. */
  brief: string;
  mode: "idea2video" | "script2video";
  style: string;
  userRequirement: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  /** The narrative the screenwriter developed. Empty in script2video mode. */
  story: string;
  characters: VimaxCharacter[];
  scenes: VimaxScene[];
  shots: VimaxShot[];
  renderPlan: VimaxRenderPlan;
  status: VimaxProductionStatus;
  createdAt: string;
  /** Every brief this production has been through, oldest first. */
  revisions: string[];
}

export function shotsForScene(production: VimaxProduction, sceneIdx: number): VimaxShot[] {
  return production.shots.filter((shot) => shot.sceneIdx === sceneIdx);
}

export function characterByIdx(
  production: VimaxProduction,
  idx: number,
): VimaxCharacter | null {
  return production.characters.find((character) => character.idx === idx) ?? null;
}

/** Total runtime of the film, in seconds. */
export function productionDuration(production: VimaxProduction): number {
  return production.shots.reduce((total, shot) => total + shot.durationSeconds, 0);
}
