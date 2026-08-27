import "server-only";

import { randomUUID } from "node:crypto";

import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  lookupRuntimeJobByIdempotencyKey,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  RuntimeJobControlError,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobInput,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import { VideoTranscriptionError } from "../scriberr/errors.ts";
import type { VideoTranscriptionHealth } from "../scriberr/health.ts";
import type { VideoTranscriptionJobStore } from "../scriberr/job-store.ts";
import type {
  VideoTranscriptionJob,
  YouTubeMediaMetadata,
} from "../scriberr/types.ts";

const PROTOCOL_VERSION = 1;
const POLL_MS = 250;
const PROBE_TIMEOUT_MS = 90_000;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const TRANSCRIPTION_CONTRACT = Object.freeze({
  jobType: "scriberr-garden-transcription",
  workerKind: "scriberr-garden-transcription-node",
  resourceClass: "media-processing",
});
const PROBE_CONTRACTS = Object.freeze({
  health: {
    jobType: "scriberr-garden-health",
    workerKind: "scriberr-garden-probe-node",
    resourceClass: "core",
  },
  "inspect-youtube": {
    jobType: "scriberr-garden-inspect-youtube",
    workerKind: "scriberr-garden-probe-node",
    resourceClass: "core",
  },
});

export interface ScriberrRuntimeControl {
  configured(env: NodeJS.ProcessEnv): boolean;
  reserve: typeof reserveRuntimeJobInput;
  upload: typeof uploadRuntimeJobInput;
  abandon: typeof abandonRuntimeJobInput;
  submit: typeof submitRuntimeJob;
  inspect: typeof inspectRuntimeJob;
  lookup: typeof lookupRuntimeJobByIdempotencyKey;
  cancel: typeof cancelRuntimeJob;
  cancelByKey: typeof cancelRuntimeJobByIdempotencyKey;
  readOutput: typeof readRuntimeJobOutput;
}

const DEFAULT_CONTROL: ScriberrRuntimeControl = {
  configured: isRuntimeV2ServiceControlConfigured,
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  lookup: lookupRuntimeJobByIdempotencyKey,
  cancel: cancelRuntimeJob,
  cancelByKey: cancelRuntimeJobByIdempotencyKey,
  readOutput: readRuntimeJobOutput,
};

export interface SealedScriberrRuntimeUpload extends RuntimeJobInput {
  readonly authority: RuntimeJobAuthority;
}

function authority(userId: number, gardenId: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1 || !gardenId.trim()) {
    throw new TypeError("Scriberr Runtime requires authenticated garden scope.");
  }
  return { userId, gardenId, conversationId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes && !/\p{Cc}/u.test(value);
}

function contractSnapshot(
  snapshot: RuntimeJobSnapshot,
  expectedAuthority: RuntimeJobAuthority,
  contract: { jobType: string; workerKind: string; resourceClass: string },
): void {
  if (
    snapshot.jobType !== contract.jobType ||
    snapshot.workerKind !== contract.workerKind ||
    snapshot.resourceClass !== contract.resourceClass ||
    snapshot.gardenId !== expectedAuthority.gardenId ||
    snapshot.conversationId !== null
  ) throw new Error("Runtime returned a job outside the sealed Scriberr contract.");
}

function idempotencyKey(job: VideoTranscriptionJob): string {
  if (!/^vtj-[a-z0-9-]{8,80}$/u.test(job.id) || !Number.isSafeInteger(job.runtimeGeneration)) {
    throw new TypeError("The durable Scriberr job identity is invalid.");
  }
  return `scriberr-garden-v2:${job.userId}:${job.id}:${job.runtimeGeneration}`;
}

function mapControlError(error: unknown): VideoTranscriptionError {
  if (error instanceof VideoTranscriptionError) return error;
  if (
    error instanceof RuntimeJobControlError &&
    ["BREADBOARD_RESOURCE_EXHAUSTED", "RUNTIME_RESOURCE_EXHAUSTED"].includes(error.code)
  ) return new VideoTranscriptionError("BREADBOARD_RESOURCE_EXHAUSTED", {
    httpStatus: 503,
    cause: error,
  });
  return new VideoTranscriptionError("scriberr_unavailable", {
    httpStatus: 503,
    cause: error,
  });
}

function assertConfigured(control: ScriberrRuntimeControl, env: NodeJS.ProcessEnv): void {
  if (!control.configured(env)) {
    throw new VideoTranscriptionError("scriberr_unavailable", { httpStatus: 503 });
  }
}

export async function sealScriberrRuntimeUpload(input: {
  userId: number;
  gardenId: string;
  file: File;
  displayFilename: string;
  maxBytes: number;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<SealedScriberrRuntimeUpload> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  assertConfigured(control, env);
  if (input.file.size < 1 || input.file.size > input.maxBytes) {
    throw new VideoTranscriptionError("media_too_large", { httpStatus: 413 });
  }
  const scope = authority(input.userId, input.gardenId);
  const reservation = await control.reserve(scope, {
    gardenId: input.gardenId,
    conversationId: null,
    displayName: input.displayFilename,
    mediaType: input.file.type || null,
    declaredSizeBytes: input.file.size,
  }, env).catch((error) => { throw mapControlError(error); });
  try {
    const uploaded = await control.upload(
      scope,
      reservation,
      input.file.stream(),
      input.signal,
      env,
    );
    if (uploaded.sizeBytes !== input.file.size || !/^[0-9a-f]{64}$/u.test(uploaded.sha256)) {
      throw new Error("Runtime returned invalid Scriberr upload metadata.");
    }
    return { ...uploaded, authority: scope };
  } catch (error) {
    await control.abandon(scope, reservation.uploadId, env).catch(() => undefined);
    throw mapControlError(error);
  }
}

export async function abandonScriberrRuntimeUpload(input: {
  userId: number;
  gardenId: string;
  uploadId: string;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<void> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  await control.abandon(
    authority(input.userId, input.gardenId),
    input.uploadId,
    env,
  );
}

async function submitTranscription(input: {
  job: VideoTranscriptionJob;
  operation: "transcribe" | "retry" | "recover";
  upload?: SealedScriberrRuntimeUpload | null;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<{ snapshot: RuntimeJobSnapshot; key: string }> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  assertConfigured(control, env);
  const scope = authority(input.job.userId, input.job.gardenId);
  const key = idempotencyKey(input.job);
  if (
    input.upload &&
    (input.upload.authority.userId !== scope.userId ||
      input.upload.authority.gardenId !== scope.gardenId)
  ) throw new Error("The sealed Scriberr upload belongs to another garden.");
  const submission: RuntimeJobSubmission = {
    jobType: TRANSCRIPTION_CONTRACT.jobType,
    idempotencyKey: key,
    requestPayload: {
      protocolVersion: PROTOCOL_VERSION,
      operation: input.operation,
      legacyJobId: input.job.id,
      clusterId: input.job.clusterId,
      inputKind: input.job.inputKind,
    },
    inputUploads: input.upload ? [{ uploadId: input.upload.uploadId }] : [],
  };
  let snapshot: RuntimeJobSnapshot;
  try {
    snapshot = await control.submit(scope, submission, env);
  } catch (submissionError) {
    try {
      snapshot = await control.lookup(scope, key, env);
    } catch {
      if (input.upload) {
        await control.abandon(scope, input.upload.uploadId, env).catch(() => undefined);
      }
      throw mapControlError(submissionError);
    }
  }
  contractSnapshot(snapshot, scope, TRANSCRIPTION_CONTRACT);
  return { snapshot, key };
}

export async function startScriberrRuntimeJob(input: {
  store: VideoTranscriptionJobStore;
  jobId: string;
  upload?: SealedScriberrRuntimeUpload | null;
  operation?: "transcribe" | "retry" | "recover";
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<VideoTranscriptionJob | null> {
  const job = input.store.getJob(input.jobId);
  if (!job) return null;
  const { snapshot, key } = await submitTranscription({
    job,
    operation: input.operation ?? "transcribe",
    upload: input.upload,
    env: input.env,
    control: input.control,
  });
  return input.store.updateJob(job.id, {
    runtimeJobId: snapshot.jobId,
    runtimeIdempotencyKey: key,
  });
}

export async function cancelScriberrRuntimeJob(input: {
  store: VideoTranscriptionJobStore;
  jobId: string;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<VideoTranscriptionJob | null> {
  const job = input.store.getJob(input.jobId);
  if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return job;
  input.store.updateJob(job.id, { cancelRequested: true });
  const scope = authority(job.userId, job.gardenId);
  const control = input.control ?? DEFAULT_CONTROL;
  const env = input.env ?? process.env;
  try {
    if (job.runtimeJobId) await control.cancel(scope, job.runtimeJobId, env);
    else {
      const disposition = await control.cancelByKey(
        scope,
        job.runtimeIdempotencyKey ?? idempotencyKey(job),
        env,
      );
      if (disposition.jobId === null && disposition.accepted === false) {
        input.store.transition(job.id, "cancelled", {
          errorCode: "cancelled",
          errorMessage: new VideoTranscriptionError("cancelled").userMessage,
        });
      }
    }
  } catch {
    // The durable flag is also observed by the admitted worker between every
    // stage and poll. Preserve the historical successful cancel response even
    // if the local control socket is recycling; native will still reap its tree.
  }
  return input.store.getJob(job.id);
}

export async function retryScriberrRuntimeJob(input: {
  store: VideoTranscriptionJobStore;
  jobId: string;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<VideoTranscriptionJob | null> {
  const job = input.store.getJob(input.jobId);
  if (!job || job.status !== "failed") return job;
  const prepared = input.store.transition(job.id, "queued", {
    currentStage: null,
    progressPercent: null,
    errorCode: null,
    errorMessage: null,
    cancelRequested: false,
    completedAt: null,
    runtimeJobId: null,
    runtimeIdempotencyKey: null,
    runtimeGeneration: job.runtimeGeneration + 1,
  });
  if (!prepared) return null;
  try {
    return await startScriberrRuntimeJob({
      ...input,
      operation: "retry",
    });
  } catch (error) {
    const mapped = mapControlError(error);
    return input.store.transition(job.id, "failed", {
      errorCode: mapped.code,
      errorMessage: mapped.userMessage,
    });
  }
}

export async function reconcileScriberrRuntimeJobs(input: {
  store: VideoTranscriptionJobStore;
  clusterId: number;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<void> {
  const control = input.control ?? DEFAULT_CONTROL;
  const env = input.env ?? process.env;
  if (!control.configured(env)) return;
  const jobs = input.store.listJobsForCluster(input.clusterId, { activeOnly: true, limit: 20 });
  const unbound = jobs
    .filter((job) => !job.runtimeJobId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const job of unbound) {
    await startScriberrRuntimeJob({
      store: input.store,
      jobId: job.id,
      operation: "recover",
      env,
      control,
    }).catch(() => undefined);
  }
  await Promise.all(jobs.filter((job) => job.runtimeJobId).map(async (job) => {
    const scope = authority(job.userId, job.gardenId);
    let snapshot: RuntimeJobSnapshot;
    try {
      snapshot = await control.inspect(scope, job.runtimeJobId!, env);
      contractSnapshot(snapshot, scope, TRANSCRIPTION_CONTRACT);
    } catch {
      return;
    }
    if (!TERMINAL.has(snapshot.state)) return;
    const current = input.store.getJob(job.id);
    if (!current || ["completed", "failed", "cancelled"].includes(current.status)) return;
    if (snapshot.state === "cancelled") {
      input.store.transition(job.id, "cancelled", {
        errorCode: "cancelled",
        errorMessage: new VideoTranscriptionError("cancelled").userMessage,
      });
    } else if (snapshot.state !== "succeeded") {
      input.store.transition(job.id, "failed", {
        errorCode: "job_interrupted",
        errorMessage: new VideoTranscriptionError("job_interrupted").userMessage,
      });
    }
  }));
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function parseEnvelope(snapshot: RuntimeJobSnapshot, output: RuntimeJobOutput): Record<string, unknown> {
  if (
    output.jobId !== snapshot.jobId || output.kind !== "result" ||
    !exactRecord(output.content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    output.content.protocolVersion !== PROTOCOL_VERSION ||
    output.content.completionSequence !== snapshot.lastWorkerSequence ||
    !exactRecord(output.content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    output.content.identity.jobId !== snapshot.jobId ||
    output.content.identity.attempt !== snapshot.attempt ||
    output.content.identity.workerInstanceId !== snapshot.workerInstanceId ||
    !isRecord(output.content.result)
  ) throw new Error("Runtime returned unfenced Scriberr output.");
  return output.content.result;
}

async function runProbe(input: {
  userId: number;
  gardenId: string;
  operation: keyof typeof PROBE_CONTRACTS;
  request: Record<string, unknown>;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<Record<string, unknown>> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  assertConfigured(control, env);
  const scope = authority(input.userId, input.gardenId);
  const contract = PROBE_CONTRACTS[input.operation];
  const controller = new AbortController();
  const forward = () => controller.abort(input.signal?.reason ?? new DOMException("Aborted", "AbortError"));
  if (input.signal?.aborted) forward();
  else input.signal?.addEventListener("abort", forward, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("Scriberr probe timed out.")), PROBE_TIMEOUT_MS);
  timeout.unref?.();
  let snapshot: RuntimeJobSnapshot | null = null;
  try {
    snapshot = await control.submit(scope, {
      jobType: contract.jobType,
      idempotencyKey: `scriberr-${input.operation}-v2:${input.userId}:${randomUUID()}`,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: input.operation,
        ...input.request,
      },
      inputUploads: [],
    }, env);
    contractSnapshot(snapshot, scope, contract);
    while (!TERMINAL.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await control.inspect(scope, snapshot.jobId, env);
      contractSnapshot(snapshot, scope, contract);
    }
    if (snapshot.state !== "succeeded") throw mapControlError(new Error("Scriberr Runtime probe failed."));
    return parseEnvelope(snapshot, await control.readOutput(scope, snapshot.jobId, "result", env));
  } catch (error) {
    if (snapshot && !TERMINAL.has(snapshot.state)) {
      await control.cancel(scope, snapshot.jobId, env).catch(() => undefined);
    }
    throw mapControlError(error);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forward);
  }
}

function parseMetadata(value: unknown): YouTubeMediaMetadata {
  if (
    !exactRecord(value, [
      "videoId", "canonicalUrl", "title", "channel", "durationSeconds", "thumbnailUrl", "uploadDate",
    ]) || !/^[A-Za-z0-9_-]{11}$/u.test(String(value.videoId)) ||
    value.canonicalUrl !== `https://www.youtube.com/watch?v=${value.videoId}` ||
    !(value.title === null || boundedText(value.title, 2048)) ||
    !(value.channel === null || boundedText(value.channel, 2048)) ||
    !(value.durationSeconds === null || (Number.isSafeInteger(value.durationSeconds) && Number(value.durationSeconds) >= 0)) ||
    !(value.thumbnailUrl === null || boundedText(value.thumbnailUrl, 4096)) ||
    !(value.uploadDate === null || /^\d{8}$/u.test(String(value.uploadDate)))
  ) throw new Error("Runtime returned invalid YouTube metadata.");
  return value as unknown as YouTubeMediaMetadata;
}

export async function inspectScriberrYouTubeViaRuntime(input: {
  userId: number;
  gardenId: string;
  parsed: { videoId: string; canonicalUrl: string };
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<YouTubeMediaMetadata> {
  const result = await runProbe({
    userId: input.userId,
    gardenId: input.gardenId,
    operation: "inspect-youtube",
    request: { videoId: input.parsed.videoId, canonicalUrl: input.parsed.canonicalUrl },
    signal: input.signal,
    env: input.env,
    control: input.control,
  });
  if (
    result.ok === false && result.operation === "inspect-youtube" &&
    exactRecord(result, ["ok", "operation", "errorCode"]) &&
    ["ytdlp_unavailable", "youtube_metadata_failed", "youtube_playlist"].includes(
      String(result.errorCode),
    )
  ) {
    throw new VideoTranscriptionError(
      result.errorCode as "ytdlp_unavailable" | "youtube_metadata_failed" | "youtube_playlist",
    );
  }
  if (result.ok !== true || result.operation !== "inspect-youtube") {
    throw new Error("Runtime returned an invalid Scriberr inspection result.");
  }
  return parseMetadata(result.metadata);
}

function parseHealthItem(value: unknown): {
  ok: boolean;
  version?: string;
  detail?: string;
} {
  if (!isRecord(value)) throw new Error("Runtime returned invalid Scriberr health metadata.");
  const keys = ["ok"];
  if (Object.hasOwn(value, "version")) keys.push("version");
  if (Object.hasOwn(value, "detail")) keys.push("detail");
  if (
    !exactRecord(value, keys) || typeof value.ok !== "boolean" ||
    (Object.hasOwn(value, "version") && !boundedText(value.version, 2048)) ||
    (Object.hasOwn(value, "detail") && !boundedText(value.detail, 4096))
  ) throw new Error("Runtime returned invalid Scriberr health metadata.");
  return value as { ok: boolean; version?: string; detail?: string };
}

function parseHealth(value: unknown): VideoTranscriptionHealth {
  const keys = [
    "enabled", "scriberr", "ytdlp", "ffmpeg", "ffprobe", "jsRuntime",
    "tempDirWritable", "sourcesDirWritable",
  ];
  if (!exactRecord(value, keys) || typeof value.enabled !== "boolean") {
    throw new Error("Runtime returned invalid Scriberr health metadata.");
  }
  return {
    enabled: value.enabled,
    scriberr: parseHealthItem(value.scriberr),
    ytdlp: parseHealthItem(value.ytdlp),
    ffmpeg: parseHealthItem(value.ffmpeg),
    ffprobe: parseHealthItem(value.ffprobe),
    jsRuntime: parseHealthItem(value.jsRuntime),
    tempDirWritable: parseHealthItem(value.tempDirWritable),
    sourcesDirWritable: parseHealthItem(value.sourcesDirWritable),
  };
}

export async function checkScriberrHealthViaRuntime(input: {
  userId: number;
  gardenId: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  control?: ScriberrRuntimeControl;
}): Promise<VideoTranscriptionHealth> {
  const result = await runProbe({
    userId: input.userId,
    gardenId: input.gardenId,
    operation: "health",
    request: {},
    signal: input.signal,
    env: input.env,
    control: input.control,
  });
  if (result.ok !== true || result.operation !== "health" || !isRecord(result.health)) {
    throw new Error("Runtime returned an invalid Scriberr health result.");
  }
  return parseHealth(result.health);
}
