// A video someone linked to, and the identity that makes it the same video the
// next time they link to it.
//
// Pasting a URL into a chat should not mean fetching it again on every mention.
// So a link is reduced to a *source key* — for YouTube the video id, for a
// direct media URL the normalized address — and that key is what the download
// cache is keyed by. `youtu.be/abc`, `youtube.com/watch?v=abc&list=…` and
// `youtube.com/shorts/abc` are one video, and asking about it, editing it, then
// asking again downloads it once.
//
// The YouTube half is `scriberr/youtube.ts`, which already canonicalizes exactly
// these forms for the Garden's video import and refuses playlists. Reusing it
// means one definition of "a single YouTube video" for the whole app.
//
// Deliberately free of Node imports — the composer imports this too.

import { isLikelyYouTubeUrl, parseYouTubeUrl } from "../scriberr/youtube.ts";
import { VIDEO_ATTACHMENT_EXTENSIONS } from "../video-attachments.ts";

/**
 * A link that is a video, or a page whose whole purpose is one.
 *
 * The same shape `watch-intent.ts` uses to decide whether a pasted link is
 * about a video at all; here it also has to hand back *which* link, so the
 * pattern is global and the extension list comes from the shared attachment
 * formats rather than a second copy of it.
 */
const VIDEO_URL = new RegExp(
  "https?://(?:" +
    "[^\\s<>\"']*\\b(?:youtube\\.com/(?:watch|shorts|live|embed|v)|youtu\\.be/|vimeo\\.com/\\d|dailymotion\\.com/video|twitch\\.tv/videos|tiktok\\.com/[^\\s]*/video)\\b[^\\s<>\"']*" +
    `|[^\\s<>"']+\\.(?:${VIDEO_ATTACHMENT_EXTENSIONS.join("|")})(?:\\?[^\\s<>"']*)?` +
    ")",
  "gi",
);

/** Every video link in a message, in the order they appear, deduplicated. */
export function videoUrlsIn(text: string): string[] {
  const found = text.match(VIDEO_URL) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of found) {
    // Trailing punctuation belongs to the sentence, not to the URL.
    const url = raw.replace(/[),.;:!?\]]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/** The first video link in a message, which is the one a turn acts on. */
export function firstVideoUrl(text: string): string | null {
  return videoUrlsIn(text)[0] ?? null;
}

export interface VideoSource {
  /** Stable across every spelling of the same link. */
  key: string;
  provider: "youtube" | "web";
  /** What is actually fetched. */
  canonicalUrl: string;
  /** What the person typed. */
  originalUrl: string;
  /** A filename-safe label used until the real title is known. */
  label: string;
}

/**
 * Reduce a link to the video it names. Returns null for anything that is not a
 * single video — a playlist, a channel, a page that merely mentions one.
 */
export function videoSourceFor(rawUrl: string): VideoSource | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (isLikelyYouTubeUrl(trimmed)) {
    const parsed = parseYouTubeUrl(trimmed);
    return {
      key: `youtube:${parsed.videoId}`,
      provider: "youtube",
      canonicalUrl: parsed.canonicalUrl,
      originalUrl: parsed.originalUrl,
      label: parsed.videoId,
    };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  // A non-YouTube link only counts when it names a media file outright. Fetching
  // an arbitrary page and hoping a video falls out is not something to do on
  // somebody's behalf.
  const extension = url.pathname.toLowerCase().match(/\.([a-z0-9]{2,4})$/)?.[1] ?? "";
  if (!(VIDEO_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) return null;

  // The query string is dropped from the identity but kept for the fetch: a
  // signed URL for the same file should not be a second copy of it.
  const canonicalUrl = url.toString();
  const identity = `${url.protocol}//${url.host}${url.pathname}`.toLowerCase();
  return {
    key: `web:${identity}`,
    provider: "web",
    canonicalUrl,
    originalUrl: trimmed,
    label: url.pathname.split("/").filter(Boolean).pop() ?? "video",
  };
}

/** The first link in a message that names a single, fetchable video. */
export function firstVideoSource(text: string): VideoSource | null {
  for (const url of videoUrlsIn(text)) {
    const source = videoSourceFor(url);
    if (source) return source;
  }
  return null;
}
