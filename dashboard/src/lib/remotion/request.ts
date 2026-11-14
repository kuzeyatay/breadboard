// The public payload of `video_render`, validated without importing a process
// module so the same checks run in the route, in node --test, and anywhere the
// client wants to preview them.

export const VIDEO_SKILL = "video";
/** The engine skill: multi-file projects, 3D and shaders, preview and revision. */
export const FILM_SKILL = "film";
/** Either skill opens the render tool. */
export const VIDEO_SKILLS: readonly string[] = [FILM_SKILL, VIDEO_SKILL];
export const VIDEO_TOOL = "video_render";

export const VIDEO_FRAME_RATES = [30, 60] as const;
export type VideoFrameRate = (typeof VIDEO_FRAME_RATES)[number];
export const MAX_NARRATION_LINES = 12;
export const MAX_PROJECT_FILES = 24;
export const MAX_VIDEO_SOURCE_BYTES = 96 * 1024;
export const MAX_VIDEO_SECONDS = 180;

export const VIDEO_FORMATS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const;
export type VideoFormat = keyof typeof VIDEO_FORMATS;

export const VIDEO_QUALITIES = ["draft", "standard"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

export class VideoRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VideoRequestError";
    this.code = code;
  }
}

export interface VideoRequest {
  title: string;
  description: string;
  /** The main file. Null only when revising an existing project without touching it. */
  code: string | null;
  /** Further source files, by path relative to the project. */
  files: Record<string, string>;
  /** A kept, editable project. Null renders once in a throwaway folder. */
  projectId: string | null;
  /** The structured plan of the video, as JSON text, saved as project.json. */
  plan: string | null;
  /** Render small and report on sampled frames instead of delivering. */
  preview: boolean;
  durationSeconds: number;
  durationInFrames: number;
  fps: VideoFrameRate;
  format: VideoFormat;
  quality: VideoQuality;
  music: VideoMusic | null;
  narration: VideoNarrationLine[];
}

/** A music bed: a YouTube link the user gave, or a search the model wrote. */
export interface VideoMusic {
  url: string | null;
  search: string | null;
  /** Where in the track to start. Null lets the server pick the strongest section. */
  startSeconds: number | null;
  /** 0 to 1. Null means the default, which is lower under narration. */
  volume: number | null;
  /** Seconds of fade at each end. Null means 0.4 in and 1.5 out. */
  fadeInSeconds: number | null;
  fadeOutSeconds: number | null;
}

export interface VideoNarrationLine {
  text: string;
  atSeconds: number;
}

const YOUTUBE_URL =
  /^https:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?[^\s]*\bv=|shorts\/|live\/|embed\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/;

export function musicFrom(value: unknown): VideoMusic | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new VideoRequestError("video_invalid_arguments", "music must be an object.");
  }
  const music = value as Record<string, unknown>;
  const url = typeof music.url === "string" && music.url.trim() ? music.url.trim() : null;
  const search = typeof music.search === "string" && music.search.trim() ? music.search.trim() : null;
  if ((url === null) === (search === null)) {
    throw new VideoRequestError("video_invalid_arguments", "music needs exactly one of url or search.");
  }
  if (url !== null && !YOUTUBE_URL.test(url)) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      "music.url must be a link to a single YouTube video. Use music.search for anything else.",
    );
  }
  if (search !== null && (search.length > 120 || /[\r\n]/.test(search) || search.startsWith("-"))) {
    throw new VideoRequestError("video_invalid_arguments", "music.search must be one short line.");
  }
  const number = (field: string, min: number, max: number): number | null => {
    if (music[field] === undefined || music[field] === null) return null;
    const parsed = Number(music[field]);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new VideoRequestError("video_invalid_arguments", `music.${field} must be between ${min} and ${max}.`);
    }
    return parsed;
  };
  return {
    url,
    search,
    startSeconds: number("startSeconds", 0, 900),
    volume: number("volume", 0, 1),
    fadeInSeconds: number("fadeInSeconds", 0, 10),
    fadeOutSeconds: number("fadeOutSeconds", 0, 10),
  };
}

export function narrationFrom(value: unknown, seconds: number): VideoNarrationLine[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_NARRATION_LINES) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      `narration must be a list of at most ${MAX_NARRATION_LINES} lines.`,
    );
  }
  const lines = value.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const atSeconds = Number(line.atSeconds);
    if (!Number.isFinite(atSeconds) || atSeconds < 0 || atSeconds >= seconds) {
      throw new VideoRequestError(
        "video_invalid_arguments",
        `narration[${index}].atSeconds must fall inside the video.`,
      );
    }
    return { text: text(line.text, `narration[${index}].text`, 600), atSeconds };
  });
  return lines.sort((a, b) => a.atSeconds - b.atSeconds);
}

/** Everything the pinned runtime installs. Nothing else resolves at bundle time. */
const SAFE_MODULE =
  /^(?:react|remotion|@kit|three|\.\.?\/(?:[A-Za-z0-9_-]+\/){0,3}[A-Za-z0-9_-]+|@remotion\/(?:transitions|shapes|paths|noise|layout-utils|motion-blur|google-fonts)(?:\/[A-Za-z0-9_-]+)?)$/;
const IMPORT_SOURCE = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

// ponytail: a denylist over source text, not a sandbox. The composition runs in
// a headless browser page, so this closes the obvious routes to the network and
// to the page's own origin; move rendering into a network-disabled supervisor
// job (the way Manim runs) if model-authored code ever has to be treated as hostile.
const FORBIDDEN_SOURCE = [
  [/\brequire\s*\(|\bimport\s*\(/, "dynamic imports"],
  [/\b(?:eval|Function)\s*\(|\bnew\s+Function\b/, "dynamic code evaluation"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker|SharedWorker|serviceWorker)\b/, "network or worker APIs"],
  [/\b(?:process|globalThis|localStorage|sessionStorage|indexedDB|cookie)\b/, "process or browser storage access"],
  [/\b(?:window|document)\s*\.\s*(?:location|open|write)\b/, "navigation APIs"],
  [/dangerouslySetInnerHTML|<\s*(?:script|iframe|object|embed)\b/i, "raw HTML, scripts, or frames"],
  [/\b(?:file|javascript|data\s*:\s*text\/html)\s*:/i, "file or script URLs"],
  [/\bstaticFile\s*\(/, "staticFile (there is no public folder; use generated graphics or https image URLs)"],
  [/\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i, "loopback addresses"],
] as const;

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new VideoRequestError("video_invalid_arguments", `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maximum) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      `${field} cannot exceed ${maximum} characters.`,
    );
  }
  return trimmed;
}

/**
 * The on-screen wording rules the skill promises, enforced where the model
 * cannot forget them. Returns one precise complaint per broken rule.
 *
 * Only string literals and JSX text are read, so `const WIDTH = 1920` and
 * `#FFFFFF` are not mistaken for shouting.
 */
export function lintVideoText(code: string): string[] {
  const problems: string[] = [];
  if (/[—–]/.test(code)) {
    problems.push(
      "Remove every em dash and en dash. Use a comma, a period, or two short lines instead.",
    );
  }
  if (/text-?transform\s*:\s*["'`]?\s*uppercase|\.toUpperCase\s*\(/i.test(code)) {
    problems.push(
      "Do not force uppercase (textTransform or toUpperCase). Write on-screen text in sentence case.",
    );
  }
  const visible = [
    ...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g),
  ]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? "")
    .map((value) => value.replace(/#[0-9a-fA-F]{3,8}\b/g, " "));
  // Acronyms stay legal: "NASA", "REST API", "GPU". Shouting is a long capital
  // word, or several capital words in a row.
  const shouting = /\b[A-Z]{8,}\b|\b[A-Z]{4,}(?:\s+[A-Z]{4,})+\b|\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/;
  const shouted = visible.find((value) => shouting.test(value));
  if (shouted) {
    problems.push(
      `Rewrite all-caps text in sentence case: "${shouted.trim().slice(0, 80)}". Acronyms may stay capitalised.`,
    );
  }
  return problems;
}

/** Hue in degrees and HSL saturation/lightness of a #RGB or #RRGGBB colour. */
function hsl(hex: string): { h: number; s: number; l: number } {
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * The looks that mark a video as machine-made, rejected by name: the italic
 * serif accent word, numbered scene labels, and the orange or purple accent.
 */
// The high-contrast display serifs a model reaches for when asked for
// something "elegant" or "editorial". Banned in every video, 2D and 3D.
const BANNED_FONTS =
  /google-fonts\/(?:PlayfairDisplay(?:SC)?|Playfair|DMSerif(?:Display|Text)|Fraunces|Cormorant\w*|BodoniModa(?:SC)?|AbrilFatface|YoungSerif|Gloock|LibreCaslon(?:Display|Text)|LibreBaskerville|Newsreader|Literata|Lora|EBGaramond|CrimsonPro|CrimsonText|Merriweather|SourceSerif4|Spectral|Prata|Marcellus|Cinzel\w*|Italiana|GFSDidot)\b|font-?family\s*:\s*["'`][^"'`]*\b(?:Georgia|Times(?: New Roman)?|Didot|Bodoni|Garamond|Baskerville|Playfair|serif)\b(?<!sans-serif)/i;

export function lintVideoLook(code: string): string[] {
  const problems: string[] = [];
  if (BANNED_FONTS.test(code)) {
    problems.push(
      "Do not use a display serif (Playfair Display, DM Serif Display, Fraunces, Cormorant, Bodoni Moda, Georgia, Times and the like). Use a sans, slab, mono or expressive display face from the Typefaces list.",
    );
  }
  if (/google-fonts\/InstrumentSerif\b|font-?style\s*:\s*["'`]?\s*italic|loadFont\(\s*["'`]italic/i.test(code)) {
    problems.push(
      "Do not use Instrument Serif or any italic text. Carry emphasis with weight, size, or a colour block.",
    );
  }
  if (/["'`>]\s*0[1-9]\s*(?:[\/.\u00b7-]\s*)?["'`<]|padStart\(\s*2\s*,/.test(code)) {
    problems.push(
      "Remove the scene number labels (01, 02 and so on). Scenes are not numbered on screen.",
    );
  }
  const loud = [...code.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)]
    .map((match) => ({ hex: match[0], ...hsl(match[1]) }))
    .find(({ h, s, l }) => s > 0.45 && l > 0.3 && l < 0.78 && ((h >= 8 && h <= 40) || (h >= 245 && h <= 295)));
  if (loud) {
    problems.push(
      `Replace the accent colour ${loud.hex}. Orange, terracotta and purple accents are not used; pick a colour that belongs to the subject.`,
    );
  }
  return problems;
}

/** `mode: "analyze_music"`: which track, and optionally which stretch of it. */
export function validateMusicAnalysisRequest(args: Record<string, unknown>): {
  music: VideoMusic;
  windowSeconds: number | null;
} {
  const music = musicFrom(args.music);
  if (!music) {
    throw new VideoRequestError("video_invalid_arguments", "analyze_music needs music.url or music.search.");
  }
  const seconds = args.durationSeconds === undefined || args.durationSeconds === null ? null : Number(args.durationSeconds);
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 1)) {
    throw new VideoRequestError("video_invalid_arguments", "durationSeconds must be at least 1.");
  }
  return { music, windowSeconds: seconds };
}

/** A source file is checked the same way wherever it sits in the project. */
function checkSource(code: string, label: string, asRequested: boolean): void {
  if (Buffer.byteLength(code, "utf8") > MAX_VIDEO_SOURCE_BYTES) {
    throw new VideoRequestError(
      "video_invalid_source",
      `${label} cannot exceed ${MAX_VIDEO_SOURCE_BYTES} UTF-8 bytes.`,
    );
  }
  for (const match of code.matchAll(IMPORT_SOURCE)) {
    const source = match[1] ?? match[2] ?? "";
    if (!SAFE_MODULE.test(source)) {
      throw new VideoRequestError(
        "video_invalid_source",
        `Unsupported import in ${label}: ${source.slice(0, 120)}. Import only react, remotion, @kit, three, the project's own files, and @remotion/transitions, shapes, paths, noise, layout-utils, motion-blur, or google-fonts.`,
      );
    }
  }
  for (const [pattern, reason] of FORBIDDEN_SOURCE) {
    if (pattern.test(code)) {
      throw new VideoRequestError("video_invalid_source", `${label} cannot use ${reason}.`);
    }
  }
  // The user's own wording, colours and fonts are theirs to keep.
  if (!asRequested) {
    const problems = [...lintVideoText(code), ...lintVideoLook(code)];
    if (problems.length) {
      throw new VideoRequestError("video_text_style", `${label}: ${problems.join(" ")}`);
    }
  }
}

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const PROJECT_FILE = /^(?:[A-Za-z0-9_-]+\/){0,3}[A-Za-z0-9_-]+\.tsx?$/;
const RESERVED_FILES = new Set(["index.tsx", "Video.tsx"]);

/** Extra source files of an engine project, keyed by path relative to it. */
function filesFrom(value: unknown, asRequested: boolean): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new VideoRequestError("video_invalid_arguments", "files must map a relative path to its source.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PROJECT_FILES) {
    throw new VideoRequestError("video_invalid_arguments", `files cannot hold more than ${MAX_PROJECT_FILES} entries.`);
  }
  const files: Record<string, string> = {};
  for (const [name, source] of entries) {
    if (!PROJECT_FILE.test(name) || RESERVED_FILES.has(name)) {
      throw new VideoRequestError(
        "video_invalid_arguments",
        `"${name.slice(0, 80)}" is not a usable file name. Use paths such as scenes/Intro.tsx; the main file goes in code.`,
      );
    }
    if (typeof source !== "string" || !source.trim()) {
      throw new VideoRequestError("video_invalid_arguments", `files["${name}"] is empty.`);
    }
    checkSource(source, name, asRequested);
    files[name] = `${source.trimEnd()}\n`;
  }
  return files;
}

export function validateVideoRequest(args: Record<string, unknown>): VideoRequest {
  const title = text(args.title, "title", 240);
  const description = text(args.description, "description", 1_000);
  const asRequested = args.asRequested === true;
  const projectId = args.projectId === undefined || args.projectId === null ? null : String(args.projectId);
  if (projectId !== null && !PROJECT_ID.test(projectId)) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      "projectId must be lowercase letters, digits and dashes, for example spring-launch.",
    );
  }
  // A revision of an existing project may send only the files that changed.
  const hasCode = typeof args.code === "string" && args.code.trim().length > 0;
  if (!hasCode && projectId === null) {
    throw new VideoRequestError("video_invalid_arguments", "code is required.");
  }
  const code = hasCode ? text(args.code, "code", MAX_VIDEO_SOURCE_BYTES) : null;
  const seconds = Number(args.durationSeconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_VIDEO_SECONDS) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      `durationSeconds must be between 1 and ${MAX_VIDEO_SECONDS}.`,
    );
  }
  const fps = args.fps === undefined ? 30 : Number(args.fps);
  if (!(VIDEO_FRAME_RATES as readonly number[]).includes(fps)) {
    throw new VideoRequestError("video_invalid_arguments", "fps must be 30 or 60.");
  }
  const format = args.format === undefined ? "landscape" : args.format;
  if (typeof format !== "string" || !Object.hasOwn(VIDEO_FORMATS, format)) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      `format must be one of ${Object.keys(VIDEO_FORMATS).join(", ")}.`,
    );
  }
  const quality = args.quality === undefined ? "standard" : args.quality;
  if (typeof quality !== "string" || !(VIDEO_QUALITIES as readonly string[]).includes(quality)) {
    throw new VideoRequestError(
      "video_invalid_arguments",
      `quality must be one of ${VIDEO_QUALITIES.join(", ")}.`,
    );
  }
  if (code !== null) {
    if (!/\bexport\s+default\b/.test(code)) {
      throw new VideoRequestError(
        "video_invalid_source",
        "The source must default-export the video's React component.",
      );
    }
    checkSource(code, "code", asRequested);
  }
  let plan: string | null = null;
  if (args.project !== undefined && args.project !== null) {
    if (typeof args.project !== "object" || Array.isArray(args.project)) {
      throw new VideoRequestError("video_invalid_arguments", "project must be an object: the plan of the video.");
    }
    plan = JSON.stringify(args.project, null, 2);
    if (plan.length > 96 * 1024) {
      throw new VideoRequestError("video_invalid_arguments", "project cannot exceed 96 KiB.");
    }
  }
  return {
    title,
    description,
    code: code === null ? null : `${code}\n`,
    files: filesFrom(args.files, asRequested),
    projectId,
    plan,
    preview: args.mode === "preview",
    durationSeconds: seconds,
    durationInFrames: Math.round(seconds * fps),
    fps: fps as VideoFrameRate,
    format: format as VideoFormat,
    quality: quality as VideoQuality,
    music: musicFrom(args.music),
    narration: narrationFrom(args.narration, seconds),
  };
}
