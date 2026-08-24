// Asynchronous job runner for video transcriptions.
//
// The creation route persists a queued job and returns 202 immediately; this
// runner drains the queue in the background with a configurable concurrency
// limit, checkpointing every stage in SQLite so jobs survive page refreshes
// and dev-server restarts. Stages that already completed (Scriberr job
// created, transcript fetched, Markdown written) are never repeated on
// retry/resume — in particular, retrying a failed indexing step never
// re-transcribes.

import crypto from "crypto";
import fs from "fs";
import path from "path";

import { VideoTranscriptionError, sanitizeErrorForClient } from "./errors.ts";
import { assertProbeAcceptable } from "./ffprobe.ts";
import {
  buildTranscriptMarkdown,
  type TranscriptSourceInfo,
} from "./transcript-markdown.ts";
import {
  detectSuspiciouslyIncomplete,
  normalizeScriberrTranscript,
} from "./transcript-normalizer.ts";
import { removePathWithRetries, sweepStaleTempDirs } from "./paths.ts";
import type { VideoTranscriptionConfig } from "./config.ts";
import type {
  VideoTranscriptionJobStore,
} from "./job-store.ts";
import type { TranscriptIngestResult } from "./ingest.ts";
import type {
  ExistingVideoSource,
  MediaProbeResult,
  NormalizedTranscript,
  ScriberrJobSnapshot,
  ScriberrTranscript,
  VideoTranscriptionJob,
} from "./types.ts";

/** The subset of ScriberrClient the runner needs (injectable for tests). */
export interface ScriberrOps {
  uploadVideo(input: {
    filePath: string;
    filename: string;
    title?: string | null;
  }): Promise<ScriberrJobSnapshot>;
  downloadYouTube(input: {
    url: string;
    title?: string | null;
    timeoutMs: number;
  }): Promise<ScriberrJobSnapshot>;
  startTranscription(
    scriberrJobId: string,
    params: {
      modelFamily?: string;
      model?: string;
      language?: string | null;
      diarize?: boolean;
    },
  ): Promise<ScriberrJobSnapshot>;
  getJobStatus(scriberrJobId: string): Promise<ScriberrJobSnapshot>;
  getTranscript(scriberrJobId: string): Promise<{
    available: boolean;
    transcript: ScriberrTranscript | null;
  }>;
  killJob(scriberrJobId: string): Promise<void>;
  deleteJob(scriberrJobId: string): Promise<void>;
}

export interface VideoTranscriptionRunnerDeps {
  config: VideoTranscriptionConfig;
  store: VideoTranscriptionJobStore;
  createScriberrClient(): ScriberrOps;
  probeMedia(filePath: string): Promise<MediaProbeResult>;
  ingest(input: {
    contentPath: string;
    clusterSlug: string;
    sourceTitle: string;
    sourceFileName: string;
    sourceLabel: string;
    markdownBody: string;
    plainText: string;
    metadata: Record<string, string | string[]>;
    youtubeVideoId?: string | null;
    mediaSha256?: string | null;
    jobId: string;
    onProgress?: (step: string) => void;
  }): Promise<TranscriptIngestResult>;
  resumeIndexing(input: {
    contentPath: string;
    clusterSlug: string;
  }): Promise<void>;
  findExistingVideoSource(input: {
    contentPath: string;
    clusterSlug: string;
    youtubeVideoId?: string | null;
    mediaSha256?: string | null;
    contentHash?: string | null;
  }): ExistingVideoSource | null;
  contentPath(): string;
  withScriberrLease?<T>(reason: string, operation: () => Promise<T>): Promise<T>;
  sleep?(ms: number): Promise<void>;
  log?(message: string): void;
}

class CancelledSignal extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledSignal";
  }
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 120_000;
const TEMP_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VideoTranscriptionRunner {
  private deps: VideoTranscriptionRunnerDeps;
  private active = new Set<string>();
  private draining = false;
  private lastTempSweepAt = 0;

  constructor(deps: VideoTranscriptionRunnerDeps) {
    this.deps = deps;
  }

  private log(message: string): void {
    (this.deps.log ?? ((m: string) => console.info(`[video-transcription] ${m}`)))(
      message,
    );
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? defaultSleep)(ms);
  }

  /** Wake the scheduler: recover interrupted jobs, then drain the queue. */
  kick(): void {
    this.recoverStaleJobs();
    this.maybeSweepTemp();
    if (this.draining) return;
    this.draining = true;
    void this.drainQueue().finally(() => {
      this.draining = false;
    });
  }

  private async drainQueue(): Promise<void> {
    for (;;) {
      let claimed: VideoTranscriptionJob | null = null;
      try {
        claimed = this.deps.store.claimNextQueuedJob(
          this.deps.config.maxConcurrentJobs,
        );
      } catch (error) {
        this.log(`queue claim failed: ${error instanceof Error ? error.message : error}`);
        return;
      }
      if (!claimed) return;
      const job = claimed;
      this.active.add(job.id);
      void this.executeFromStart(job)
        .catch((error) => {
          this.log(
            `job ${job.id} crashed outside stage handling: ${
              error instanceof Error ? error.message : error
            }`,
          );
        })
        .finally(() => {
          this.active.delete(job.id);
          // A finished job frees a slot; check for more queued work.
          this.kick();
        });
    }
  }

  private maybeSweepTemp(): void {
    const now = Date.now();
    if (now - this.lastTempSweepAt < TEMP_SWEEP_INTERVAL_MS) return;
    this.lastTempSweepAt = now;
    void sweepStaleTempDirs(
      this.deps.config.tempDir,
      this.deps.config.tempRetentionHours,
    ).catch(() => undefined);
  }

  /** Resume or fail jobs whose runner died (server restart, crash). */
  private recoverStaleJobs(): void {
    let stale: VideoTranscriptionJob[] = [];
    try {
      stale = this.deps.store.listStaleJobs(STALE_AFTER_MS);
    } catch {
      return;
    }
    for (const job of stale) {
      if (this.active.has(job.id)) continue;
      if (job.cancelRequested) {
        void this.finalizeCancelled(job.id);
        continue;
      }
      if (job.transcriptJson) {
        // Transcript already checkpointed: resume from formatting.
        this.active.add(job.id);
        void this.executeFromTranscript(job.id)
          .catch(() => undefined)
          .finally(() => {
            this.active.delete(job.id);
            this.kick();
          });
        continue;
      }
      if (job.scriberrJobId) {
        // Scriberr keeps transcribing regardless of Breadboard restarts:
        // re-attach the poller.
        this.active.add(job.id);
        void this.executeFromScriberrJob(job.id)
          .catch(() => undefined)
          .finally(() => {
            this.active.delete(job.id);
            this.kick();
          });
        continue;
      }
      // Interrupted before any recoverable checkpoint existed.
      this.deps.store.transition(job.id, "failed", {
        errorCode: "job_interrupted",
        errorMessage: new VideoTranscriptionError("job_interrupted").userMessage,
      });
      void this.cleanupTempMedia(job.id);
    }
  }

  isActive(jobId: string): boolean {
    return this.active.has(jobId);
  }

  /**
   * Request cancellation. Queued jobs and orphaned jobs finalize immediately;
   * jobs actively running in this process observe the flag between stages.
   */
  async requestCancel(jobId: string): Promise<VideoTranscriptionJob | null> {
    const job = this.deps.store.getJob(jobId);
    if (!job) return null;
    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      return job;
    }
    this.deps.store.updateJob(jobId, { cancelRequested: true });
    if (job.status === "queued" || !this.active.has(jobId)) {
      await this.finalizeCancelled(jobId);
    }
    return this.deps.store.getJob(jobId);
  }

  private async finalizeCancelled(jobId: string): Promise<void> {
    const job = this.deps.store.getJob(jobId);
    if (!job || job.status === "cancelled") return;
    if (job.scriberrJobId) {
      try {
        await this.deps.createScriberrClient().killJob(job.scriberrJobId);
      } catch {
        // Cancellation must succeed locally even if Scriberr is unreachable.
      }
    }
    this.deps.store.transition(jobId, "cancelled", {
      errorCode: "cancelled",
      errorMessage: new VideoTranscriptionError("cancelled").userMessage,
    });
    await this.cleanupTempMedia(jobId);
  }

  /** Retry a failed job from its latest checkpoint. */
  async retry(jobId: string): Promise<VideoTranscriptionJob | null> {
    const job = this.deps.store.getJob(jobId);
    if (!job || job.status !== "failed") return job;

    this.deps.store.updateJob(jobId, {
      errorCode: null,
      errorMessage: null,
      cancelRequested: false,
    });

    if (job.transcriptJson) {
      // Markdown/indexing retry: never touches Scriberr again.
      this.deps.store.transition(jobId, "formatting_markdown", {
        currentStage: "Formatting transcript",
        progressPercent: 85,
      });
      this.active.add(jobId);
      void this.executeFromTranscript(jobId)
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(jobId);
          this.kick();
        });
      return this.deps.store.getJob(jobId);
    }

    if (job.scriberrJobId) {
      this.deps.store.transition(jobId, "transcribing", {
        currentStage: "Transcribing",
        progressPercent: 25,
      });
      this.active.add(jobId);
      void this.executeFromScriberrJob(jobId)
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(jobId);
          this.kick();
        });
      return this.deps.store.getJob(jobId);
    }

    if (
      job.inputKind === "upload" &&
      (!job.mediaTempPath || !fs.existsSync(job.mediaTempPath))
    ) {
      this.deps.store.transition(jobId, "failed", {
        errorCode: "media_missing",
        errorMessage: new VideoTranscriptionError("media_missing").userMessage,
      });
      return this.deps.store.getJob(jobId);
    }

    // Full restart: back into the queue.
    this.deps.store.transition(jobId, "queued", {
      currentStage: null,
      progressPercent: null,
      completedAt: null,
    });
    this.kick();
    return this.deps.store.getJob(jobId);
  }

  // ── Pipeline execution ────────────────────────────────────────────────────

  private requireJob(jobId: string): VideoTranscriptionJob {
    const job = this.deps.store.getJob(jobId);
    if (!job) throw new VideoTranscriptionError("internal_error", { detail: "job vanished" });
    return job;
  }

  private checkCancelled(jobId: string): void {
    const job = this.deps.store.getJob(jobId);
    if (!job || job.cancelRequested || job.status === "cancelled") {
      throw new CancelledSignal();
    }
  }

  private withScriberrLease<T>(reason: string, operation: () => Promise<T>): Promise<T> {
    return this.deps.withScriberrLease
      ? this.deps.withScriberrLease(reason, operation)
      : operation();
  }

  private startHeartbeat(jobId: string): () => void {
    const timer = setInterval(() => {
      try {
        this.deps.store.markHeartbeat(jobId);
      } catch {
        // Heartbeat failures must never crash the job.
      }
    }, HEARTBEAT_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async executeFromStart(job: VideoTranscriptionJob): Promise<void> {
    const stopHeartbeat = this.startHeartbeat(job.id);
    try {
      this.checkCancelled(job.id);

      if (job.inputKind === "upload") {
        await this.stageValidateUpload(job.id);
      } else {
        await this.stageValidateYouTube(job.id);
      }
      await this.withScriberrLease(`transcription-${job.id}`, async () => {
        if (job.inputKind === "upload") await this.stageUploadToScriberr(job.id);
        else await this.stageDownloadYouTube(job.id);
        await this.stageStartTranscription(job.id);
        await this.stagePollTranscription(job.id);
      });
      await this.executeFromTranscriptInner(job.id);
    } catch (error) {
      await this.handleFailure(job.id, error);
    } finally {
      stopHeartbeat();
    }
  }

  private async executeFromScriberrJob(jobId: string): Promise<void> {
    const stopHeartbeat = this.startHeartbeat(jobId);
    try {
      this.checkCancelled(jobId);
      const job = this.requireJob(jobId);
      if (!job.scriberrJobId) {
        throw new VideoTranscriptionError("job_interrupted");
      }
      // The Scriberr job may still be waiting to start (e.g. resume after a
      // crash between upload and start, or a failed Scriberr-side run).
      await this.withScriberrLease(`transcription-resume-${jobId}`, async () => {
        const client = this.deps.createScriberrClient();
        const snapshot = await client.getJobStatus(job.scriberrJobId!);
        if (snapshot.status === "uploaded" || snapshot.status === "failed") {
          await this.stageStartTranscription(jobId);
        }
        await this.stagePollTranscription(jobId);
      });
      await this.executeFromTranscriptInner(jobId);
    } catch (error) {
      await this.handleFailure(jobId, error);
    } finally {
      stopHeartbeat();
    }
  }

  private async executeFromTranscript(jobId: string): Promise<void> {
    const stopHeartbeat = this.startHeartbeat(jobId);
    try {
      this.checkCancelled(jobId);
      await this.executeFromTranscriptInner(jobId);
    } catch (error) {
      await this.handleFailure(jobId, error);
    } finally {
      stopHeartbeat();
    }
  }

  private async handleFailure(jobId: string, error: unknown): Promise<void> {
    if (error instanceof CancelledSignal) {
      await this.finalizeCancelled(jobId);
      return;
    }
    const { errorCode, errorMessage } = sanitizeErrorForClient(error);
    const detail = error instanceof Error ? error.message : String(error);
    this.log(`job ${jobId} failed (${errorCode}): ${detail}`);
    this.deps.store.transition(jobId, "failed", { errorCode, errorMessage });
    // Media is kept for retryable pre-submission failures so retry can rerun;
    // it is dropped once a Scriberr job exists (Scriberr has its own copy).
    const job = this.deps.store.getJob(jobId);
    if (job?.scriberrJobId && !this.deps.config.keepMedia) {
      await this.cleanupTempMedia(jobId);
    }
  }

  private async stageValidateUpload(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    this.deps.store.transition(jobId, "validating", {
      currentStage: "Validating video",
      progressPercent: 5,
    });
    if (!job.mediaTempPath || !fs.existsSync(job.mediaTempPath)) {
      throw new VideoTranscriptionError("media_missing");
    }
    const probe = await this.deps.probeMedia(job.mediaTempPath);
    assertProbeAcceptable(probe, {
      maxDurationSeconds: this.deps.config.maxDurationSeconds,
    });
    if (probe.durationSeconds !== null) {
      const metadata = job.videoMetadata;
      this.deps.store.updateJob(jobId, {
        videoMetadata: metadata
          ? { ...metadata, durationSeconds: Math.round(probe.durationSeconds) }
          : {
              videoId: "",
              canonicalUrl: "",
              title: job.sourceTitle,
              channel: null,
              durationSeconds: Math.round(probe.durationSeconds),
              thumbnailUrl: null,
              uploadDate: null,
            },
      });
    }
    this.checkCancelled(jobId);
  }

  private async stageValidateYouTube(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    this.deps.store.transition(jobId, "validating", {
      currentStage: "Checking YouTube URL",
      progressPercent: 5,
    });
    if (!job.canonicalUrl || !job.youtubeVideoId) {
      throw new VideoTranscriptionError("youtube_invalid_url");
    }
    const duration = job.videoMetadata?.durationSeconds;
    if (
      typeof duration === "number" &&
      duration > this.deps.config.maxDurationSeconds
    ) {
      throw new VideoTranscriptionError("media_too_long");
    }
    this.checkCancelled(jobId);
  }

  private async stageUploadToScriberr(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    this.deps.store.transition(jobId, "uploading", {
      currentStage: "Uploading to Scriberr",
      progressPercent: 12,
    });
    const client = this.deps.createScriberrClient();
    const snapshot = await client.uploadVideo({
      filePath: job.mediaTempPath ?? "",
      filename: job.originalFilename ?? "video.mp4",
      title: job.sourceTitle,
    });
    this.deps.store.updateJob(jobId, { scriberrJobId: snapshot.id });
    this.checkCancelled(jobId);
  }

  private async stageDownloadYouTube(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    this.deps.store.transition(jobId, "downloading", {
      currentStage: "Downloading video",
      progressPercent: 12,
    });
    const client = this.deps.createScriberrClient();
    const snapshot = await client.downloadYouTube({
      url: job.canonicalUrl ?? "",
      title: job.sourceTitle,
      timeoutMs: this.deps.config.ytdlpDownloadTimeoutMs,
    });
    this.deps.store.updateJob(jobId, { scriberrJobId: snapshot.id });
    this.checkCancelled(jobId);
  }

  private async stageStartTranscription(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    if (!job.scriberrJobId) throw new VideoTranscriptionError("internal_error");
    this.deps.store.transition(jobId, "submitting_to_scriberr", {
      currentStage: "Submitting to Scriberr",
      progressPercent: 20,
    });
    const client = this.deps.createScriberrClient();
    await client.startTranscription(job.scriberrJobId, {
      modelFamily: this.deps.config.scriberrModelFamily,
      model: this.deps.config.scriberrModel,
      language: this.deps.config.scriberrLanguage,
      diarize: this.deps.config.scriberrDiarization,
    });
    this.checkCancelled(jobId);
  }

  private async stagePollTranscription(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    if (!job.scriberrJobId) throw new VideoTranscriptionError("internal_error");
    this.deps.store.transition(jobId, "transcribing", {
      currentStage: "Transcribing",
      progressPercent: 25,
    });
    const client = this.deps.createScriberrClient();
    const deadline = Date.now() + this.deps.config.transcriptionTimeoutMs;

    for (;;) {
      this.checkCancelled(jobId);
      if (Date.now() > deadline) {
        try {
          await client.killJob(job.scriberrJobId);
        } catch {
          // Best effort; timeout is reported either way.
        }
        throw new VideoTranscriptionError("transcription_timeout");
      }
      const snapshot = await client.getJobStatus(job.scriberrJobId);
      if (snapshot.status === "completed") break;
      if (snapshot.status === "failed") {
        throw new VideoTranscriptionError("transcription_failed", {
          detail: snapshot.errorMessage ?? "scriberr job failed",
        });
      }
      this.deps.store.markHeartbeat(jobId);
      await this.sleep(this.deps.config.pollIntervalMs);
    }

    // Retrieve and normalize the transcript, then checkpoint it.
    const payload = await client.getTranscript(job.scriberrJobId);
    if (!payload.available || !payload.transcript) {
      throw new VideoTranscriptionError("transcript_unavailable");
    }
    const current = this.requireJob(jobId);
    const normalized = normalizeScriberrTranscript(payload.transcript, {
      title: current.sourceTitle ?? "Video transcript",
      sourceType: current.inputKind === "youtube" ? "youtube" : "video_upload",
      fallbackDurationSeconds: current.videoMetadata?.durationSeconds ?? null,
      transcriptionModel: this.deps.config.scriberrModel,
    });
    const warning = detectSuspiciouslyIncomplete(
      normalized,
      current.videoMetadata?.durationSeconds ?? null,
    );
    if (warning) this.log(`job ${jobId}: ${warning}`);
    this.deps.store.updateJob(jobId, {
      transcriptJson: JSON.stringify(normalized),
    });

    // Scriberr no longer needs the local media copy.
    if (!this.deps.config.keepMedia) {
      await this.cleanupTempMedia(jobId);
    }
  }

  private async executeFromTranscriptInner(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    if (!job.transcriptJson) {
      throw new VideoTranscriptionError("job_interrupted");
    }
    let transcript: NormalizedTranscript;
    try {
      transcript = JSON.parse(job.transcriptJson) as NormalizedTranscript;
    } catch {
      throw new VideoTranscriptionError("transcript_malformed", {
        detail: "stored transcript checkpoint was unreadable",
      });
    }

    this.deps.store.transition(jobId, "formatting_markdown", {
      currentStage: "Formatting transcript",
      progressPercent: 85,
    });

    const source: TranscriptSourceInfo =
      job.inputKind === "youtube"
        ? {
            kind: "youtube",
            originalUrl: job.originalUrl ?? job.canonicalUrl ?? "",
            canonicalUrl: job.canonicalUrl ?? "",
            videoId: job.youtubeVideoId ?? "",
            metadata: job.videoMetadata,
          }
        : {
            kind: "upload",
            originalFilename: job.originalFilename ?? "video",
            mediaSha256: job.mediaSha256,
          };

    const markdown = buildTranscriptMarkdown({
      transcript,
      source,
      transcribedAt: job.completedAt ?? new Date().toISOString(),
    });
    this.deps.store.updateJob(jobId, { contentHash: markdown.contentHash });
    this.checkCancelled(jobId);

    const contentPath = this.deps.contentPath();

    // Idempotency: if this exact source already exists (same video, media, or
    // generated content), reuse it rather than writing a duplicate.
    const existing = this.deps.findExistingVideoSource({
      contentPath,
      clusterSlug: job.gardenId,
      youtubeVideoId: job.youtubeVideoId,
      mediaSha256: job.mediaSha256,
      contentHash: markdown.contentHash,
    });
    if (existing) {
      // The file exists; make sure indexing reflects it, then complete.
      this.deps.store.transition(jobId, "indexing_source", {
        currentStage: "Indexing source",
        progressPercent: 95,
      });
      try {
        await this.deps.resumeIndexing({ contentPath, clusterSlug: job.gardenId });
      } catch (error) {
        throw new VideoTranscriptionError("indexing_failed", { cause: error });
      }
      await this.completeJob(jobId, {
        sourceSlug: existing.sourceSlug,
        sourceRelPath: existing.sourceRelPath,
      });
      return;
    }

    this.deps.store.transition(jobId, "writing_source", {
      currentStage: "Writing source",
      progressPercent: 90,
    });

    let result: TranscriptIngestResult;
    try {
      result = await this.deps.ingest({
        contentPath,
        clusterSlug: job.gardenId,
        sourceTitle: transcript.title,
        sourceFileName:
          job.inputKind === "youtube"
            ? (job.canonicalUrl ?? "youtube-video")
            : (job.originalFilename ?? "video"),
        sourceLabel:
          job.inputKind === "youtube"
            ? (job.canonicalUrl ?? "YouTube video")
            : `video upload: ${job.originalFilename ?? "video"}`,
        markdownBody: markdown.body,
        plainText: markdown.plainText,
        metadata: markdown.metadata,
        youtubeVideoId: job.youtubeVideoId,
        mediaSha256: job.mediaSha256,
        jobId,
        onProgress: (step: string) => {
          if (/Refreshing|Publishing/i.test(step)) {
            this.deps.store.transition(jobId, "indexing_source", {
              currentStage: "Indexing source",
              progressPercent: 95,
            });
          } else {
            this.deps.store.markHeartbeat(jobId);
          }
        },
      });
    } catch (error) {
      // Distinguish "Markdown written but indexing failed" (recoverable
      // without re-transcribing) from "nothing was written".
      const written = this.deps.findExistingVideoSource({
        contentPath,
        clusterSlug: job.gardenId,
        contentHash: markdown.contentHash,
      });
      if (written) {
        this.deps.store.updateJob(jobId, {
          outputRelativePath: written.sourceRelPath,
          sourceSlug: written.sourceSlug,
        });
        throw new VideoTranscriptionError("indexing_failed", { cause: error });
      }
      if (error instanceof VideoTranscriptionError) throw error;
      throw new VideoTranscriptionError("markdown_write_failed", { cause: error });
    }

    await this.completeJob(jobId, {
      sourceSlug: result.sourceSlug,
      sourceRelPath: result.sourceRelPath,
    });
  }

  private async completeJob(
    jobId: string,
    { sourceSlug, sourceRelPath }: { sourceSlug: string; sourceRelPath: string },
  ): Promise<void> {
    this.deps.store.transition(jobId, "completed", {
      currentStage: "Complete",
      progressPercent: 100,
      outputRelativePath: sourceRelPath,
      sourceSlug,
      errorCode: null,
      errorMessage: null,
    });
    await this.cleanupTempMedia(jobId);
    const job = this.deps.store.getJob(jobId);
    if (job?.scriberrJobId && this.deps.config.deleteScriberrJobs) {
      try {
        await this.deps.createScriberrClient().deleteJob(job.scriberrJobId);
      } catch {
        // Scriberr-side cleanup is best-effort by design.
      }
    }
  }

  private async cleanupTempMedia(jobId: string): Promise<void> {
    if (this.deps.config.keepMedia) return;
    const job = this.deps.store.getJob(jobId);
    if (!job?.mediaTempPath) return;
    // Delete the whole job directory (media lives in <tempDir>/<jobId>/...).
    const tempRoot = this.deps.config.tempDir;
    const target = job.mediaTempPath;
    await removePathWithRetries(target, { root: tempRoot });
    await removePathWithRetries(path.dirname(target), { root: tempRoot });
    this.deps.store.updateJob(jobId, { mediaTempPath: null });
  }
}

/** SHA-256 of a file, streamed. */
export async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
