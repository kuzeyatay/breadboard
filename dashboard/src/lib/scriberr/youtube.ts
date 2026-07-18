// YouTube URL validation and canonicalization. Pure module (no Node APIs) so
// the client-side video import UI can reuse the exact same validation the
// server enforces.
//
// Only single YouTube videos are accepted: known YouTube hosts, a resolvable
// 11-character video ID, and no playlist-only URLs. Arbitrary remote URLs are
// rejected outright.

import { VideoTranscriptionError } from "./errors.ts";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface ParsedYouTubeUrl {
  videoId: string;
  /** Normalized watch URL: https://www.youtube.com/watch?v=<id> */
  canonicalUrl: string;
  /** The submitted URL after trimming/scheme normalization. */
  originalUrl: string;
}

function invalid(detail?: string): VideoTranscriptionError {
  return new VideoTranscriptionError("youtube_invalid_url", {
    detail,
    httpStatus: 400,
  });
}

function playlist(): VideoTranscriptionError {
  return new VideoTranscriptionError("youtube_playlist", { httpStatus: 400 });
}

function videoIdFromPathSegment(segment: string | undefined): string | null {
  const candidate = (segment ?? "").trim();
  return VIDEO_ID_RE.test(candidate) ? candidate : null;
}

export function canonicalYouTubeUrl(videoId: string): string {
  if (!VIDEO_ID_RE.test(videoId)) {
    throw invalid("bad video id");
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Parse and validate a user-submitted YouTube URL.
 *
 * Accepted forms (single video only):
 *   https://www.youtube.com/watch?v=<id>
 *   https://youtu.be/<id>
 *   https://www.youtube.com/shorts/<id> | /embed/<id> | /live/<id> | /v/<id>
 *
 * Playlist URLs without a concrete video are rejected. A watch URL that also
 * carries a `list=` parameter is accepted but canonicalized down to the single
 * video, so only one video is ever downloaded.
 */
export function parseYouTubeUrl(raw: unknown): ParsedYouTubeUrl {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalid("empty");
  }

  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalid("unparseable");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalid(`protocol ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  const isShortHost = SHORT_HOSTS.has(host);
  if (!isShortHost && !YOUTUBE_HOSTS.has(host)) {
    throw invalid(`host ${host}`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;

  if (isShortHost) {
    videoId = videoIdFromPathSegment(segments[0]);
  } else {
    const first = (segments[0] ?? "").toLowerCase();
    if (first === "watch") {
      videoId = videoIdFromPathSegment(url.searchParams.get("v") ?? undefined);
    } else if (
      first === "shorts" ||
      first === "embed" ||
      first === "live" ||
      first === "v"
    ) {
      videoId = videoIdFromPathSegment(segments[1]);
    } else if (first === "playlist") {
      throw playlist();
    } else if (segments.length === 0 && url.searchParams.get("v")) {
      videoId = videoIdFromPathSegment(url.searchParams.get("v") ?? undefined);
    }
  }

  if (!videoId) {
    // A list without a concrete video is a playlist request, which this
    // feature intentionally refuses.
    if (url.searchParams.has("list")) throw playlist();
    throw invalid("no video id");
  }

  return {
    videoId,
    canonicalUrl: canonicalYouTubeUrl(videoId),
    originalUrl: withScheme,
  };
}

/** True when the value parses as a single-video YouTube URL. */
export function isLikelyYouTubeUrl(raw: unknown): boolean {
  try {
    parseYouTubeUrl(raw);
    return true;
  } catch {
    return false;
  }
}

/** Deep link to a position in a YouTube video, used for timestamp links. */
export function youtubeTimestampUrl(videoId: string, seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${canonicalYouTubeUrl(videoId)}&t=${safeSeconds}s`;
}
