// Fetching a linked video once, into the chat's own video store.
//
// The finite work belongs to the sealed speech/media Runtime worker. The
// dashboard submits only a validated URL identity and adopts the finished file
// into the user's blob store; executable choice, arguments and process
// environment never cross this boundary.

import { adoptVideoBlob, type StoredVideoBlob } from "../conversations/video-blob-store.ts";
import {
  downloadVideoSourceViaRuntime,
  inspectVideoSourceViaRuntime,
  SpeechMediaRuntimeError,
  type RuntimeVideoSourceMetadata,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";
import {
  isVideoAttachmentFormat,
  type VideoAttachmentFormat,
} from "../video-attachments.ts";
import type { VideoSource } from "./identity.ts";
import { recordVideoSource } from "./store.ts";

/** Long enough that a fetch is a mistake rather than a wait. */
export const MAX_SOURCE_DURATION_SECONDS = 4 * 60 * 60;

export class VideoDownloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VideoDownloadError";
    this.code = code;
  }
}

export interface SourceMetadata {
  title: string;
  durationSeconds: number | null;
  isLive: boolean;
  extension: string;
}

export interface DownloadProgress {
  /** 0–100 when yt-dlp reports one. */
  percent: number;
  /** A short line for the composer: "Downloading · 42% · 3.1 MiB/s". */
  detail: string;
}

function runtimeDownloadError(error: unknown): never {
  if (error instanceof SpeechMediaRuntimeError) {
    throw new VideoDownloadError(error.code, error.message);
  }
  throw error;
}

/** Inspect one link in the same sealed worker that will download it. */
export async function inspectSource(
  scope: SpeechMediaRuntimeScope,
  source: VideoSource,
  options: { signal?: AbortSignal } = {},
): Promise<SourceMetadata> {
  try {
    const metadata: RuntimeVideoSourceMetadata = await inspectVideoSourceViaRuntime(
      scope,
      source,
      options,
    );
    return metadata;
  } catch (error) {
    return runtimeDownloadError(error);
  }
}

export interface DownloadedVideo {
  blob: StoredVideoBlob;
  title: string;
  durationSeconds: number | null;
}

/**
 * Fetch a linked video into this user's store and index it, so the next mention
 * of the same video is a lookup rather than a download.
 */
export async function downloadVideoSource(input: {
  userId: number;
  source: VideoSource;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
  root?: string;
}): Promise<DownloadedVideo> {
  const scope = { userId: input.userId, gardenId: null, conversationId: null };
  let downloaded;
  try {
    downloaded = await downloadVideoSourceViaRuntime(scope, input.source, {
      signal: input.signal,
      onProgress: input.onProgress,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new VideoDownloadError("aborted", "The download was stopped.");
    }
    return runtimeDownloadError(error);
  }

  try {
    if (!isVideoAttachmentFormat(downloaded.format)) {
      throw new VideoDownloadError(
        "unsupported_format",
        `That video arrived as .${downloaded.format}, which is not a format this can store.`,
      );
    }

    input.onProgress?.({ percent: 100, detail: "Storing the video" });
    const blob = await adoptVideoBlob({
      userId: input.userId,
      filePath: downloaded.filePath,
      format: downloaded.format as VideoAttachmentFormat,
      root: input.root,
    });

    recordVideoSource({
      userId: input.userId,
      key: input.source.key,
      blob,
      canonicalUrl: input.source.canonicalUrl,
      title: downloaded.metadata.title,
      durationSeconds: downloaded.metadata.durationSeconds,
      root: input.root,
    });

    return {
      blob,
      title: downloaded.metadata.title,
      durationSeconds: downloaded.metadata.durationSeconds,
    };
  } finally {
    downloaded.cleanup();
  }
}
