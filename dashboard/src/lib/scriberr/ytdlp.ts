// yt-dlp metadata inspection. Breadboard uses yt-dlp only for machine-readable
// metadata (--dump-single-json) to validate a video and power the UI preview;
// the actual media download is delegated to Scriberr's own yt-dlp integration
// via its /transcription/youtube endpoint. Argument arrays only, no shell.

import { CommandNotFoundError, runCommand } from "./exec";
import { VideoTranscriptionError } from "./errors";
import type { ParsedYouTubeUrl } from "./youtube";
import type { YouTubeMediaMetadata } from "./types";

/** Pure argument builder (unit-tested; the client never supplies arguments). */
export function buildYtdlpMetadataArgs(canonicalUrl: string): string[] {
  return [
    "--dump-single-json",
    "--no-playlist",
    "--skip-download",
    "--no-warnings",
    "--",
    canonicalUrl,
  ];
}

/** Pure parser for yt-dlp's single-video JSON metadata. */
export function parseYtdlpMetadata(
  raw: unknown,
  parsedUrl: ParsedYouTubeUrl,
): YouTubeMediaMetadata {
  if (!raw || typeof raw !== "object") {
    throw new VideoTranscriptionError("youtube_metadata_failed", {
      detail: "yt-dlp returned no parseable metadata",
    });
  }
  const record = raw as Record<string, unknown>;

  // A playlist payload (should be impossible with --no-playlist) is refused.
  if (record._type === "playlist" || Array.isArray(record.entries)) {
    throw new VideoTranscriptionError("youtube_playlist");
  }

  const idValue = typeof record.id === "string" ? record.id : "";
  const videoId = idValue || parsedUrl.videoId;

  const duration = Number(record.duration);
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : null;
  const channel =
    typeof record.channel === "string" && record.channel.trim()
      ? record.channel.trim()
      : typeof record.uploader === "string" && record.uploader.trim()
        ? record.uploader.trim()
        : null;
  const thumbnail =
    typeof record.thumbnail === "string" && /^https?:\/\//i.test(record.thumbnail)
      ? record.thumbnail
      : null;
  const uploadDate =
    typeof record.upload_date === "string" && /^\d{8}$/.test(record.upload_date)
      ? record.upload_date
      : null;

  return {
    videoId,
    canonicalUrl: parsedUrl.canonicalUrl,
    title,
    channel,
    durationSeconds:
      Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    thumbnailUrl: thumbnail,
    uploadDate,
  };
}

export async function inspectYouTubeVideo(
  {
    ytdlpPath,
    timeoutMs = 60_000,
  }: { ytdlpPath: string; timeoutMs?: number },
  parsedUrl: ParsedYouTubeUrl,
): Promise<YouTubeMediaMetadata> {
  let result;
  try {
    result = await runCommand(ytdlpPath, buildYtdlpMetadataArgs(parsedUrl.canonicalUrl), {
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      throw new VideoTranscriptionError("ytdlp_unavailable", { cause: error });
    }
    throw new VideoTranscriptionError("youtube_metadata_failed", {
      detail: "yt-dlp failed to start",
      cause: error,
    });
  }

  if (result.timedOut) {
    throw new VideoTranscriptionError("youtube_metadata_failed", {
      detail: "yt-dlp metadata probe timed out",
    });
  }
  if (result.code !== 0) {
    // stderr can contain remote-site details; keep it server-side only.
    throw new VideoTranscriptionError("youtube_metadata_failed", {
      detail: `yt-dlp exit ${result.code}: ${result.stderr.slice(0, 500)}`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new VideoTranscriptionError("youtube_metadata_failed", {
      detail: "yt-dlp output was not JSON",
    });
  }
  return parseYtdlpMetadata(parsed, parsedUrl);
}
