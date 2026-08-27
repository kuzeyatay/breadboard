// Server-only configuration for the video transcription feature. Environment
// variables are parsed and validated once here; route handlers and the job
// runner consume the typed config instead of reading process.env directly.

import os from "os";
import path from "path";

export interface VideoTranscriptionConfig {
  enabled: boolean;

  scriberrBaseUrl: string;
  scriberrApiToken: string | null;
  scriberrUsername: string | null;
  scriberrPassword: string | null;
  requestTimeoutMs: number;
  transcriptionTimeoutMs: number;
  pollIntervalMs: number;

  /** Transcription parameters forwarded to Scriberr's start endpoint. */
  scriberrModelFamily: string;
  scriberrModel: string;
  scriberrLanguage: string | null;
  scriberrDiarization: boolean;
  /** Delete the Scriberr-side job after a successful import (supported API). */
  deleteScriberrJobs: boolean;

  maxUploadBytes: number;
  maxDurationSeconds: number;
  tempDir: string;
  keepMedia: boolean;
  tempRetentionHours: number;

  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  ytdlpDownloadTimeoutMs: number;

  maxConcurrentJobs: number;
  maxQueuedJobsPerGarden: number;
}

export type VideoTranscriptionEnv = Record<string, string | undefined>;

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function intFromEnv(
  value: string | undefined,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  let result = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== undefined && result < min) result = fallback;
  if (max !== undefined && result > max) result = fallback;
  return result;
}

function stringFromEnv(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim() || fallback;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(candidate).toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

export function loadVideoTranscriptionConfig(
  env: VideoTranscriptionEnv = process.env,
): VideoTranscriptionConfig {
  const tempDir =
    stringFromEnv(env.VIDEO_TRANSCRIPTION_TEMP_DIR) ??
    path.join(os.tmpdir(), "breadboard-video-transcription");

  return {
    enabled: boolFromEnv(env.VIDEO_TRANSCRIPTION_ENABLED, true),

    scriberrBaseUrl: normalizeBaseUrl(
      env.SCRIBERR_BASE_URL,
      "http://127.0.0.1:8080",
    ),
    scriberrApiToken: stringFromEnv(env.SCRIBERR_API_TOKEN),
    scriberrUsername: stringFromEnv(env.SCRIBERR_USERNAME),
    scriberrPassword: stringFromEnv(env.SCRIBERR_PASSWORD),
    requestTimeoutMs: intFromEnv(env.SCRIBERR_REQUEST_TIMEOUT_MS, 30_000, {
      min: 1_000,
    }),
    transcriptionTimeoutMs: intFromEnv(
      env.SCRIBERR_TRANSCRIPTION_TIMEOUT_MS,
      21_600_000,
      { min: 60_000 },
    ),
    pollIntervalMs: intFromEnv(env.SCRIBERR_POLL_INTERVAL_MS, 3_000, {
      min: 500,
    }),

    scriberrModelFamily:
      stringFromEnv(env.SCRIBERR_MODEL_FAMILY) ?? "whisper",
    scriberrModel: stringFromEnv(env.SCRIBERR_MODEL) ?? "small",
    scriberrLanguage: stringFromEnv(env.SCRIBERR_LANGUAGE),
    scriberrDiarization: boolFromEnv(env.SCRIBERR_DIARIZATION, false),
    deleteScriberrJobs: boolFromEnv(
      env.VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS,
      false,
    ),

    maxUploadBytes:
      intFromEnv(env.VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB, 2048, {
        min: 1,
        // Runtime V2's sealed input protocol deliberately tops out at 2 GiB.
        max: 2048,
      }) *
      1024 *
      1024,
    maxDurationSeconds: intFromEnv(
      env.VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS,
      21_600,
      { min: 1 },
    ),
    tempDir,
    keepMedia: boolFromEnv(env.VIDEO_TRANSCRIPTION_KEEP_MEDIA, false),
    tempRetentionHours: intFromEnv(
      env.VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS,
      24,
      { min: 1 },
    ),

    ytdlpPath: stringFromEnv(env.YTDLP_PATH) ?? "yt-dlp",
    ffmpegPath: stringFromEnv(env.FFMPEG_PATH) ?? "ffmpeg",
    ffprobePath: stringFromEnv(env.FFPROBE_PATH) ?? "ffprobe",
    ytdlpDownloadTimeoutMs: intFromEnv(
      env.YTDLP_DOWNLOAD_TIMEOUT_MS,
      1_800_000,
      { min: 10_000 },
    ),

    maxConcurrentJobs: intFromEnv(
      env.VIDEO_TRANSCRIPTION_MAX_CONCURRENT,
      1,
      { min: 1, max: 8 },
    ),
    maxQueuedJobsPerGarden: intFromEnv(
      env.VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN,
      5,
      { min: 1, max: 100 },
    ),
  };
}

let cachedConfig: VideoTranscriptionConfig | null = null;

export function getVideoTranscriptionConfig(): VideoTranscriptionConfig {
  if (!cachedConfig) cachedConfig = loadVideoTranscriptionConfig();
  return cachedConfig;
}

/** Test hook: drop the cached config so env changes are picked up. */
export function resetVideoTranscriptionConfigCache(): void {
  cachedConfig = null;
}
