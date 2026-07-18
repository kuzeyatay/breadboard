// Client-safe helpers for the Garden Chat video import UI: stage labels,
// polling cadence, input validation, and display formatting. Pure functions
// only — unit tested directly, shared by the panel component.

import type {
  PublicVideoTranscriptionJob,
  VideoTranscriptionStatus,
} from "./scriberr/types";
import { isTerminalVideoTranscriptionStatus } from "./scriberr/types";
import { parseYouTubeUrl } from "./scriberr/youtube";

export const ACCEPTED_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".m4v",
] as const;

export const VIDEO_FILE_ACCEPT_ATTR = ACCEPTED_VIDEO_EXTENSIONS.join(",");

export function isAcceptedVideoFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const UPLOAD_STAGES: Array<{ status: VideoTranscriptionStatus; label: string }> = [
  { status: "validating", label: "Validating video" },
  { status: "uploading", label: "Uploading to Scriberr" },
  { status: "transcribing", label: "Transcribing" },
  { status: "formatting_markdown", label: "Formatting transcript" },
  { status: "writing_source", label: "Writing source" },
  { status: "indexing_source", label: "Indexing source" },
  { status: "completed", label: "Complete" },
];

const YOUTUBE_STAGES: Array<{ status: VideoTranscriptionStatus; label: string }> = [
  { status: "validating", label: "Checking YouTube URL" },
  { status: "downloading", label: "Downloading video" },
  { status: "transcribing", label: "Transcribing" },
  { status: "formatting_markdown", label: "Formatting transcript" },
  { status: "writing_source", label: "Writing source" },
  { status: "indexing_source", label: "Indexing source" },
  { status: "completed", label: "Complete" },
];

/** Position of a status inside the stage list (submitting maps onto its group). */
const STAGE_ALIASES: Partial<Record<VideoTranscriptionStatus, VideoTranscriptionStatus>> = {
  queued: "validating",
  preparing_media: "validating",
  submitting_to_scriberr: "transcribing",
};

export function stagesForInputKind(
  inputKind: "upload" | "youtube",
): Array<{ status: VideoTranscriptionStatus; label: string }> {
  return inputKind === "youtube" ? YOUTUBE_STAGES : UPLOAD_STAGES;
}

export function stageIndexForStatus(
  inputKind: "upload" | "youtube",
  status: VideoTranscriptionStatus,
): number {
  const canonical = STAGE_ALIASES[status] ?? status;
  const stages = stagesForInputKind(inputKind);
  const index = stages.findIndex((stage) => stage.status === canonical);
  return index === -1 ? 0 : index;
}

export function statusLabel(job: PublicVideoTranscriptionJob): string {
  if (job.status === "queued") return "Queued";
  if (job.status === "failed") return "Failed";
  if (job.status === "cancelled") return "Cancelled";
  if (job.currentStage) return job.currentStage;
  const stages = stagesForInputKind(job.inputKind);
  return stages[stageIndexForStatus(job.inputKind, job.status)]?.label ?? job.status;
}

export function isTerminalJob(job: Pick<PublicVideoTranscriptionJob, "status">): boolean {
  return isTerminalVideoTranscriptionStatus(job.status);
}

export function hasActiveJob(
  jobs: Array<Pick<PublicVideoTranscriptionJob, "status">>,
): boolean {
  return jobs.some((job) => !isTerminalJob(job));
}

/**
 * Polling cadence with backoff: 2.5s for the first minute, 5s until five
 * minutes, then 10s. Returns 0 (stop polling) when no job is active.
 */
export function nextPollDelayMs(
  jobs: Array<Pick<PublicVideoTranscriptionJob, "status">>,
  elapsedMs: number,
): number {
  if (!hasActiveJob(jobs)) return 0;
  if (elapsedMs < 60_000) return 2_500;
  if (elapsedMs < 300_000) return 5_000;
  return 10_000;
}

export interface VideoInputValidation {
  ok: boolean;
  message?: string;
}

/** Client-side mirror of server validation for immediate feedback. */
export function validateYouTubeInput(url: string): VideoInputValidation {
  if (!url.trim()) return { ok: false, message: "Enter a YouTube URL." };
  try {
    parseYouTubeUrl(url);
    return { ok: true };
  } catch (error) {
    const message =
      error && typeof error === "object" && "userMessage" in error
        ? String((error as { userMessage: string }).userMessage)
        : "That is not a valid YouTube video URL.";
    return { ok: false, message };
  }
}

export function validateVideoFile(
  file: { name: string; size: number },
  maxUploadBytes: number,
): VideoInputValidation {
  if (!isAcceptedVideoFilename(file.name)) {
    return {
      ok: false,
      message: `Unsupported file type. Accepted: ${ACCEPTED_VIDEO_EXTENSIONS.join(" ")}`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, message: "This file is empty." };
  }
  if (file.size > maxUploadBytes) {
    return {
      ok: false,
      message: `File is too large (limit ${formatBytes(maxUploadBytes)}).`,
    };
  }
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function formatElapsed(startedAtIso: string, nowMs: number): string {
  const started = Date.parse(startedAtIso);
  if (!Number.isFinite(started)) return "";
  const totalSeconds = Math.max(0, Math.floor((nowMs - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatVideoDuration(durationSeconds: number | null): string {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) return "";
  const total = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
