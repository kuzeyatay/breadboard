// Framework-thin core for the video-transcription API routes. All request
// validation, authorization calls, dedup, queue limits, and orchestration live
// here behind injected dependencies, so tests can exercise the exact route
// behavior (auth rejection, both/neither inputs, oversized media, playlist
// URLs, access control, cancel/retry, sanitized failures) without Next.js.

import {
  VideoTranscriptionError,
  sanitizeErrorForClient,
} from "./errors.ts";
import {
  isSupportedMediaExtension,
  sanitizeDisplayFilename,
  titleFromFilename,
} from "./paths.ts";
import { parseYouTubeUrl } from "./youtube.ts";
import {
  publicVideoTranscriptionJob,
  type ExistingVideoSource,
  type PublicVideoTranscriptionJob,
  type VideoTranscriptionJob,
  type YouTubeMediaMetadata,
} from "./types.ts";
import type { VideoTranscriptionConfig } from "./config.ts";
import type { VideoTranscriptionJobStore } from "./job-store.ts";
import type { VideoTranscriptionHealth } from "./health.ts";

export interface AuthorizedGarden {
  userId: number;
  clusterId: number;
  clusterSlug: string;
}

export interface VideoTranscriptionRouteDeps {
  config: VideoTranscriptionConfig;
  store: VideoTranscriptionJobStore;
  /** Throws RouteError(401/404) exactly like the rest of the app. */
  requireOwnedGarden(gardenId: string): Promise<AuthorizedGarden>;
  contentPath(): string | null;
  runnerKick(clusterId: number): void | Promise<void>;
  runnerStart(
    jobId: string,
    upload: SealedVideoTranscriptionUpload | null,
  ): Promise<VideoTranscriptionJob | null>;
  runnerCancel(jobId: string): Promise<VideoTranscriptionJob | null>;
  runnerRetry(jobId: string): Promise<VideoTranscriptionJob | null>;
  sealUpload(input: {
    garden: AuthorizedGarden;
    file: File;
    displayFilename: string;
    signal: AbortSignal;
  }): Promise<SealedVideoTranscriptionUpload>;
  abandonUpload(
    garden: AuthorizedGarden,
    uploadId: string,
  ): Promise<void>;
  inspectYouTube(garden: AuthorizedGarden, parsed: {
    videoId: string;
    canonicalUrl: string;
    originalUrl: string;
  }): Promise<YouTubeMediaMetadata>;
  findExistingVideoSource(input: {
    contentPath: string;
    clusterSlug: string;
    youtubeVideoId?: string | null;
    mediaSha256?: string | null;
    contentHash?: string | null;
  }): ExistingVideoSource | null;
  checkHealth(input: {
    userId: number;
    gardenId: string;
    contentPath: string | null;
    clusterSlug: string | null;
  }): Promise<VideoTranscriptionHealth>;
}

export interface SealedVideoTranscriptionUpload {
  uploadId: string;
  sha256: string;
  sizeBytes: number;
}

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

function errorResult(error: unknown): RouteResult {
  if (error instanceof VideoTranscriptionError) {
    const status =
      error.httpStatus ??
      (error.code === "queue_full"
        ? 429
        : error.code === "feature_disabled"
          ? 503
          : error.code === "scriberr_unavailable"
            ? 502
            : 400);
    return {
      status,
      body: { error: error.userMessage, errorCode: error.code },
    };
  }
  throw error; // RouteError and unknowns are handled by the route adapter.
}

function requireEnabled(config: VideoTranscriptionConfig): void {
  if (!config.enabled) {
    throw new VideoTranscriptionError("feature_disabled", { httpStatus: 503 });
  }
}

function jobResponse(job: VideoTranscriptionJob): PublicVideoTranscriptionJob {
  return publicVideoTranscriptionJob(job);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const parsed = (await request.json().catch(() => null)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export async function handleCreateVideoTranscription(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
  request: Request,
): Promise<RouteResult> {
  try {
    requireEnabled(deps.config);
    const garden = await deps.requireOwnedGarden(gardenId);
    const contentPath = deps.contentPath();
    if (!contentPath) {
      return {
        status: 500,
        body: { error: "QUARTZ_CONTENT_PATH not configured" },
      };
    }

    const contentType = request.headers.get("content-type") ?? "";
    const isMultipart = contentType.toLowerCase().includes("multipart/form-data");

    let inputKind: "upload" | "youtube";
    let youtube: {
      parsed: ReturnType<typeof parseYouTubeUrl>;
      metadata: YouTubeMediaMetadata | null;
    } | null = null;
    let upload: {
      file: File;
      displayFilename: string;
    } | null = null;
    let retranscribe = false;

    if (isMultipart) {
      // Reject oversized uploads before buffering the form when possible.
      const contentLength = Number.parseInt(
        request.headers.get("content-length") ?? "",
        10,
      );
      if (
        Number.isFinite(contentLength) &&
        contentLength > deps.config.maxUploadBytes + 1024 * 1024
      ) {
        throw new VideoTranscriptionError("media_too_large", { httpStatus: 413 });
      }

      const form = await request.formData();
      const media = form.get("media");
      const legacyVideo = form.get("video");
      if (media instanceof File && legacyVideo instanceof File) {
        throw new VideoTranscriptionError("invalid_input", {
          userMessage: "Attach one video or audio file, not both.",
          httpStatus: 400,
        });
      }
      const file = media instanceof File ? media : legacyVideo;
      const urlValue = form.get("youtubeUrl");
      retranscribe = form.get("retranscribe") === "true";
      if (typeof urlValue === "string" && urlValue.trim() && file instanceof File) {
        throw new VideoTranscriptionError("invalid_input", {
          userMessage:
            "Provide either a video or audio file or a YouTube URL, not both.",
          httpStatus: 400,
        });
      }
      if (!(file instanceof File)) {
        if (typeof urlValue === "string" && urlValue.trim()) {
          youtube = { parsed: parseYouTubeUrl(urlValue), metadata: null };
          inputKind = "youtube";
        } else {
          throw new VideoTranscriptionError("invalid_input", {
            userMessage: "Attach a video or audio file, or enter a YouTube URL.",
            httpStatus: 400,
          });
        }
      } else {
        if (file.size > deps.config.maxUploadBytes) {
          throw new VideoTranscriptionError("media_too_large", { httpStatus: 413 });
        }
        const displayFilename = sanitizeDisplayFilename(file.name);
        if (!isSupportedMediaExtension(displayFilename)) {
          throw new VideoTranscriptionError("media_unsupported", { httpStatus: 415 });
        }
        upload = { file, displayFilename };
        inputKind = "upload";
      }
    } else {
      const body = await readJsonBody(request);
      const url = body.youtubeUrl ?? body.url;
      retranscribe = body.retranscribe === true;
      if (body.video !== undefined || body.media !== undefined) {
        throw new VideoTranscriptionError("invalid_input", {
          userMessage: "Media uploads must use multipart/form-data.",
          httpStatus: 400,
        });
      }
      if (typeof url !== "string" || !url.trim()) {
        throw new VideoTranscriptionError("invalid_input", {
          userMessage: "Attach a video or audio file, or enter a YouTube URL.",
          httpStatus: 400,
        });
      }
      youtube = { parsed: parseYouTubeUrl(url), metadata: null };
      inputKind = "youtube";
    }

    // Queue limits are enforced per garden before any expensive work.
    const pending = deps.store.countPendingForCluster(garden.clusterId);
    if (pending >= deps.config.maxQueuedJobsPerGarden) {
      throw new VideoTranscriptionError("queue_full", { httpStatus: 429 });
    }

    if (inputKind === "youtube" && youtube) {
      // Metadata inspection (preview + duration policy). yt-dlp being absent
      // on the Breadboard side degrades gracefully — Scriberr does its own
      // download — but a metadata failure for the video itself is fatal.
      try {
        youtube.metadata = await deps.inspectYouTube(garden, youtube.parsed);
      } catch (error) {
        if (
          error instanceof VideoTranscriptionError &&
          error.code === "ytdlp_unavailable"
        ) {
          youtube.metadata = null;
        } else {
          throw error;
        }
      }
      const duration = youtube.metadata?.durationSeconds;
      if (
        typeof duration === "number" &&
        duration > deps.config.maxDurationSeconds
      ) {
        throw new VideoTranscriptionError("media_too_long", { httpStatus: 400 });
      }

      // Dedup by canonical video ID: existing source or unfinished job.
      if (!retranscribe) {
        const existingSource = deps.findExistingVideoSource({
          contentPath,
          clusterSlug: garden.clusterSlug,
          youtubeVideoId: youtube.parsed.videoId,
        });
        if (existingSource) {
          return {
            status: 200,
            body: { success: true, duplicate: true, source: existingSource },
          };
        }
        const existingJob = deps.store.findDuplicateJob({
          clusterId: garden.clusterId,
          youtubeVideoId: youtube.parsed.videoId,
        });
        if (existingJob) {
          return {
            status: 200,
            body: {
              success: true,
              duplicate: true,
              job: jobResponse(existingJob),
            },
          };
        }
      }

      const job = deps.store.createJob({
        clusterId: garden.clusterId,
        gardenSlug: garden.clusterSlug,
        userId: garden.userId,
        inputKind: "youtube",
        originalUrl: youtube.parsed.originalUrl,
        canonicalUrl: youtube.parsed.canonicalUrl,
        youtubeVideoId: youtube.parsed.videoId,
        sourceTitle:
          youtube.metadata?.title ?? `YouTube video ${youtube.parsed.videoId}`,
        videoMetadata: youtube.metadata,
      });
      await deps.runnerStart(job.id, null);
      return { status: 202, body: { success: true, job: jobResponse(job) } };
    }

    // ── Upload path ─────────────────────────────────────────────────────────
    if (!upload) {
      throw new VideoTranscriptionError("invalid_input", { httpStatus: 400 });
    }

    // Native Runtime seals and hashes the bounded body before any worker can
    // observe it. Next never writes a media temp file or passes a local path.
    const sealedUpload = await deps.sealUpload({
      garden,
      file: upload.file,
      displayFilename: upload.displayFilename,
      signal: request.signal,
    });
    const sha256 = sealedUpload.sha256;

    if (!retranscribe) {
      const existingSource = deps.findExistingVideoSource({
        contentPath,
        clusterSlug: garden.clusterSlug,
        mediaSha256: sha256,
      });
      if (existingSource) {
        await deps.abandonUpload(garden, sealedUpload.uploadId).catch(() => undefined);
        return {
          status: 200,
          body: { success: true, duplicate: true, source: existingSource },
        };
      }
      const existingJob = deps.store.findDuplicateJob({
        clusterId: garden.clusterId,
        mediaSha256: sha256,
      });
      if (existingJob) {
        await deps.abandonUpload(garden, sealedUpload.uploadId).catch(() => undefined);
        return {
          status: 200,
          body: {
            success: true,
            duplicate: true,
            job: jobResponse(existingJob),
          },
        };
      }
    }

    try {
      const job = deps.store.createJob({
        clusterId: garden.clusterId,
        gardenSlug: garden.clusterSlug,
        userId: garden.userId,
        inputKind: "upload",
        originalFilename: upload.displayFilename,
        sourceTitle: titleFromFilename(upload.displayFilename),
        mediaTempPath: null,
        mediaSha256: sha256,
      });
      await deps.runnerStart(job.id, sealedUpload);
      return { status: 202, body: { success: true, job: jobResponse(job) } };
    } catch (error) {
      // Harmless if Runtime already atomically claimed the upload; the native
      // owner rejects abandonment of an attached blob.
      await deps.abandonUpload(garden, sealedUpload.uploadId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleListVideoTranscriptions(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<RouteResult> {
  try {
    requireEnabled(deps.config);
    const garden = await deps.requireOwnedGarden(gardenId);
    // A visit is a natural moment to resume interrupted jobs after restarts.
    await deps.runnerKick(garden.clusterId);
    const jobs = deps.store
      .listJobsForCluster(garden.clusterId, { activeOnly, limit: 20 })
      .map(jobResponse);
    return { status: 200, body: { jobs } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleGetVideoTranscription(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
  jobId: string,
): Promise<RouteResult> {
  try {
    requireEnabled(deps.config);
    const garden = await deps.requireOwnedGarden(gardenId);
    await deps.runnerKick(garden.clusterId);
    const job = deps.store.getJobForCluster(jobId, garden.clusterId);
    if (!job) return { status: 404, body: { error: "Job not found" } };
    return { status: 200, body: { job: jobResponse(job) } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleCancelVideoTranscription(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
  jobId: string,
): Promise<RouteResult> {
  try {
    requireEnabled(deps.config);
    const garden = await deps.requireOwnedGarden(gardenId);
    const job = deps.store.getJobForCluster(jobId, garden.clusterId);
    if (!job) return { status: 404, body: { error: "Job not found" } };
    const updated = await deps.runnerCancel(jobId);
    return {
      status: 200,
      body: { success: true, job: updated ? jobResponse(updated) : null },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleRetryVideoTranscription(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
  jobId: string,
): Promise<RouteResult> {
  try {
    requireEnabled(deps.config);
    const garden = await deps.requireOwnedGarden(gardenId);
    const job = deps.store.getJobForCluster(jobId, garden.clusterId);
    if (!job) return { status: 404, body: { error: "Job not found" } };
    if (job.status !== "failed") {
      return {
        status: 409,
        body: { error: "Only failed jobs can be retried." },
      };
    }
    const updated = await deps.runnerRetry(jobId);
    return {
      status: 200,
      body: { success: true, job: updated ? jobResponse(updated) : null },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleInspectYouTube(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
  request: Request,
): Promise<RouteResult> {
  try {
    requireEnabled(deps.config);
    const garden = await deps.requireOwnedGarden(gardenId);
    const body = await readJsonBody(request);
    const parsed = parseYouTubeUrl(body.url ?? body.youtubeUrl);
    let metadata: YouTubeMediaMetadata | null = null;
    let metadataAvailable = true;
    try {
      metadata = await deps.inspectYouTube(garden, parsed);
    } catch (error) {
      if (
        error instanceof VideoTranscriptionError &&
        error.code === "ytdlp_unavailable"
      ) {
        metadataAvailable = false;
      } else {
        throw error;
      }
    }
    return {
      status: 200,
      body: {
        valid: true,
        videoId: parsed.videoId,
        canonicalUrl: parsed.canonicalUrl,
        metadataAvailable,
        metadata,
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleVideoTranscriptionHealth(
  deps: VideoTranscriptionRouteDeps,
  gardenId: string,
): Promise<RouteResult> {
  try {
    const garden = await deps.requireOwnedGarden(gardenId);
    const health = await deps.checkHealth({
      userId: garden.userId,
      gardenId: garden.clusterSlug,
      contentPath: deps.contentPath(),
      clusterSlug: garden.clusterSlug,
    });
    return { status: 200, body: { health } };
  } catch (error) {
    return errorResult(error);
  }
}

/** Map any error (including unexpected ones) to a sanitized job failure body. */
export function sanitizedFailureBody(error: unknown): Record<string, unknown> {
  return sanitizeErrorForClient(error);
}
