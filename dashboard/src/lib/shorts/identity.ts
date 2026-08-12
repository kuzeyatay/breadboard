// The Shorts agent's chat identity and its request model.
//
// This agent takes a video. Not a video and a sentence — a video. The cloned
// pipeline downloads it, transcribes it, ranks the transcript for clippable
// moments and cuts them; there is no prompt anywhere in it that free text could
// reach. So the request is a typed object, the composer replaces the message
// field while the agent is selected (see assistant-composer.tsx), and the chat
// message is rendered FROM the object rather than parsed into one.
//
// This is the same shape Trading Agent uses, and for the same reason: a field
// that quietly discards what you typed is worse than no field.
//
// `parseShortsCommand` exists for the reverse direction only: a pasted or
// historical `/agents:shorts https://… · 3 clips` selects the agent and
// pre-fills the form. It never becomes a prompt.

export const SHORTS_COMMAND = "/agents:shorts";
export const SHORTS_AGENT_ID = "shorts";
export const SHORTS_AGENT_NAME = "Shorts";

export const SHORTS_ASPECT_RATIOS = [
  { value: "9:16", label: "9:16 — vertical", detail: "TikTok, Reels, YouTube Shorts" },
  { value: "1:1", label: "1:1 — square", detail: "Feed posts" },
  { value: "16:9", label: "16:9 — landscape", detail: "Keeps the original framing" },
] as const;

export type ShortsAspectRatio = (typeof SHORTS_ASPECT_RATIOS)[number]["value"];

export const SHORTS_RESOLUTIONS = [
  { value: "360", label: "360p", detail: "Fastest, roughest" },
  { value: "480", label: "480p", detail: "" },
  { value: "720", label: "720p", detail: "Recommended" },
  { value: "1080", label: "1080p", detail: "Slowest to download and reframe" },
] as const;

export type ShortsResolution = (typeof SHORTS_RESOLUTIONS)[number]["value"];

export const MAX_SHORTS_CLIPS = 10;

/**
 * Where the video comes from.
 *
 * A URL is fetched by yt-dlp inside the run. An upload is a file the person
 * chose in the composer, already stored by `/api/shorts/uploads` — the id is
 * how the run addresses it, because a filesystem path from a browser would let
 * the page point the server at anything on the machine.
 */
export type ShortsSource =
  | { kind: "url"; url: string }
  | { kind: "upload"; uploadId: string; filename: string };

export interface ShortsRequest {
  source: ShortsSource;
  /** How many shorts to cut, highest-scoring first. */
  clipCount: number;
  aspectRatio: ShortsAspectRatio;
  /** Source download resolution. Ignored for an uploaded file. */
  resolution: ShortsResolution;
  /** ISO-639-1 code forced on Whisper, or "" to let it detect the language. */
  language: string;
}

export const DEFAULT_SHORTS_REQUEST: Omit<ShortsRequest, "source"> = {
  clipCount: 3,
  aspectRatio: "9:16",
  resolution: "720",
  language: "",
};

const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/;
const LANGUAGE_PATTERN = /^[a-z]{2}$/;

const ASPECT_RATIOS = SHORTS_ASPECT_RATIOS.map((item) => item.value) as ShortsAspectRatio[];
const RESOLUTIONS = SHORTS_RESOLUTIONS.map((item) => item.value) as ShortsResolution[];

/**
 * A URL the run is allowed to fetch.
 *
 * http/https only, and never `file:`. yt-dlp will happily read a `file://` URL,
 * which would turn this form into a way to make the server open any path it can
 * reach — an uploaded file is the supported way to use a local video, and it
 * goes through a route that owns where the bytes live.
 */
export function isFetchableVideoUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return Boolean(parsed.hostname);
}

export function clampClipCount(value: unknown, fallback = 3): number {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count)) return fallback;
  return Math.min(Math.max(count, 1), MAX_SHORTS_CLIPS);
}

export type ShortsRequestResult =
  | { ok: true; request: ShortsRequest }
  | { ok: false; error: string };

/**
 * Validate an untrusted request from the browser. Shared by the form and the
 * run route so the two can never disagree about what a runnable request is.
 */
export function validateShortsRequest(value: unknown): ShortsRequestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The request was not readable." };
  }
  const candidate = value as Record<string, unknown>;
  const rawSource = candidate.source;
  if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) {
    return { ok: false, error: "Choose a video first." };
  }
  const sourceRecord = rawSource as Record<string, unknown>;

  let source: ShortsSource;
  if (sourceRecord.kind === "upload") {
    const uploadId = typeof sourceRecord.uploadId === "string" ? sourceRecord.uploadId.trim() : "";
    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      return { ok: false, error: "That uploaded video is no longer available. Choose it again." };
    }
    const filename =
      typeof sourceRecord.filename === "string" ? sourceRecord.filename.trim().slice(0, 200) : "";
    source = { kind: "upload", uploadId, filename: filename || "video.mp4" };
  } else {
    const url = typeof sourceRecord.url === "string" ? sourceRecord.url.trim() : "";
    if (!url) return { ok: false, error: "Paste a video link, or choose a file." };
    if (url.length > 2_000) return { ok: false, error: "That link is too long to be a video URL." };
    if (!isFetchableVideoUrl(url)) {
      return { ok: false, error: "That is not a video link this agent can fetch (http or https)." };
    }
    source = { kind: "url", url };
  }

  const language =
    typeof candidate.language === "string" ? candidate.language.trim().toLowerCase() : "";
  if (language && !LANGUAGE_PATTERN.test(language)) {
    return { ok: false, error: "Use a two-letter language code, like en or nl — or leave it blank." };
  }

  return {
    ok: true,
    request: {
      source,
      clipCount: clampClipCount(candidate.clipCount),
      aspectRatio: ASPECT_RATIOS.includes(candidate.aspectRatio as ShortsAspectRatio)
        ? (candidate.aspectRatio as ShortsAspectRatio)
        : "9:16",
      resolution: RESOLUTIONS.includes(candidate.resolution as ShortsResolution)
        ? (candidate.resolution as ShortsResolution)
        : "720",
      language,
    },
  };
}

/** What the video is called in a sentence — the filename, or the link. */
export function shortsSourceLabel(source: ShortsSource): string {
  return source.kind === "upload" ? source.filename : source.url;
}

/** How the request reads as the user half of the chat turn. */
export function shortsUserMessage(request: ShortsRequest): string {
  const parts = [
    shortsSourceLabel(request.source),
    `${request.clipCount} clip${request.clipCount === 1 ? "" : "s"}`,
    request.aspectRatio,
  ];
  if (request.source.kind === "url") parts.push(`${request.resolution}p`);
  if (request.language) parts.push(request.language);
  return `${SHORTS_COMMAND} ${parts.join(" · ")}`;
}

/** A short label for the run card and the conversation list. */
export function shortsRunLabel(request: ShortsRequest): string {
  const source = shortsSourceLabel(request.source);
  const name =
    request.source.kind === "upload"
      ? source
      : source.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
  return `${name} · ${request.clipCount} × ${request.aspectRatio}`;
}

/**
 * Recognise the command at the head of a message and recover whatever of the
 * request it carries. Returns null when the command is not there at all.
 *
 * Anything unrecognised is discarded: this is a form pre-fill, never a prompt.
 */
export function parseShortsCommand(
  value: string,
): { partial: Partial<ShortsRequest> } | null {
  let remaining = value.trim();
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:shorts") selected = true;
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;

  const partial: Partial<ShortsRequest> = {};
  const url = /https?:\/\/[^\s·]+/i.exec(remaining)?.[0];
  if (url && isFetchableVideoUrl(url)) partial.source = { kind: "url", url };

  const clips = /(\d+)\s*clips?\b/i.exec(remaining);
  if (clips) partial.clipCount = clampClipCount(clips[1]);

  const ratio = ASPECT_RATIOS.find((value) => remaining.includes(value));
  if (ratio) partial.aspectRatio = ratio;

  const resolution = /\b(360|480|720|1080)p?\b/.exec(remaining);
  if (resolution && RESOLUTIONS.includes(resolution[1] as ShortsResolution)) {
    partial.resolution = resolution[1] as ShortsResolution;
  }

  return { partial };
}
