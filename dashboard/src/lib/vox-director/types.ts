// The shape of a Vox Director production.
//
// Structurally faithful to upstream's `beats.json` (see `vox-director/SKILL.md`
// § "beats.json schema") because that is the document every one of the clone's
// stage scripts reads: a production written here can be dropped into
// `vox-director/out/<project>/beats.json` and driven by hand. The extra fields
// Breadboard adds are the ones upstream leaves to the operator — the resolved
// prompts, the measured narration durations, and the record of which backend
// actually produced each piece.

/** The LOOK layer: one of the clone's theme presets, or a composed equivalent. */
export interface VoxStyle {
  /** The preset name from `styles.THEME_PRESETS`, or "custom". */
  theme: string;
  /** The collage idiom — a `STYLE_LIBRARY` key, or a described one. */
  idiom: string;
  palette: string;
  typeStyle: string;
  finish: string;
  mood: string;
  /** Motion amplitude, upstream's `motion_style`. */
  motionStyle: "calm" | "punchy" | "max";
  /** Why this look fits this topic. Shown on the card and in the artifact. */
  rationale: string;
  /** Upstream's caption treatment: a clean white subtitle, or cut-out paper. */
  captionStyle: "white" | "paper";
}

/**
 * One animated element cut out of a poster.
 *
 * `bbox` is `[x0, y0, x1, y1]` on a 0–1000 grid over the poster, not pixels:
 * the model never sees the rendered size, and a normalised box is trivially
 * containment-checked. Upstream's own advice for picking these by hand is to
 * "overlay a labeled grid on the poster and read coordinates", which is the
 * same idea.
 */
export interface VoxElement {
  name: string;
  bbox: [number, number, number, number];
  /** `crop` keeps the rectangle; `cutout` keys the flat background to alpha. */
  mode: "crop" | "cutout";
  /** The keyframe helper in `vox-director/scripts/motion.py` that brings it in. */
  entrance: "fly_in" | "slap" | "drop" | "pop_settle";
  /** Which edge a `fly_in` comes from. Ignored by the other entrances. */
  from: "L" | "R" | "T" | "B";
  /** Seconds into the shot when the element starts arriving. */
  start: number;
  /** Degrees of spin on the way in; the paper "snap" comes from the overshoot. */
  spin: number;
}

/** How one poster moves: its pieces, its camera, and its procedural VFX. */
export interface VoxMotionPlan {
  elements: VoxElement[];
  /** Slow push over the shot, as a multiplier (1.0 = locked off). */
  cameraZoom: number;
  /** Impact shake on each entrance — upstream's exponential-decay sine. */
  cameraShake: boolean;
  /** Drifting paper scraps over the whole shot. */
  confetti: boolean;
  /** A rotating paper starburst behind the elements, for a payoff beat. */
  starburst: boolean;
}

export interface VoxPosterRef {
  /** The image artifact this poster was stored as, when storage was available. */
  artifactId: string | null;
  /** Path inside the run workspace, POSIX-separated. */
  relativePath: string;
  width: number;
  height: number;
  /** What drew it: a ComfyUI checkpoint, or the local title-card renderer. */
  backend: string;
  /**
   * Where the headline actually sits, on the 0-1000 grid, when Breadboard drew
   * the poster itself and therefore knows. Null for a poster a model drew.
   */
  titleBox: [number, number, number, number] | null;
  /** Everything needed to draw it again. */
  render: {
    prompt: string;
    negativePrompt: string;
    checkpoint: string;
    seed: number;
    steps: number;
    cfg: number;
    samplerName: string;
    scheduler: string;
    width: number;
    height: number;
  } | null;
}

export interface VoxShot {
  /** Upstream's per-beat shot letter: `a` is the wide, `b` the detail cut-in. */
  id: string;
  /** `<beatId><shotId>` — the key the clone's scripts address a shot by. */
  key: string;
  /** Planned seconds on screen. Assembly may extend the last shot of a beat. */
  duration: number;
  shotSize: "EST_WIDE" | "WIDE" | "MEDIUM" | "CLOSE" | "DETAIL";
  cameraMove: "static" | "push_in" | "pull_out" | "pan" | "tilt" | "parallax" | "element";
  /** The scene as separate cut-out pieces, which is what makes it a collage. */
  scene: string;
  /** What moves inside the frame. Upstream's energy engine. */
  elementMotion: string;
  /** Whether the beat's headline is baked into this poster. Wide shots only. */
  title: boolean;
  imagePrompt: string;
  negativePrompt: string;
  poster: VoxPosterRef | null;
  motionPlan: VoxMotionPlan | null;
  /** Which renderer produced the clip, once one has. */
  clipBackend: "local" | "scrapbook" | "kenburns" | "still" | null;
  clipRelativePath: string | null;
  /** Why the clip is not what was planned, when it is not. */
  clipNote: string;
}

export interface VoxBeat {
  id: number;
  /** The baked cut-out headline. Short, bold, two or three words. */
  title: string;
  narration: string;
  /** One bold flat paper background colour for this beat. */
  background: string;
  /** The tone anchor, upstream's `feel`. */
  feel: string;
  /** The hook pattern, on beat 1 only. Empty elsewhere. */
  hook: string;
  shots: VoxShot[];
  /** Seconds of narration actually rendered, measured with ffprobe. */
  narrationSeconds: number;
  narrationRelativePath: string | null;
}

export interface VoxVideoRef {
  artifactId: string | null;
  relativePath: string;
  filename: string;
  durationSeconds: number;
  width: number;
  height: number;
  shotCount: number;
  sizeBytes: number;
}

export interface VoxRenderPlan {
  /** "comfyui" / "title-card" / "none". */
  imageBackend: string;
  imageBackendReason: string;
  posterCount: number;
  motionBackend: string;
  motionBackendReason: string;
  narrationBackend: string;
  narrationVoice: string;
  narrationBackendReason: string;
  musicSource: string;
  musicReason: string;
  video: VoxVideoRef | null;
  videoReason: string;
}

export interface VoxProduction {
  id: string;
  title: string;
  /** The topic, exactly as the person wrote it. */
  brief: string;
  /** One sentence on what this film argues. */
  logline: string;
  /** The narrative arc from `references/beat-layer.md` §1. */
  arc: string;
  /** How it lands: `hard_cut`, `quick_cta`, or `loop_close`. */
  ending: string;
  language: string;
  /** Target runtime the plan was written to. */
  duration: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  style: VoxStyle;
  /** The seed every poster was drawn from, when one was fixed. */
  seed: number | null;
  beats: VoxBeat[];
  renderPlan: VoxRenderPlan;
  /** The run whose workspace holds the files this production points at. */
  runId: string;
  /** Each brief that produced a version of this production, oldest first. */
  revisions: string[];
  createdAt: string;
}

/** Every shot in order, which is the timeline the assembly walks. */
export function productionShots(production: VoxProduction): VoxShot[] {
  return production.beats.flatMap((beat) => beat.shots);
}

/**
 * How long the finished film runs.
 *
 * A beat is at least as long as its narration plus a half-second tail — the
 * same rule `vox-director/scripts/assemble.py` applies when it extends a beat's
 * last shot — so a plan whose shots are shorter than the voice still reports
 * the length the file will actually have.
 */
export function productionDuration(production: VoxProduction): number {
  const TAIL = 0.5;
  return production.beats.reduce((total, beat) => {
    const planned = beat.shots.reduce((sum, shot) => sum + shot.duration, 0);
    const needed = beat.narrationSeconds > 0 ? beat.narrationSeconds + TAIL : 0;
    return total + Math.max(planned, needed);
  }, 0);
}
