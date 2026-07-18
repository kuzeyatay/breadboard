// Structured errors for the video transcription pipeline. Every failure the
// browser can see maps to a stable code with a specific, sanitized message —
// never "Something went wrong", and never internal paths, credentials, command
// lines, or stack traces.

export type VideoTranscriptionErrorCode =
  | "feature_disabled"
  | "scriberr_unavailable"
  | "scriberr_auth_failed"
  | "scriberr_rejected"
  | "ytdlp_unavailable"
  | "ffmpeg_unavailable"
  | "ffprobe_unavailable"
  | "youtube_invalid_url"
  | "youtube_playlist"
  | "youtube_metadata_failed"
  | "youtube_download_failed"
  | "media_unsupported"
  | "media_no_audio"
  | "media_too_large"
  | "media_too_long"
  | "media_missing"
  | "transcription_failed"
  | "transcription_timeout"
  | "transcript_unavailable"
  | "transcript_malformed"
  | "transcript_incomplete"
  | "markdown_write_failed"
  | "indexing_failed"
  | "job_interrupted"
  | "duplicate_source"
  | "queue_full"
  | "invalid_input"
  | "cancelled"
  | "internal_error";

const USER_MESSAGES: Record<VideoTranscriptionErrorCode, string> = {
  feature_disabled:
    "Video transcription is disabled. Set VIDEO_TRANSCRIPTION_ENABLED=true and restart the dashboard.",
  scriberr_unavailable:
    "Scriberr is not reachable. Start Scriberr and check SCRIBERR_BASE_URL.",
  scriberr_auth_failed:
    "Scriberr rejected the configured credentials. Check SCRIBERR_API_TOKEN (or username/password).",
  scriberr_rejected: "Scriberr rejected the request.",
  ytdlp_unavailable:
    "yt-dlp was not found. Install yt-dlp or set YTDLP_PATH.",
  ffmpeg_unavailable:
    "FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH.",
  ffprobe_unavailable:
    "ffprobe was not found. Install FFmpeg (which includes ffprobe) or set FFPROBE_PATH.",
  youtube_invalid_url:
    "That is not a valid YouTube video URL. Paste a link like https://www.youtube.com/watch?v=…",
  youtube_playlist:
    "Playlists are not supported. Paste a link to a single YouTube video.",
  youtube_metadata_failed:
    "Could not read this YouTube video's details. The video may be private, removed, or region-locked.",
  youtube_download_failed:
    "Downloading the YouTube video failed. The video may require sign-in or be unavailable.",
  media_unsupported:
    "This file is not a supported video. Supported formats: .mp4, .mov, .mkv, .webm, .m4v.",
  media_no_audio:
    "This video has no audio stream, so there is nothing to transcribe.",
  media_too_large: "This video exceeds the maximum upload size.",
  media_too_long: "This video exceeds the maximum supported duration.",
  media_missing:
    "The uploaded media is no longer available. Upload the video again.",
  transcription_failed: "Scriberr could not transcribe this video.",
  transcription_timeout:
    "Transcription did not finish within the configured time limit.",
  transcript_unavailable:
    "Scriberr finished but did not return a transcript for this video.",
  transcript_malformed:
    "Scriberr returned a transcript Breadboard could not read.",
  transcript_incomplete:
    "The generated Markdown did not contain the complete transcript, so it was not saved.",
  markdown_write_failed:
    "Writing the transcript Markdown into the garden failed.",
  indexing_failed:
    "The transcript was saved, but indexing the new source failed. Retry to finish indexing without re-transcribing.",
  job_interrupted:
    "The transcription job was interrupted (for example by a server restart). Retry to continue.",
  duplicate_source: "This video already exists as a source in this garden.",
  queue_full:
    "Too many transcription jobs are queued for this garden. Wait for one to finish and try again.",
  invalid_input: "The request was invalid.",
  cancelled: "The transcription job was cancelled.",
  internal_error: "Video transcription failed due to an internal error.",
};

export function userMessageForCode(code: VideoTranscriptionErrorCode): string {
  return USER_MESSAGES[code] ?? USER_MESSAGES.internal_error;
}

const RETRYABLE_CODES: ReadonlySet<VideoTranscriptionErrorCode> = new Set([
  "scriberr_unavailable",
  "scriberr_auth_failed",
  "youtube_metadata_failed",
  "youtube_download_failed",
  "transcription_failed",
  "transcription_timeout",
  "transcript_unavailable",
  "markdown_write_failed",
  "indexing_failed",
  "job_interrupted",
  "internal_error",
]);

export class VideoTranscriptionError extends Error {
  code: VideoTranscriptionErrorCode;
  /** Message safe to show in the browser. */
  userMessage: string;
  retryable: boolean;
  /** Optional HTTP status hint for route handlers. */
  httpStatus?: number;

  constructor(
    code: VideoTranscriptionErrorCode,
    options: {
      userMessage?: string;
      /** Server-log-only detail; never sent to the browser. */
      detail?: string;
      retryable?: boolean;
      httpStatus?: number;
      cause?: unknown;
    } = {},
  ) {
    const userMessage = options.userMessage ?? userMessageForCode(code);
    super(options.detail ? `${userMessage} [${options.detail}]` : userMessage);
    this.name = "VideoTranscriptionError";
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.httpStatus = options.httpStatus;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Collapse any error into a browser-safe `{ errorCode, errorMessage }` pair.
 * Unknown errors become `internal_error` with a generic message; their real
 * message stays on the server (the caller is expected to log it).
 */
export function sanitizeErrorForClient(error: unknown): {
  errorCode: VideoTranscriptionErrorCode;
  errorMessage: string;
} {
  if (error instanceof VideoTranscriptionError) {
    return { errorCode: error.code, errorMessage: error.userMessage };
  }
  return {
    errorCode: "internal_error",
    errorMessage: userMessageForCode("internal_error"),
  };
}

export function isVideoTranscriptionError(
  error: unknown,
): error is VideoTranscriptionError {
  return error instanceof VideoTranscriptionError;
}
