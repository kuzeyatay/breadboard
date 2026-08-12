// Validation for the one place a model's words become an ffmpeg filter chain.
//
// The EDL's `grade` field is documented by the clone as "a preset name or a raw
// ffmpeg filter", and raw is genuinely useful — a look is a filter chain and
// there is no smaller vocabulary that expresses one. But an ffmpeg filter chain
// is not inert. `metadata=print:file=…` writes a file. `movie=…` reads one.
// Bracket labels rewire the graph and can add inputs and outputs the caller
// never asked for. Handing a model's free text straight to `-vf` would make
// "make it warmer" a file-write primitive.
//
// So the chain is parsed and checked here before it reaches the renderer:
// known filter names only, no graph labels, no file arguments, and a character
// set that cannot smuggle a second option in. A chain that fails any of those
// is rejected outright rather than sanitized — a half-understood filter string
// is exactly the thing not to guess at.
//
// Pure and free of Node imports so the tests can exercise it directly.

/**
 * Filters that only ever transform the picture they are given. Chosen from what
 * the clone's own presets use plus the geometry and look filters an edit
 * instruction realistically asks for.
 *
 * Anything that opens a file, sources a stream, reads a device, or splits the
 * graph is absent on purpose, and absence is the security property: the list is
 * an allowlist, so a filter nobody vetted cannot arrive by being new.
 */
const ALLOWED_FILTERS = new Set([
  // colour and tone — the grade vocabulary
  "eq", "curves", "colorbalance", "colorchannelmixer", "colorlevels",
  "colortemperature", "colorcontrast", "colorcorrect", "hue", "lutyuv",
  "lutrgb", "lut3d", "negate", "exposure", "vibrance", "selectivecolor",
  "monochrome", "gradfun", "deband",
  // detail
  "unsharp", "gblur", "boxblur", "smartblur", "hqdn3d", "atadenoise", "noise",
  "vignette", "chromashift",
  // geometry
  "crop", "scale", "pad", "setsar", "setdar", "transpose", "hflip", "vflip",
  "rotate", "zoompan",
  // pixel plumbing the above sometimes needs
  "format", "fps", "zscale", "tonemap", "setparams",
]);

/** Arguments that name a file or a stream, in any filter. Never permitted. */
const FORBIDDEN_ARGUMENT = /\b(?:file|filename|f|src|source|path|url|i)\s*=\s*['"]?[^:,]*[/\\]/i;

/**
 * The characters a filter chain may contain. Notably absent: backslash (path
 * and escape), semicolon (graph separator), square brackets (pad labels),
 * double quote, backtick, dollar, and anything outside printable ASCII.
 */
const ALLOWED_CHARS = /^[A-Za-z0-9_.,:=+\-*/()%'@ ]+$/;

export class VideoFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoFilterError";
  }
}

/** The presets `grade.py` ships, addressable by name instead of by chain. */
export const GRADE_PRESETS = [
  "subtle",
  "neutral_punch",
  "warm_cinematic",
  "auto",
] as const;

export type GradePreset = (typeof GRADE_PRESETS)[number];

export function isGradePreset(value: string): value is GradePreset {
  return (GRADE_PRESETS as readonly string[]).includes(value);
}

/**
 * Split a chain on its top-level commas. Values may be single-quoted and those
 * quotes may contain commas (`curves=master='0/0 0.5/0.6, 1/1'`), so a plain
 * `split(",")` would cut a filter in half and then reject the halves.
 */
function splitChain(chain: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of chain) {
    if (character === "'") {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  if (quoted) throw new VideoFilterError("The filter chain has an unclosed quote.");
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Check a filter chain and return it normalized, or throw with a sentence that
 * says which filter was refused — the planner is shown the failure and gets one
 * chance to answer with something simpler, so the message is part of the loop.
 */
export function validateFilterChain(chain: string): string {
  const trimmed = chain.trim();
  if (!trimmed) throw new VideoFilterError("The filter chain is empty.");
  if (trimmed.length > 2_000) throw new VideoFilterError("The filter chain is too long.");
  if (!ALLOWED_CHARS.test(trimmed)) {
    throw new VideoFilterError(
      "The filter chain contains characters that are not allowed (paths, labels and quotes are refused).",
    );
  }

  const filters = splitChain(trimmed);
  if (!filters.length) throw new VideoFilterError("The filter chain is empty.");

  for (const filter of filters) {
    const match = /^([a-z0-9_]+)(?:=([\s\S]*))?$/i.exec(filter);
    if (!match) throw new VideoFilterError(`"${filter}" is not a filter this editor understands.`);
    const name = match[1].toLowerCase();
    const args = match[2] ?? "";
    if (!ALLOWED_FILTERS.has(name)) {
      throw new VideoFilterError(`The "${name}" filter is not available here.`);
    }
    if (FORBIDDEN_ARGUMENT.test(args)) {
      throw new VideoFilterError(`The "${name}" filter may not be given a file path.`);
    }
  }
  return filters.join(",");
}

/**
 * A grade the renderer will accept: a preset name passes through untouched (the
 * clone resolves it), anything else has to survive the chain check.
 */
export function validateGrade(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (isGradePreset(trimmed)) return trimmed;
  return validateFilterChain(trimmed);
}

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

export const ASPECT_RATIOS = ["original", "16:9", "9:16", "1:1", "4:5"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && (ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Long edge of the delivered frame, per aspect. 1080p everywhere. */
const ASPECT_DIMENSIONS: Record<Exclude<AspectRatio, "original">, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

/**
 * Reframing belongs *in* the grade chain rather than in a pass of its own,
 * because the renderer applies the grade inside each segment's `-vf` — which is
 * before subtitles are burned. Cropping afterwards would cut the captions off.
 *
 * Centre-crop to the target shape, then scale to the exact frame. `increase`
 * plus a crop keeps the frame filled at every source ratio instead of pillar-
 * boxing a landscape source that was asked to become vertical.
 */
export function aspectFilterChain(aspect: AspectRatio): string | null {
  if (aspect === "original") return null;
  const [width, height] = ASPECT_DIMENSIONS[aspect];
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "setsar=1",
  ].join(",");
}

/** Join a reframe and a look into the single chain the EDL's `grade` carries. */
export function composeGrade(
  aspect: AspectRatio,
  grade: string | null,
): string | null {
  const reframe = aspectFilterChain(aspect);
  if (!reframe) return grade;
  // "auto" is a sentinel the renderer resolves per segment, not a filter, so it
  // cannot be concatenated with one. A reframe wins and the look falls back to
  // the clone's own safe floor.
  const look = grade === "auto" ? "eq=contrast=1.03:saturation=0.98" : grade;
  return look ? `${reframe},${look}` : reframe;
}
