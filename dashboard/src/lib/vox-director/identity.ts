// The Vox Director agent's chat identity: the slash command that reaches it,
// and the parsing of a brief into a production request.
//
// Mirrors the ViMax / HyperFrames / Career Ops identity modules so every
// runtime agent is reached the same way — pick it from the Agents tab, prompt
// it in chat, and its own surface appears inline for that turn.

export const VOX_DIRECTOR_COMMAND = "/agents:vox-director";
export const VOX_DIRECTOR_AGENT_ID = "vox-director";
export const VOX_DIRECTOR_AGENT_NAME = "Vox Director";

export type VoxAspectRatio = "16:9" | "9:16" | "1:1";

/**
 * Which local renderer animates a beat's poster.
 *
 * `local` is upstream's element-level keyframe engine — the pieces fly in and
 * assemble, which is the look the skill exists for. `kenburns` is upstream's
 * pure-ffmpeg fallback: one slow push over the whole poster. `scrapbook` is the
 * lighter tilted-card assembler. `auto` means "the best one that works", which
 * is `local` with the other two underneath it.
 */
export type VoxMotionBackend = "auto" | "local" | "kenburns" | "scrapbook";

/**
 * A production runs from five seconds to a minute and a half. The floor is
 * where a hook plus a payoff still fit; the ceiling is where an accidental
 * "make me a documentary" would otherwise spend an hour of local rendering.
 */
export const VOX_MIN_DURATION_SECONDS = 5;
export const VOX_MAX_DURATION_SECONDS = 90;
export const VOX_DEFAULT_DURATION_SECONDS = 30;

/** ComfyUI's seed field is a uint32, so that is the range a `--seed` may take. */
export const VOX_MAX_SEED = 2 ** 32 - 1;

export interface VoxDirectorRequest {
  /** The topic, with the flags stripped out. */
  brief: string;
  /** Target runtime in seconds, already clamped to the supported range. */
  duration: number;
  aspectRatio: VoxAspectRatio;
  /**
   * A named upstream theme preset, or a free-form look. Null lets the art
   * director pick one from the clone's own library.
   */
  style: string | null;
  motion: VoxMotionBackend;
  /** False renders deterministic title-card posters and never asks ComfyUI. */
  images: boolean;
  /** False assembles with no music bed at all. */
  music: boolean;
  /** Fixed seed, so a production can be rendered again identically. */
  seed: number | null;
}

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them.
 *
 * Returns null when the message is not addressed to this agent. An empty string
 * means the command was typed on its own — the palette inserts the token first
 * and the person is still writing, so the caller waits rather than launching an
 * empty production.
 */
export function taskFromVoxDirectorCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:vox-director") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

/** Alias matching the ViMax spelling, for the surfaces that read a brief. */
export const briefFromVoxDirectorCommand = taskFromVoxDirectorCommand;

export function voxDirectorUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${VOX_DIRECTOR_COMMAND} ${trimmed}` : VOX_DIRECTOR_COMMAND;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp rather than reject. `--duration 3600` is a slip of the keyboard, not a
 * request worth failing, and a run that silently accepted it would spend an
 * hour of local rendering before anyone found out.
 */
export function clampVoxDuration(value: number): number {
  if (!Number.isFinite(value)) return VOX_DEFAULT_DURATION_SECONDS;
  return Math.round(clamp(value, VOX_MIN_DURATION_SECONDS, VOX_MAX_DURATION_SECONDS));
}

const MOTION_BACKENDS = new Set<VoxMotionBackend>(["auto", "local", "kenburns", "scrapbook"]);

/**
 * Split a prompt into the brief and its production shape. Options stay inline
 * flags so chat remains the only surface:
 *   `--duration 45`             target runtime, clamped to 5-90s
 *   `--vertical|--square|--landscape`  change the frame
 *   `--style "punk-zine"`       an upstream theme preset, or a look in words
 *   `--motion local|kenburns|scrapbook|auto`  which local renderer animates a beat
 *   `--images|--no-images`      render posters with ComfyUI, or use title cards
 *   `--music|--no-music`        lay a music bed under the narration, or do not
 *   `--seed 1234`               fix the poster seed so a run repeats exactly
 * Anything unrecognized stays part of the brief.
 *
 * `defaults` is the user's saved settings — where the production starts before
 * a flag is read. Every default has a flag that undoes it for one message,
 * because a preference you cannot override in a message is a trap.
 */
export function parseVoxDirectorRequest(
  task: string,
  defaults?: Partial<Omit<VoxDirectorRequest, "brief">>,
): VoxDirectorRequest {
  let duration = clampVoxDuration(defaults?.duration ?? VOX_DEFAULT_DURATION_SECONDS);
  let aspectRatio: VoxAspectRatio = defaults?.aspectRatio ?? "16:9";
  let style: string | null = defaults?.style ?? null;
  let motion: VoxMotionBackend = defaults?.motion ?? "local";
  let images = defaults?.images ?? true;
  let music = defaults?.music ?? true;
  let seed: number | null = defaults?.seed ?? null;

  const quoted = String.raw`"[^"]*"|[^\s]+`;

  const brief = task
    .replace(/(?:^|\s)--no-images\b/gi, () => {
      images = false;
      return " ";
    })
    .replace(/(?:^|\s)--images\b/gi, () => {
      images = true;
      return " ";
    })
    .replace(/(?:^|\s)--no-music\b/gi, () => {
      music = false;
      return " ";
    })
    .replace(/(?:^|\s)--music\b/gi, () => {
      music = true;
      return " ";
    })
    .replace(/(?:^|\s)--(?:vertical|portrait)\b/gi, () => {
      aspectRatio = "9:16";
      return " ";
    })
    .replace(/(?:^|\s)--square\b/gi, () => {
      aspectRatio = "1:1";
      return " ";
    })
    .replace(/(?:^|\s)--(?:landscape|wide)\b/gi, () => {
      aspectRatio = "16:9";
      return " ";
    })
    .replace(/(?:^|\s)--(?:duration|seconds|length)[= ](\d+(?:\.\d+)?)/gi, (_m, value: string) => {
      duration = clampVoxDuration(Number.parseFloat(value));
      return " ";
    })
    .replace(/(?:^|\s)--seed[= ](\d+)/gi, (_m, value: string) => {
      const parsed = Number.parseInt(value, 10);
      seed = Number.isFinite(parsed) ? clamp(parsed, 0, VOX_MAX_SEED) : null;
      return " ";
    })
    .replace(/(?:^|\s)--motion[= ]([a-z]+)/gi, (match: string, value: string) => {
      const chosen = value.toLowerCase() as VoxMotionBackend;
      // An unknown backend name stays part of the brief rather than becoming a
      // silent downgrade to a renderer nobody asked for.
      if (!MOTION_BACKENDS.has(chosen)) return match;
      motion = chosen;
      return " ";
    })
    .replace(new RegExp(String.raw`(?:^|\s)--style[= ](${quoted})`, "gi"), (_m, value: string) => {
      style = value.replace(/^"|"$/g, "").trim() || null;
      return " ";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

  return { brief, duration, aspectRatio, style, motion, images, music, seed };
}

/**
 * How many beats a production of this length wants, from the clone's own pacing
 * table (`references/beat-layer.md` §2): 30s → 6-8 beats, 60s → 10-12, every
 * beat split into two shots so something cuts every three to five seconds.
 */
export function beatCountForDuration(duration: number): { min: number; max: number } {
  const secondsPerBeat = 4.6;
  const centre = duration / secondsPerBeat;
  return {
    min: Math.max(2, Math.round(centre * 0.85)),
    max: Math.max(3, Math.min(14, Math.round(centre * 1.2))),
  };
}
