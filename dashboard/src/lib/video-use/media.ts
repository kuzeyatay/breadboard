// Reading a video well enough to plan an edit of it.
//
// ffmpeg and ffprobe now run only inside the sealed, disposable speech/media
// Runtime worker. The dashboard supplies an authenticated scope and a path in
// that user's Video Use session; it never chooses a process or argument list.

import {
  detectVideoSilencesViaRuntime,
  probeVideoViaRuntime,
  SpeechMediaRuntimeError,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
  /** Height greater than width — the renderer scales these by height. */
  portrait: boolean;
}

function mediaError(error: unknown): never {
  if (error instanceof SpeechMediaRuntimeError) throw new MediaError(error.message);
  throw error;
}

/** Container and stream facts. Every later decision is bounded by these. */
export async function probeVideo(
  filePath: string,
  scope: SpeechMediaRuntimeScope,
  signal?: AbortSignal,
): Promise<VideoProbe> {
  try {
    return await probeVideoViaRuntime(scope, filePath, { signal });
  } catch (error) {
    return mediaError(error);
  }
}

export interface SilenceWindow {
  start: number;
  end: number;
  durationSeconds: number;
}

/**
 * Where the audio drops out, as ffmpeg hears it.
 *
 * `-30dB` over 400ms mirrors the clone's own guidance that silences of 400ms
 * and up are the cleanest cut candidates, and that anything under 150ms is
 * unsafe because it is mid-phrase.
 */
export async function detectSilences(
  filePath: string,
  scope: SpeechMediaRuntimeScope,
  options: { thresholdDb?: number; minimumSeconds?: number; signal?: AbortSignal } = {},
): Promise<SilenceWindow[]> {
  try {
    return await detectVideoSilencesViaRuntime(scope, filePath, {
      thresholdDb: options.thresholdDb ?? -30,
      minimumSeconds: options.minimumSeconds ?? 0.4,
      signal: options.signal,
    });
  } catch (error) {
    return mediaError(error);
  }
}

/**
 * The silence map as the planner reads it: a compact table it can cut from
 * directly, capped so a long recording with a hundred pauses cannot crowd the
 * instruction out of the prompt.
 */
export function renderSilenceMap(
  windows: SilenceWindow[],
  durationSeconds: number,
  limit = 60,
): string {
  if (!windows.length) {
    return "No silences of 400ms or longer were found — the audio runs continuously.";
  }
  const longest = [...windows]
    .sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, limit)
    .sort((left, right) => left.start - right.start);
  const lines = longest.map(
    (window) =>
      `  [${window.start.toFixed(2)}-${window.end.toFixed(2)}] silence ${window.durationSeconds.toFixed(2)}s`,
  );
  const omitted = windows.length - longest.length;
  return [
    `Silence map (${windows.length} gap${windows.length === 1 ? "" : "s"} of 400ms or longer in ${durationSeconds.toFixed(1)}s):`,
    ...lines,
    omitted > 0 ? `  … ${omitted} shorter gap${omitted === 1 ? "" : "s"} not listed` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
