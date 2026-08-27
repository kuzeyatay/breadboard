// Shared types for the Breadboard <-> Scriberr video transcription integration.
//
// Scriberr is treated as a separate local service reached over HTTP; nothing in
// Breadboard touches Scriberr's database or filesystem. These types describe
// both the Breadboard-side job model and the normalized views of Scriberr's
// API responses.

export type VideoTranscriptionInputKind = "upload" | "youtube";

export type VideoTranscriptionStatus =
  | "queued"
  | "validating"
  | "uploading"
  | "downloading"
  | "preparing_media"
  | "submitting_to_scriberr"
  | "transcribing"
  | "formatting_markdown"
  | "writing_source"
  | "indexing_source"
  | "completed"
  | "failed"
  | "cancelled";

export const VIDEO_TRANSCRIPTION_TERMINAL_STATUSES: ReadonlySet<VideoTranscriptionStatus> =
  new Set(["completed", "failed", "cancelled"]);

export function isTerminalVideoTranscriptionStatus(
  status: VideoTranscriptionStatus,
): boolean {
  return VIDEO_TRANSCRIPTION_TERMINAL_STATUSES.has(status);
}

/** Metadata for a validated YouTube video, from yt-dlp's machine-readable output. */
export interface YouTubeMediaMetadata {
  videoId: string;
  canonicalUrl: string;
  title: string | null;
  channel: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  /** yt-dlp upload_date, YYYYMMDD when available. */
  uploadDate: string | null;
}

/** Result of validating uploaded media with ffprobe. */
export interface MediaProbeResult {
  container: string | null;
  codecs: string[];
  durationSeconds: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number | null;
}

/** Scriberr job statuses as returned by its API. */
export type ScriberrJobStatus =
  | "uploaded"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

/** Normalized view of Scriberr's TranscriptionJob responses. */
export interface ScriberrJobSnapshot {
  id: string;
  status: ScriberrJobStatus;
  title: string | null;
  errorMessage: string | null;
  diarization: boolean;
  model: string | null;
  modelFamily: string | null;
}

/** One timestamped segment from Scriberr's transcript payload. */
export interface ScriberrTranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

/**
 * One word from Scriberr's `word_segments`.
 *
 * WhisperX aligns every word, so these are sub-second accurate — which is what
 * the video editor cuts on. Not every backend produces them (Voxtral, for one,
 * has no word timings at all), so callers that need them must check.
 */
export interface ScriberrTranscriptWord {
  start: number;
  end: number;
  word: string;
  speaker: string | null;
}

/** Normalized view of Scriberr's `GET /transcription/:id/transcript` payload. */
export interface ScriberrTranscript {
  segments: ScriberrTranscriptSegment[];
  /** Word-level timings when the backend produced them; empty when it did not. */
  words: ScriberrTranscriptWord[];
  /** Full plain text when Scriberr provides it alongside segments. */
  text: string | null;
  language: string | null;
  modelUsed: string | null;
}

export interface NormalizedTranscriptSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  speaker: string | null;
  text: string;
}

export interface NormalizedTranscript {
  title: string;
  language: string | null;
  durationSeconds: number | null;
  sourceType: "video_upload" | "youtube";
  segments: NormalizedTranscriptSegment[];
  speakers: string[];
  transcriptionModel: string | null;
}

/** Full server-side job record. Never sent to the browser as-is. */
export interface VideoTranscriptionJob {
  id: string;
  /** Garden (cluster) slug. */
  gardenId: string;
  clusterId: number;
  userId: number;
  inputKind: VideoTranscriptionInputKind;
  status: VideoTranscriptionStatus;
  progressPercent: number | null;
  currentStage: string | null;
  originalFilename: string | null;
  originalUrl: string | null;
  canonicalUrl: string | null;
  youtubeVideoId: string | null;
  sourceTitle: string | null;
  videoMetadata: YouTubeMediaMetadata | null;
  /** Server-only absolute path of the uploaded media inside the temp root. */
  mediaTempPath: string | null;
  mediaSha256: string | null;
  scriberrJobId: string | null;
  /** Normalized transcript checkpoint (JSON) so indexing retries never re-transcribe. */
  transcriptJson: string | null;
  outputRelativePath: string | null;
  sourceSlug: string | null;
  contentHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  /** Native Runtime identity; never exposed to the browser. */
  runtimeJobId: string | null;
  runtimeIdempotencyKey: string | null;
  runtimeGeneration: number;
  heartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Browser-safe job view: no filesystem paths, no internal checkpoints. */
export interface PublicVideoTranscriptionJob {
  id: string;
  gardenId: string;
  inputKind: VideoTranscriptionInputKind;
  status: VideoTranscriptionStatus;
  progressPercent: number | null;
  currentStage: string | null;
  originalFilename: string | null;
  originalUrl: string | null;
  canonicalUrl: string | null;
  youtubeVideoId: string | null;
  sourceTitle: string | null;
  videoMetadata: YouTubeMediaMetadata | null;
  outputRelativePath: string | null;
  sourceSlug: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function publicVideoTranscriptionJob(
  job: VideoTranscriptionJob,
): PublicVideoTranscriptionJob {
  return {
    id: job.id,
    gardenId: job.gardenId,
    inputKind: job.inputKind,
    status: job.status,
    progressPercent: job.progressPercent,
    currentStage: job.currentStage,
    originalFilename: job.originalFilename,
    originalUrl: job.originalUrl,
    canonicalUrl: job.canonicalUrl,
    youtubeVideoId: job.youtubeVideoId,
    sourceTitle: job.sourceTitle,
    videoMetadata: job.videoMetadata,
    outputRelativePath: job.outputRelativePath,
    sourceSlug: job.sourceSlug,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export interface ExistingVideoSource {
  sourceSlug: string;
  sourceRelPath: string;
  title?: string;
  youtubeVideoId?: string;
  mediaSha256?: string;
  contentHash?: string;
}
