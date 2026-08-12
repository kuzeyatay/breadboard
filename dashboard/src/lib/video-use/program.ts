// The edit program: what an edited video artifact *is*, between renders.
//
// A studio pass never edits the previous render. It edits the program, and the
// program is replayed against the original source. That is the difference
// between an editor and a filter stack: three passes of "a bit tighter" through
// a filter stack is three generations of re-encoding, drifting colour and
// compounding artefacts, and there is no way back to the take. Replaying a
// program means the tenth revision is exactly as clean as the first, "undo" is
// just an older program, and "revert to the original" is the empty program.
//
// So this module owns two things: the shape of a program, and the arithmetic
// that turns one into the EDL the clone's renderer reads. Both are pure — the
// planner proposes, this validates, and nothing here touches a disk.

import {
  composeGrade,
  isAspectRatio,
  validateGrade,
  VideoFilterError,
  type AspectRatio,
} from "./filters.ts";

/** The shortest cut worth keeping. Below this it is a frame, not a moment. */
const MIN_RANGE_SECONDS = 0.15;
const MAX_RANGES = 120;

export interface VideoEditRange {
  /** Seconds into the ORIGINAL source, always. Never into a previous render. */
  start: number;
  end: number;
  /** Why this range is in the cut, in the planner's own words. */
  reason: string;
}

/**
 * Whole-timeline changes, applied in one pass after the cut is assembled.
 *
 * These live outside the EDL because the clone's renderer has no field for
 * them: it assembles, grades, overlays and captions, and every one of those is
 * per-segment or per-frame. Speed, loudness and fades are properties of the
 * finished piece, so Breadboard applies them itself once, at the end.
 */
export interface VideoTransform {
  /** 1 is unchanged. 2 plays twice as fast, audio pitch-corrected. */
  speed: number;
  mute: boolean;
  /** Gain in dB on top of the renderer's loudness normalization. 0 = leave it. */
  volumeDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  reverse: boolean;
}

export const IDENTITY_TRANSFORM: VideoTransform = {
  speed: 1,
  mute: false,
  volumeDb: 0,
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
  reverse: false,
};

export interface VideoEditHistoryEntry {
  /** The artifact version this pass produced. */
  version: number;
  /** What the person asked for. */
  prompt: string;
  /** What the editor says it did. */
  summary: string;
  at: string;
}

export interface VideoEditProgram {
  version: 1;
  ranges: VideoEditRange[];
  /** A preset name, a validated filter chain, or null for "leave it alone". */
  grade: string | null;
  aspect: AspectRatio;
  subtitles: "none" | "burn";
  transform: VideoTransform;
  history: VideoEditHistoryEntry[];
}

/** The program that means "the source, untouched". */
export function identityProgram(durationSeconds: number): VideoEditProgram {
  return {
    version: 1,
    ranges: [{ start: 0, end: round(durationSeconds), reason: "The whole source." }],
    grade: null,
    aspect: "original",
    subtitles: "none",
    transform: { ...IDENTITY_TRANSFORM },
    history: [],
  };
}

export class VideoProgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoProgramError";
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Validate what a planner proposed against the source it claims to describe.
 *
 * Everything here is a clamp or a refusal rather than a repair-and-continue,
 * with one exception: ranges that run past the end of the source are trimmed to
 * it. A model that says `end: 60.5` on a 60s clip meant "to the end", and
 * failing the whole plan over a rounding error would be pedantry.
 */
export function validatePlan(
  value: unknown,
  context: { durationSeconds: number; hasTranscript: boolean },
): Omit<VideoEditProgram, "history" | "version"> & { summary: string } {
  if (!value || typeof value !== "object") {
    throw new VideoProgramError("The editor did not return an edit plan.");
  }
  const plan = value as Record<string, unknown>;
  const duration = Math.max(0.1, context.durationSeconds);

  const rawRanges = Array.isArray(plan.ranges) ? plan.ranges : [];
  if (!rawRanges.length) {
    throw new VideoProgramError("The edit plan kept no part of the video.");
  }
  if (rawRanges.length > MAX_RANGES) {
    throw new VideoProgramError(`An edit of ${rawRanges.length} cuts is beyond what this can render.`);
  }

  const ranges: VideoEditRange[] = [];
  for (const entry of rawRanges) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const start = finiteNumber(item.start);
    const end = finiteNumber(item.end);
    if (start === null || end === null) continue;
    const clampedStart = clamp(start, 0, duration);
    const clampedEnd = clamp(end, 0, duration);
    if (clampedEnd - clampedStart < MIN_RANGE_SECONDS) continue;
    ranges.push({
      start: round(clampedStart),
      end: round(clampedEnd),
      reason: typeof item.reason === "string" ? item.reason.slice(0, 400) : "",
    });
  }
  if (!ranges.length) {
    throw new VideoProgramError(
      "Every cut in the edit plan fell outside the video or was too short to keep.",
    );
  }

  let grade: string | null;
  try {
    grade = validateGrade(typeof plan.grade === "string" ? plan.grade : null);
  } catch (error) {
    throw new VideoProgramError(
      error instanceof VideoFilterError ? error.message : "The colour grade could not be read.",
    );
  }

  const aspect: AspectRatio = isAspectRatio(plan.aspect) ? plan.aspect : "original";

  // Burning captions needs word timings. Asking for them without a transcript
  // is not an error the person can act on mid-run, so the cut is delivered
  // without them and the run says so in its summary.
  const subtitles =
    plan.subtitles === "burn" && context.hasTranscript ? "burn" : "none";

  const rawTransform =
    plan.transform && typeof plan.transform === "object"
      ? (plan.transform as Record<string, unknown>)
      : {};

  const transform: VideoTransform = {
    speed: clamp(finiteNumber(rawTransform.speed) ?? 1, 0.25, 4),
    mute: rawTransform.mute === true,
    volumeDb: clamp(finiteNumber(rawTransform.volumeDb) ?? 0, -30, 20),
    fadeInSeconds: clamp(finiteNumber(rawTransform.fadeInSeconds) ?? 0, 0, 10),
    fadeOutSeconds: clamp(finiteNumber(rawTransform.fadeOutSeconds) ?? 0, 0, 10),
    reverse: rawTransform.reverse === true,
  };

  const summary =
    typeof plan.summary === "string" && plan.summary.trim()
      ? plan.summary.trim().slice(0, 600)
      : "Applied the requested changes.";

  return { ranges, grade, aspect, subtitles, transform, summary };
}

/** How long the cut runs before the speed change. */
export function programDurationSeconds(program: {
  ranges: VideoEditRange[];
  transform: VideoTransform;
}): number {
  const cut = program.ranges.reduce((total, range) => total + (range.end - range.start), 0);
  return round(cut / (program.transform.speed || 1));
}

/**
 * The clone's EDL, exactly as `SKILL.md` documents it. `sources` is a single
 * entry because a studio edit is always one source — multi-take assembly is the
 * clone's own workflow and needs a folder of footage, not one artifact.
 */
export interface CloneEdl {
  version: 1;
  sources: Record<string, string>;
  ranges: Array<{
    source: string;
    start: number;
    end: number;
    beat: string;
    quote: string;
    reason: string;
  }>;
  grade?: string;
  subtitles?: string;
  total_duration_s: number;
}

export function toCloneEdl(input: {
  program: Omit<VideoEditProgram, "history" | "version">;
  sourceKey: string;
  sourcePath: string;
  subtitlesPath?: string | null;
}): CloneEdl {
  const grade = composeGrade(input.program.aspect, input.program.grade);
  return {
    version: 1,
    sources: { [input.sourceKey]: input.sourcePath },
    ranges: input.program.ranges.map((range, index) => ({
      source: input.sourceKey,
      start: range.start,
      end: range.end,
      beat: `SEG${String(index + 1).padStart(2, "0")}`,
      quote: "",
      reason: range.reason,
    })),
    ...(grade ? { grade } : {}),
    ...(input.program.subtitles === "burn" && input.subtitlesPath
      ? { subtitles: input.subtitlesPath }
      : {}),
    total_duration_s: input.program.ranges.reduce(
      (total, range) => total + (range.end - range.start),
      0,
    ),
  };
}

/** Read a program back off an artifact's metadata, or fall back to identity. */
export function parseStoredProgram(
  value: unknown,
  durationSeconds: number,
): VideoEditProgram {
  if (!value || typeof value !== "object") return identityProgram(durationSeconds);
  const stored = value as Record<string, unknown>;
  try {
    const validated = validatePlan(stored, { durationSeconds, hasTranscript: true });
    const history = Array.isArray(stored.history)
      ? stored.history
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
          .map((entry) => ({
            version: finiteNumber(entry.version) ?? 1,
            prompt: typeof entry.prompt === "string" ? entry.prompt.slice(0, 4_000) : "",
            summary: typeof entry.summary === "string" ? entry.summary.slice(0, 600) : "",
            at: typeof entry.at === "string" ? entry.at : new Date().toISOString(),
          }))
          .slice(-60)
      : [];
    return {
      version: 1,
      ranges: validated.ranges,
      grade: validated.grade,
      aspect: validated.aspect,
      subtitles: validated.subtitles,
      transform: validated.transform,
      history,
    };
  } catch {
    // A stored program that no longer validates (a shorter source after a
    // revert, a field written by an older build) must not lock the artifact out
    // of the studio. The next edit starts from the whole video instead.
    return identityProgram(durationSeconds);
  }
}
