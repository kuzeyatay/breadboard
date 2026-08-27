// SQLite-backed persistence for video transcription jobs. Jobs survive UI
// navigation and dev-server restarts; the schema is additive (its own table)
// and applied with CREATE TABLE IF NOT EXISTS, matching the repo's migration
// style. The store is a plain class over an injected database handle so tests
// can run it against an in-memory SQLite database.

import crypto from "crypto";
import type DatabaseType from "better-sqlite3";

import type {
  VideoTranscriptionInputKind,
  VideoTranscriptionJob,
  VideoTranscriptionStatus,
  YouTubeMediaMetadata,
} from "./types.ts";
import { isTerminalVideoTranscriptionStatus } from "./types.ts";

type Db = DatabaseType.Database;

export function ensureVideoTranscriptionSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_transcription_jobs (
      id                   TEXT PRIMARY KEY,
      cluster_id           INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      garden_slug          TEXT NOT NULL,
      user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      input_kind           TEXT NOT NULL CHECK (input_kind IN ('upload','youtube')),
      status               TEXT NOT NULL,
      progress_percent     REAL,
      current_stage        TEXT,
      original_filename    TEXT,
      original_url         TEXT,
      canonical_url        TEXT,
      youtube_video_id     TEXT,
      source_title         TEXT,
      video_metadata_json  TEXT,
      media_temp_path      TEXT,
      media_sha256         TEXT,
      scriberr_job_id      TEXT,
      transcript_json      TEXT,
      output_relative_path TEXT,
      source_slug          TEXT,
      content_hash         TEXT,
      error_code           TEXT,
      error_message        TEXT,
      cancel_requested     INTEGER NOT NULL DEFAULT 0,
      runtime_job_id       TEXT,
      runtime_idempotency_key TEXT,
      runtime_generation   INTEGER NOT NULL DEFAULT 0,
      heartbeat_at         TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      completed_at         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_video_transcription_jobs_cluster
      ON video_transcription_jobs(cluster_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_transcription_jobs_status
      ON video_transcription_jobs(status);
  `);

  const columns = db.prepare("PRAGMA table_info(video_transcription_jobs)").all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("runtime_job_id")) {
    db.exec("ALTER TABLE video_transcription_jobs ADD COLUMN runtime_job_id TEXT");
  }
  if (!names.has("runtime_idempotency_key")) {
    db.exec("ALTER TABLE video_transcription_jobs ADD COLUMN runtime_idempotency_key TEXT");
  }
  if (!names.has("runtime_generation")) {
    db.exec(
      "ALTER TABLE video_transcription_jobs ADD COLUMN runtime_generation INTEGER NOT NULL DEFAULT 0",
    );
  }
}

interface JobRow {
  id: string;
  cluster_id: number;
  garden_slug: string;
  user_id: number;
  input_kind: string;
  status: string;
  progress_percent: number | null;
  current_stage: string | null;
  original_filename: string | null;
  original_url: string | null;
  canonical_url: string | null;
  youtube_video_id: string | null;
  source_title: string | null;
  video_metadata_json: string | null;
  media_temp_path: string | null;
  media_sha256: string | null;
  scriberr_job_id: string | null;
  transcript_json: string | null;
  output_relative_path: string | null;
  source_slug: string | null;
  content_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: number;
  runtime_job_id: string | null;
  runtime_idempotency_key: string | null;
  runtime_generation: number;
  heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function makeVideoTranscriptionJobId(): string {
  return `vtj-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
}

function parseMetadata(json: string | null): YouTubeMediaMetadata | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as YouTubeMediaMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function rowToJob(row: JobRow): VideoTranscriptionJob {
  return {
    id: row.id,
    gardenId: row.garden_slug,
    clusterId: row.cluster_id,
    userId: row.user_id,
    inputKind: row.input_kind as VideoTranscriptionInputKind,
    status: row.status as VideoTranscriptionStatus,
    progressPercent: row.progress_percent,
    currentStage: row.current_stage,
    originalFilename: row.original_filename,
    originalUrl: row.original_url,
    canonicalUrl: row.canonical_url,
    youtubeVideoId: row.youtube_video_id,
    sourceTitle: row.source_title,
    videoMetadata: parseMetadata(row.video_metadata_json),
    mediaTempPath: row.media_temp_path,
    mediaSha256: row.media_sha256,
    scriberrJobId: row.scriberr_job_id,
    transcriptJson: row.transcript_json,
    outputRelativePath: row.output_relative_path,
    sourceSlug: row.source_slug,
    contentHash: row.content_hash,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    cancelRequested: row.cancel_requested === 1,
    runtimeJobId: row.runtime_job_id,
    runtimeIdempotencyKey: row.runtime_idempotency_key,
    runtimeGeneration: row.runtime_generation,
    heartbeatAt: row.heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface CreateVideoTranscriptionJobInput {
  clusterId: number;
  gardenSlug: string;
  userId: number;
  inputKind: VideoTranscriptionInputKind;
  originalFilename?: string | null;
  originalUrl?: string | null;
  canonicalUrl?: string | null;
  youtubeVideoId?: string | null;
  sourceTitle?: string | null;
  videoMetadata?: YouTubeMediaMetadata | null;
  mediaTempPath?: string | null;
  mediaSha256?: string | null;
}

export interface VideoTranscriptionJobPatch {
  status?: VideoTranscriptionStatus;
  progressPercent?: number | null;
  currentStage?: string | null;
  sourceTitle?: string | null;
  videoMetadata?: YouTubeMediaMetadata | null;
  mediaTempPath?: string | null;
  mediaSha256?: string | null;
  scriberrJobId?: string | null;
  transcriptJson?: string | null;
  outputRelativePath?: string | null;
  sourceSlug?: string | null;
  contentHash?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  cancelRequested?: boolean;
  runtimeJobId?: string | null;
  runtimeIdempotencyKey?: string | null;
  runtimeGeneration?: number;
  heartbeatAt?: string | null;
  completedAt?: string | null;
}

const PATCH_COLUMNS: Record<keyof VideoTranscriptionJobPatch, string> = {
  status: "status",
  progressPercent: "progress_percent",
  currentStage: "current_stage",
  sourceTitle: "source_title",
  videoMetadata: "video_metadata_json",
  mediaTempPath: "media_temp_path",
  mediaSha256: "media_sha256",
  scriberrJobId: "scriberr_job_id",
  transcriptJson: "transcript_json",
  outputRelativePath: "output_relative_path",
  sourceSlug: "source_slug",
  contentHash: "content_hash",
  errorCode: "error_code",
  errorMessage: "error_message",
  cancelRequested: "cancel_requested",
  runtimeJobId: "runtime_job_id",
  runtimeIdempotencyKey: "runtime_idempotency_key",
  runtimeGeneration: "runtime_generation",
  heartbeatAt: "heartbeat_at",
  completedAt: "completed_at",
};

/** Statuses that occupy a concurrency slot (anything started but not settled). */
const ACTIVE_STATUSES = [
  "validating",
  "uploading",
  "downloading",
  "preparing_media",
  "submitting_to_scriberr",
  "transcribing",
  "formatting_markdown",
  "writing_source",
  "indexing_source",
] as const;

export class VideoTranscriptionJobStore {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureVideoTranscriptionSchema(db);
  }

  createJob(input: CreateVideoTranscriptionJobInput): VideoTranscriptionJob {
    const id = makeVideoTranscriptionJobId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO video_transcription_jobs (
          id, cluster_id, garden_slug, user_id, input_kind, status,
          original_filename, original_url, canonical_url, youtube_video_id,
          source_title, video_metadata_json, media_temp_path, media_sha256,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.clusterId,
        input.gardenSlug,
        input.userId,
        input.inputKind,
        input.originalFilename ?? null,
        input.originalUrl ?? null,
        input.canonicalUrl ?? null,
        input.youtubeVideoId ?? null,
        input.sourceTitle ?? null,
        input.videoMetadata ? JSON.stringify(input.videoMetadata) : null,
        input.mediaTempPath ?? null,
        input.mediaSha256 ?? null,
        now,
        now,
      );
    const job = this.getJob(id);
    if (!job) throw new Error("Failed to persist video transcription job");
    return job;
  }

  getJob(id: string): VideoTranscriptionJob | null {
    const row = this.db
      .prepare("SELECT * FROM video_transcription_jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  getJobForCluster(id: string, clusterId: number): VideoTranscriptionJob | null {
    const job = this.getJob(id);
    return job && job.clusterId === clusterId ? job : null;
  }

  listJobsForCluster(
    clusterId: number,
    { limit = 20, activeOnly = false }: { limit?: number; activeOnly?: boolean } = {},
  ): VideoTranscriptionJob[] {
    const rows = activeOnly
      ? (this.db
          .prepare(
            `SELECT * FROM video_transcription_jobs
             WHERE cluster_id = ? AND status NOT IN ('completed','failed','cancelled')
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(clusterId, limit) as JobRow[])
      : (this.db
          .prepare(
            `SELECT * FROM video_transcription_jobs
             WHERE cluster_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(clusterId, limit) as JobRow[]);
    return rows.map(rowToJob);
  }

  updateJob(id: string, patch: VideoTranscriptionJobPatch): VideoTranscriptionJob | null {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(PATCH_COLUMNS) as Array<
      [keyof VideoTranscriptionJobPatch, string]
    >) {
      if (!(key in patch)) continue;
      const value = patch[key];
      assignments.push(`${column} = ?`);
      if (key === "videoMetadata") {
        values.push(value ? JSON.stringify(value) : null);
      } else if (key === "cancelRequested") {
        values.push(value ? 1 : 0);
      } else {
        values.push(value ?? null);
      }
    }
    assignments.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);
    this.db
      .prepare(
        `UPDATE video_transcription_jobs SET ${assignments.join(", ")} WHERE id = ?`,
      )
      .run(...values);
    return this.getJob(id);
  }

  /** Transition helper: refreshes heartbeat and stage label with the status. */
  transition(
    id: string,
    status: VideoTranscriptionStatus,
    patch: VideoTranscriptionJobPatch = {},
  ): VideoTranscriptionJob | null {
    const merged: VideoTranscriptionJobPatch = {
      ...patch,
      status,
      heartbeatAt: nowIso(),
    };
    if (isTerminalVideoTranscriptionStatus(status) && !("completedAt" in patch)) {
      merged.completedAt = nowIso();
    }
    return this.updateJob(id, merged);
  }

  markHeartbeat(id: string): void {
    this.db
      .prepare(
        "UPDATE video_transcription_jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(nowIso(), nowIso(), id);
  }

  countActive(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM video_transcription_jobs
         WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`,
      )
      .get(...ACTIVE_STATUSES) as { n: number };
    return row.n;
  }

  countPendingForCluster(clusterId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM video_transcription_jobs
         WHERE cluster_id = ? AND status NOT IN ('completed','failed','cancelled')`,
      )
      .get(clusterId) as { n: number };
    return row.n;
  }

  /**
   * Atomically claim the oldest queued job when a concurrency slot is free.
   * The claim happens inside a single transaction so two schedulers can never
   * start the same job or exceed the limit.
   */
  claimNextQueuedJob(maxConcurrent: number): VideoTranscriptionJob | null {
    const claim = this.db.transaction((): string | null => {
      if (this.countActive() >= maxConcurrent) return null;
      const row = this.db
        .prepare(
          `SELECT id FROM video_transcription_jobs
           WHERE status = 'queued' AND cancel_requested = 0
           ORDER BY created_at ASC LIMIT 1`,
        )
        .get() as { id: string } | undefined;
      if (!row) return null;
      this.db
        .prepare(
          `UPDATE video_transcription_jobs
           SET status = 'validating', current_stage = NULL,
               heartbeat_at = ?, updated_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(nowIso(), nowIso(), row.id);
      return row.id;
    });
    const id = claim.immediate();
    return id ? this.getJob(id) : null;
  }

  /**
   * Duplicate lookup for idempotent submissions: an unfinished or completed
   * job for the same YouTube video or uploaded media in the same garden.
   */
  findDuplicateJob({
    clusterId,
    youtubeVideoId,
    mediaSha256,
  }: {
    clusterId: number;
    youtubeVideoId?: string | null;
    mediaSha256?: string | null;
  }): VideoTranscriptionJob | null {
    if (youtubeVideoId) {
      const row = this.db
        .prepare(
          `SELECT * FROM video_transcription_jobs
           WHERE cluster_id = ? AND youtube_video_id = ?
             AND status NOT IN ('failed','cancelled')
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(clusterId, youtubeVideoId) as JobRow | undefined;
      if (row) return rowToJob(row);
    }
    if (mediaSha256) {
      const row = this.db
        .prepare(
          `SELECT * FROM video_transcription_jobs
           WHERE cluster_id = ? AND media_sha256 = ?
             AND status NOT IN ('failed','cancelled')
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(clusterId, mediaSha256) as JobRow | undefined;
      if (row) return rowToJob(row);
    }
    return null;
  }

  /** Non-terminal jobs whose heartbeat went silent (crashed/restarted server). */
  listStaleJobs(staleAfterMs: number, now: Date = new Date()): VideoTranscriptionJob[] {
    const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM video_transcription_jobs
         WHERE status NOT IN ('queued','completed','failed','cancelled')
           AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
      )
      .all(cutoff) as JobRow[];
    return rows.map(rowToJob);
  }

  hasQueuedJobs(): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present FROM video_transcription_jobs
         WHERE status = 'queued' AND cancel_requested = 0 LIMIT 1`,
      )
      .get() as { present: number } | undefined;
    return Boolean(row);
  }
}
