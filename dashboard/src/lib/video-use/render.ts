// Running the cut.
//
// The sealed speech/media Runtime worker owns the clone renderer, ffmpeg and
// ffprobe. The dashboard sends the validated edit program and receives only a
// bounded result plus progress checkpoints.

import {
  renderVideoProgramViaRuntime,
  SpeechMediaRuntimeError,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";
import { IDENTITY_TRANSFORM, type VideoEditProgram, type VideoTransform } from "./program.ts";
import type { VideoEditSession } from "./session.ts";

export class VideoRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoRenderError";
  }
}

export interface RenderProgress {
  /** A short line for the run card: "extracting 6 segments", "normalizing loudness". */
  stage: string;
  detail?: string;
}

export interface RenderResult {
  outputPath: string;
  durationSeconds: number;
  sizeBytes: number;
  width: number;
  height: number;
}

export function isIdentityTransform(transform: VideoTransform): boolean {
  return (
    transform.speed === IDENTITY_TRANSFORM.speed &&
    transform.mute === IDENTITY_TRANSFORM.mute &&
    transform.volumeDb === IDENTITY_TRANSFORM.volumeDb &&
    transform.fadeInSeconds === IDENTITY_TRANSFORM.fadeInSeconds &&
    transform.fadeOutSeconds === IDENTITY_TRANSFORM.fadeOutSeconds &&
    transform.reverse === IDENTITY_TRANSFORM.reverse
  );
}

export interface RenderInput {
  session: VideoEditSession;
  /** Kept for callers that also use the clone root for non-process metadata. */
  root: string;
  runtimeScope: SpeechMediaRuntimeScope;
  program: Omit<VideoEditProgram, "history" | "version">;
  quality: "final" | "preview";
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

export async function renderProgram(input: RenderInput): Promise<RenderResult> {
  try {
    return await renderVideoProgramViaRuntime(
      input.runtimeScope,
      input.session,
      input.program,
      input.quality,
      { signal: input.signal, onProgress: input.onProgress },
    );
  } catch (error) {
    if (input.signal?.aborted) throw new VideoRenderError("The edit was stopped.");
    if (error instanceof SpeechMediaRuntimeError) throw new VideoRenderError(error.message);
    throw error;
  }
}
