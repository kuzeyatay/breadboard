import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobInputReservation,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import type { VideoSource } from "../video-sources/identity.ts";
import type { VideoEditProgram } from "../video-use/program.ts";
import type { VideoEditSession } from "../video-use/session.ts";

const PROTOCOL_VERSION = 1;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STAGE_JSON_BYTES = 32 * 1024 * 1024;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface SpeechMediaRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string | null;
}

export interface SpeechMediaRuntimeControl {
  reserve(
    authority: RuntimeJobAuthority,
    request: Parameters<typeof reserveRuntimeJobInput>[1],
  ): Promise<RuntimeJobInputReservation>;
  upload(
    authority: RuntimeJobAuthority,
    reservation: RuntimeJobInputReservation,
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): ReturnType<typeof uploadRuntimeJobInput>;
  abandon(authority: RuntimeJobAuthority, uploadId: string): Promise<void>;
  submit(
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
  ): Promise<RuntimeJobSnapshot>;
  inspect(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
  ): Promise<RuntimeJobOutput>;
  cancel(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
}

const DEFAULT_CONTROL: SpeechMediaRuntimeControl = {
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class SpeechMediaRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "SpeechMediaRuntimeError";
    this.code = code;
    this.status = status;
  }
}

interface RuntimeEnvelope {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly identity: {
    readonly jobId: string;
    readonly attempt: number;
    readonly workerInstanceId: string;
  };
  readonly completionSequence: number;
  readonly result: Record<string, unknown>;
}

interface RuntimeCheckpointEnvelope {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly identity: RuntimeEnvelope["identity"];
  readonly snapshot: Record<string, unknown>;
}

interface MediaInput {
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly open: () => ReadableStream<Uint8Array>;
}

interface CompletedJob {
  readonly authority: RuntimeJobAuthority;
  readonly job: RuntimeJobSnapshot;
  readonly result: Record<string, unknown>;
}

function authority(scope: SpeechMediaRuntimeScope): RuntimeJobAuthority {
  if (!Number.isSafeInteger(scope.userId) || scope.userId < 1) {
    throw new TypeError("Speech/media Runtime user scope is invalid.");
  }
  for (const [label, value] of [
    ["Garden", scope.gardenId],
    ["conversation", scope.conversationId],
  ] as const) {
    if (
      value !== null &&
      (!value.trim() ||
        value.trim() !== value ||
        Buffer.byteLength(value, "utf8") > 256 ||
        /\p{Cc}/u.test(value))
    ) throw new TypeError(`Speech/media Runtime ${label} scope is invalid.`);
  }
  return { userId: scope.userId, gardenId: scope.gardenId, conversationId: scope.conversationId };
}

function runtimeDataRoot(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : repositoryRoot();
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function relativeDataPath(filePath: string): string {
  const root = runtimeDataRoot();
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) throw new Error("The media path is outside the Runtime data root.");
  return relative.split(path.sep).join("/");
}

function validRelativePath(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function resolveDataFile(relativePath: unknown, maximumBytes = MAX_MEDIA_BYTES): string {
  if (!validRelativePath(relativePath)) {
    throw new Error("Runtime returned an invalid speech/media output path.");
  }
  const root = runtimeDataRoot();
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) throw new Error("Runtime returned speech/media output outside its data root.");
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) throw new Error("Runtime speech/media output is unavailable or exceeds its bound.");
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error("Runtime speech/media output is indirect.");
  }
  return canonical;
}

function directFileInput(
  filePath: string,
  displayName = path.basename(filePath),
  mediaType = "application/octet-stream",
): MediaInput {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_MEDIA_BYTES
  ) {
    throw new SpeechMediaRuntimeError(
      "media_input_invalid",
      "The media input is empty or exceeds 2 GB.",
      413,
    );
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new SpeechMediaRuntimeError("media_input_indirect", "The media input must be a direct file.", 403);
  }
  return {
    displayName: path.basename(displayName).slice(0, 512) || "media.bin",
    mediaType,
    sizeBytes: metadata.size,
    open: () => Readable.toWeb(fs.createReadStream(canonical)) as ReadableStream<Uint8Array>,
  };
}

function bytesInput(bytes: Uint8Array, displayName: string, mediaType: string): MediaInput {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new SpeechMediaRuntimeError(
      "media_input_invalid",
      "The media input is empty or exceeds 2 GB.",
      413,
    );
  }
  return {
    displayName,
    mediaType,
    sizeBytes: bytes.byteLength,
    open: () => Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>,
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function isMediaJob(job: RuntimeJobSnapshot, jobAuthority: RuntimeJobAuthority): boolean {
  return job.jobType === "speech-media" &&
    job.workerKind === "speech-media-node" &&
    job.resourceClass === "media-processing" &&
    job.gardenId === jobAuthority.gardenId &&
    job.conversationId === jobAuthority.conversationId;
}

function validateIdentity(
  job: RuntimeJobSnapshot,
  identity: unknown,
): identity is RuntimeEnvelope["identity"] {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const record = identity as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "attempt,jobId,workerInstanceId" &&
    record.jobId === job.jobId &&
    record.attempt === job.attempt &&
    record.workerInstanceId === job.workerInstanceId;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): RuntimeEnvelope {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Runtime returned an invalid speech/media result.");
  }
  const envelope = content as Record<string, unknown>;
  if (
    Object.keys(envelope).sort().join(",") !==
      "completionSequence,identity,protocolVersion,result" ||
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(envelope.completionSequence) ||
    envelope.completionSequence !== job.lastWorkerSequence ||
    !validateIdentity(job, envelope.identity) ||
    !envelope.result ||
    typeof envelope.result !== "object" ||
    Array.isArray(envelope.result)
  ) throw new Error("Runtime returned speech/media output outside its worker fence.");
  return envelope as unknown as RuntimeEnvelope;
}

function validateCheckpoint(
  job: RuntimeJobSnapshot,
  content: unknown,
): RuntimeCheckpointEnvelope["snapshot"] | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const envelope = content as Record<string, unknown>;
  if (
    Object.keys(envelope).sort().join(",") !== "identity,protocolVersion,snapshot" ||
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    !validateIdentity(job, envelope.identity) ||
    !envelope.snapshot ||
    typeof envelope.snapshot !== "object" ||
    Array.isArray(envelope.snapshot)
  ) return null;
  return envelope.snapshot as Record<string, unknown>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function terminalError(job: RuntimeJobSnapshot): SpeechMediaRuntimeError {
  if (job.state === "cancelled") {
    return new SpeechMediaRuntimeError("media_runtime_cancelled", "The media operation was stopped.", 499);
  }
  if (job.state === "resource_exhausted") {
    return new SpeechMediaRuntimeError(
      "media_runtime_resource_exhausted",
      job.failureMessage ?? "There is not enough memory to start this media operation.",
      503,
    );
  }
  return new SpeechMediaRuntimeError(
    "media_runtime_failed",
    job.failureMessage ?? `The media operation ended as ${job.state}.`,
    500,
  );
}

async function waitForJob(
  jobAuthority: RuntimeJobAuthority,
  initial: RuntimeJobSnapshot,
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    onCheckpoint?: (value: Record<string, unknown>) => void;
    control: SpeechMediaRuntimeControl;
  },
): Promise<CompletedJob> {
  if (!isMediaJob(initial, jobAuthority)) {
    throw new Error("Runtime returned a job outside the speech/media worker contract.");
  }
  const deadline = Date.now() + options.timeoutMs;
  let job = initial;
  let checkpointFingerprint = "";
  while (!TERMINAL_STATES.has(job.state)) {
    if (options.signal?.aborted) {
      await options.control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (Date.now() >= deadline) {
      await options.control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw new SpeechMediaRuntimeError(
        "media_runtime_timeout",
        "The media operation timed out and was stopped.",
        504,
      );
    }
    if (options.onCheckpoint) {
      try {
        const output = await options.control.readOutput(jobAuthority, job.jobId, "checkpoint");
        const snapshot = validateCheckpoint(job, output.content);
        if (snapshot) {
          const fingerprint = JSON.stringify(snapshot);
          if (fingerprint !== checkpointFingerprint) {
            checkpointFingerprint = fingerprint;
            options.onCheckpoint(snapshot);
          }
        }
      } catch {
        // The worker atomically replaces checkpoints. A poll can race the first
        // registration; the next bounded poll observes the complete snapshot.
      }
    }
    await delay(150);
    job = await options.control.inspect(jobAuthority, job.jobId);
    if (!isMediaJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the speech/media worker contract.");
    }
  }
  if (job.state !== "succeeded") throw terminalError(job);
  const output = await options.control.readOutput(jobAuthority, job.jobId, "result");
  return { authority: jobAuthority, job, result: validateEnvelope(job, output.content).result };
}

async function runMediaJob(
  scope: SpeechMediaRuntimeScope,
  requestPayload: Record<string, unknown>,
  options: {
    input?: MediaInput;
    timeoutMs: number;
    signal?: AbortSignal;
    onCheckpoint?: (value: Record<string, unknown>) => void;
    control?: SpeechMediaRuntimeControl;
  },
): Promise<CompletedJob> {
  const jobAuthority = authority(scope);
  const control = options.control ?? DEFAULT_CONTROL;
  let reservation: RuntimeJobInputReservation | null = null;
  let submitted = false;
  try {
    let uploaded = null;
    if (options.input) {
      reservation = await control.reserve(jobAuthority, {
        gardenId: jobAuthority.gardenId,
        conversationId: jobAuthority.conversationId,
        displayName: options.input.displayName,
        mediaType: options.input.mediaType,
        declaredSizeBytes: options.input.sizeBytes,
      });
      uploaded = await control.upload(
        jobAuthority,
        reservation,
        options.input.open(),
        options.signal,
      );
    }
    const idempotencySeed = randomUUID();
    const job = await control.submit(jobAuthority, {
      jobType: "speech-media",
      idempotencyKey: `speech-media-v2:${digest({
        authority: jobAuthority,
        requestPayload,
        input: uploaded
          ? {
              sha256: uploaded.sha256,
              sizeBytes: uploaded.sizeBytes,
              displayName: uploaded.displayName,
              mediaType: uploaded.mediaType,
            }
          : null,
        idempotencySeed,
      })}`,
      ...(uploaded ? { inputUploads: [{ uploadId: uploaded.uploadId }] } : {}),
      requestPayload,
    });
    submitted = true;
    return await waitForJob(jobAuthority, job, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onCheckpoint: options.onCheckpoint,
      control,
    });
  } finally {
    if (!submitted && reservation) {
      await control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
  }
}

function successfulResult(completed: CompletedJob, operation: string): Record<string, unknown> {
  const result = completed.result;
  if (result.operation !== operation || typeof result.ok !== "boolean") {
    throw new Error("Runtime returned an invalid speech/media operation result.");
  }
  if (result.ok !== true) {
    if (
      Object.keys(result).sort().join(",") !== "errorCode,message,ok,operation" ||
      typeof result.errorCode !== "string" ||
      typeof result.message !== "string" ||
      !result.errorCode ||
      Buffer.byteLength(result.errorCode, "utf8") > 128 ||
      !result.message ||
      Buffer.byteLength(result.message, "utf8") > 32 * 1024
    ) {
      throw new Error("Runtime returned an invalid speech/media failure.");
    }
    const status = result.errorCode === "speech_encode_failed"
      ? 502
      : result.errorCode.includes("missing") || result.errorCode.includes("unavailable")
        ? 503
        : result.errorCode.includes("timeout")
          ? 504
          : 422;
    throw new SpeechMediaRuntimeError(result.errorCode, result.message, status);
  }
  return result;
}

function assertExactResult(
  result: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (Object.keys(result).sort().join(",") !== [...keys].sort().join(",")) {
    throw new Error(`Runtime returned invalid ${label}.`);
  }
}

function attemptStageRoot(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) {
    throw new Error("The completed speech/media job has no worker identity.");
  }
  return path.join(
    runtimeDataRoot(),
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "media-stage",
  );
}

function resolveAttemptStageFile(
  job: RuntimeJobSnapshot,
  relativePath: unknown,
  maximumBytes = MAX_MEDIA_BYTES,
): string {
  const output = resolveDataFile(relativePath, maximumBytes);
  if (!pathWithin(attemptStageRoot(job), output) || samePath(attemptStageRoot(job), output)) {
    throw new Error("Runtime returned speech/media output outside its private attempt stage.");
  }
  return output;
}

function cleanupAttemptStage(job: RuntimeJobSnapshot): void {
  if (!job.workerInstanceId) return;
  fs.rmSync(
    attemptStageRoot(job),
    { recursive: true, force: true, maxRetries: process.platform === "win32" ? 10 : 0, retryDelay: 100 },
  );
}

export async function encodeSpeechMp3ViaRuntime(
  scope: SpeechMediaRuntimeScope,
  audio: Uint8Array,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<Uint8Array> {
  const completed = await runMediaJob(
    scope,
    { protocolVersion: PROTOCOL_VERSION, operation: "speech-mp3" },
    {
      input: bytesInput(audio, "speech.wav", "audio/wav"),
      timeoutMs: 12 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  try {
    const result = successfulResult(completed, "speech-mp3");
    assertExactResult(result, ["ok", "operation", "outputRelativePath", "sizeBytes"], "MP3 metadata");
    const output = resolveAttemptStageFile(
      completed.job,
      result.outputRelativePath,
      512 * 1024 * 1024,
    );
    const bytes = fs.readFileSync(output);
    if (
      typeof result.sizeBytes !== "number" ||
      !Number.isSafeInteger(result.sizeBytes) ||
      result.sizeBytes < 1 ||
      result.sizeBytes !== bytes.byteLength
    ) {
      throw new Error("Runtime returned inconsistent MP3 output metadata.");
    }
    return new Uint8Array(bytes);
  } finally {
    cleanupAttemptStage(completed.job);
  }
}

export interface RuntimeRecordingSegments {
  readonly available: boolean;
  readonly parts: readonly string[];
  readonly cleanup: () => void;
}

export async function segmentRecordingViaRuntime(
  scope: SpeechMediaRuntimeScope,
  filePath: string,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<RuntimeRecordingSegments> {
  const completed = await runMediaJob(
    scope,
    { protocolVersion: PROTOCOL_VERSION, operation: "recording-segments" },
    {
      input: directFileInput(filePath),
      timeoutMs: 2 * 60 * 60_000 + 2 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  try {
    const result = successfulResult(completed, "recording-segments");
    assertExactResult(
      result,
      ["ok", "operation", "available", "partRelativePaths"],
      "recording segments",
    );
    if (
      typeof result.available !== "boolean" ||
      !Array.isArray(result.partRelativePaths) ||
      result.partRelativePaths.some((item) => typeof item !== "string") ||
      (result.available && result.partRelativePaths.length === 0) ||
      (!result.available && result.partRelativePaths.length !== 0)
    ) throw new Error("Runtime returned invalid recording segments.");
    const parts = result.partRelativePaths.map((item) =>
      resolveAttemptStageFile(completed.job, item, MAX_MEDIA_BYTES));
    return {
      available: result.available,
      parts,
      cleanup: () => cleanupAttemptStage(completed.job),
    };
  } catch (error) {
    cleanupAttemptStage(completed.job);
    throw error;
  }
}

export interface RuntimeVideoSourceMetadata {
  readonly title: string;
  readonly durationSeconds: number | null;
  readonly isLive: boolean;
  readonly extension: string;
}

function sourcePayload(source: VideoSource): Record<string, string> {
  return { canonicalUrl: source.canonicalUrl, label: source.label };
}

function parseSourceMetadata(value: unknown): RuntimeVideoSourceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime returned invalid video-source metadata.");
  }
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).sort().join(",") !== "durationSeconds,extension,isLive,title" ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    Buffer.byteLength(item.title, "utf8") > 8_000 ||
    (item.durationSeconds !== null &&
      (!Number.isFinite(item.durationSeconds) ||
        (item.durationSeconds as number) <= 0 ||
        (item.durationSeconds as number) > 4 * 60 * 60)) ||
    item.isLive !== false ||
    typeof item.extension !== "string" ||
    !/^[a-z0-9]{1,16}$/u.test(item.extension)
  ) throw new Error("Runtime returned invalid video-source metadata.");
  return item as unknown as RuntimeVideoSourceMetadata;
}

export async function inspectVideoSourceViaRuntime(
  scope: SpeechMediaRuntimeScope,
  source: VideoSource,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<RuntimeVideoSourceMetadata> {
  const completed = await runMediaJob(
    scope,
    { protocolVersion: PROTOCOL_VERSION, operation: "video-source-inspect", source: sourcePayload(source) },
    { timeoutMs: 2 * 60_000, signal: options.signal, control: options.control },
  );
  const result = successfulResult(completed, "video-source-inspect");
  assertExactResult(result, ["ok", "operation", "metadata"], "video-source inspection");
  return parseSourceMetadata(result.metadata);
}

export interface RuntimeDownloadedVideo {
  readonly filePath: string;
  readonly format: string;
  readonly sizeBytes: number;
  readonly metadata: RuntimeVideoSourceMetadata;
  readonly cleanup: () => void;
}

export async function downloadVideoSourceViaRuntime(
  scope: SpeechMediaRuntimeScope,
  source: VideoSource,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: { percent: number; detail: string }) => void;
    control?: SpeechMediaRuntimeControl;
  } = {},
): Promise<RuntimeDownloadedVideo> {
  const completed = await runMediaJob(
    scope,
    { protocolVersion: PROTOCOL_VERSION, operation: "video-source-download", source: sourcePayload(source) },
    {
      timeoutMs: 32 * 60_000,
      signal: options.signal,
      control: options.control,
      onCheckpoint: (checkpoint) => {
        if (
          typeof checkpoint.percent === "number" &&
          typeof checkpoint.detail === "string"
        ) options.onProgress?.({ percent: checkpoint.percent, detail: checkpoint.detail });
      },
    },
  );
  try {
    const result = successfulResult(completed, "video-source-download");
    assertExactResult(
      result,
      ["ok", "operation", "metadata", "format", "outputRelativePath", "sizeBytes"],
      "downloaded-video metadata",
    );
    const sizeBytes = result.sizeBytes;
    if (
      typeof result.format !== "string" ||
      !/^[a-z0-9]{1,8}$/u.test(result.format) ||
      typeof sizeBytes !== "number" ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1
    ) throw new Error("Runtime returned invalid downloaded-video metadata.");
    const filePath = resolveAttemptStageFile(completed.job, result.outputRelativePath);
    if (fs.statSync(filePath).size !== sizeBytes) {
      throw new Error("Runtime returned inconsistent downloaded-video size.");
    }
    return {
      filePath,
      format: result.format,
      sizeBytes,
      metadata: parseSourceMetadata(result.metadata),
      cleanup: () => cleanupAttemptStage(completed.job),
    };
  } catch (error) {
    cleanupAttemptStage(completed.job);
    throw error;
  }
}

export interface RuntimeVideoProbe {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly hasAudio: boolean;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly sizeBytes: number;
  readonly portrait: boolean;
}

function validateProbe(value: unknown): RuntimeVideoProbe {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime returned an invalid video probe.");
  }
  const probe = value as Record<string, unknown>;
  if (
    Object.keys(probe).sort().join(",") !==
      "audioCodec,durationSeconds,fps,hasAudio,height,portrait,sizeBytes,videoCodec,width" ||
    !Number.isFinite(probe.durationSeconds) ||
    (probe.durationSeconds as number) <= 0 ||
    !Number.isFinite(probe.width) ||
    (probe.width as number) < 0 ||
    !Number.isFinite(probe.height) ||
    (probe.height as number) < 0 ||
    !Number.isFinite(probe.fps) ||
    (probe.fps as number) < 0 ||
    typeof probe.hasAudio !== "boolean" ||
    (probe.videoCodec !== null && typeof probe.videoCodec !== "string") ||
    (probe.audioCodec !== null && typeof probe.audioCodec !== "string") ||
    !Number.isFinite(probe.sizeBytes) ||
    (probe.sizeBytes as number) < 0 ||
    typeof probe.portrait !== "boolean"
  ) throw new Error("Runtime returned an invalid video probe.");
  return probe as unknown as RuntimeVideoProbe;
}

export async function probeVideoViaRuntime(
  scope: SpeechMediaRuntimeScope,
  filePath: string,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<RuntimeVideoProbe> {
  const completed = await runMediaJob(
    scope,
    {
      protocolVersion: PROTOCOL_VERSION,
      operation: "video-probe",
      fileRelativePath: relativeDataPath(filePath),
    },
    { timeoutMs: 3 * 60_000, signal: options.signal, control: options.control },
  );
  const result = successfulResult(completed, "video-probe");
  assertExactResult(result, ["ok", "operation", "probe"], "video probe");
  return validateProbe(result.probe);
}

export interface RuntimeSilenceWindow {
  readonly start: number;
  readonly end: number;
  readonly durationSeconds: number;
}

export async function detectVideoSilencesViaRuntime(
  scope: SpeechMediaRuntimeScope,
  filePath: string,
  options: {
    thresholdDb: number;
    minimumSeconds: number;
    signal?: AbortSignal;
    control?: SpeechMediaRuntimeControl;
  },
): Promise<RuntimeSilenceWindow[]> {
  const completed = await runMediaJob(
    scope,
    {
      protocolVersion: PROTOCOL_VERSION,
      operation: "video-silences",
      fileRelativePath: relativeDataPath(filePath),
      thresholdDb: options.thresholdDb,
      minimumSeconds: options.minimumSeconds,
    },
    { timeoutMs: 17 * 60_000, signal: options.signal, control: options.control },
  );
  try {
    const result = successfulResult(completed, "video-silences");
    assertExactResult(
      result,
      ["ok", "operation", "dataRelativePath", "count"],
      "silence analysis",
    );
    const dataPath = resolveAttemptStageFile(
      completed.job,
      result.dataRelativePath,
      MAX_STAGE_JSON_BYTES,
    );
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { windows?: unknown }).windows)) {
      throw new Error("Runtime returned invalid silence analysis.");
    }
    const windows = (parsed as { windows: unknown[] }).windows;
    for (const window of windows) {
      const item = window as Record<string, unknown>;
      if (
        !window ||
        typeof window !== "object" ||
        Object.keys(item).sort().join(",") !== "durationSeconds,end,start" ||
        !Number.isFinite(item.start) ||
        (item.start as number) < 0 ||
        !Number.isFinite(item.end) ||
        (item.end as number) <= (item.start as number) ||
        !Number.isFinite(item.durationSeconds) ||
        (item.durationSeconds as number) <= 0 ||
        Math.abs(
          (item.end as number) - (item.start as number) - (item.durationSeconds as number),
        ) > 0.002
      ) throw new Error("Runtime returned invalid silence analysis.");
    }
    if (
      typeof result.count !== "number" ||
      !Number.isSafeInteger(result.count) ||
      result.count !== windows.length
    ) throw new Error("Runtime returned inconsistent silence-analysis metadata.");
    return windows as RuntimeSilenceWindow[];
  } finally {
    cleanupAttemptStage(completed.job);
  }
}

export interface RuntimeExtractedAudio {
  readonly filePath: string;
  readonly cleanup: () => void;
}

export async function extractVideoAudioViaRuntime(
  scope: SpeechMediaRuntimeScope,
  filePath: string,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<RuntimeExtractedAudio> {
  const completed = await runMediaJob(
    scope,
    {
      protocolVersion: PROTOCOL_VERSION,
      operation: "video-extract-audio",
      fileRelativePath: relativeDataPath(filePath),
    },
    { timeoutMs: 2 * 60 * 60_000 + 2 * 60_000, signal: options.signal, control: options.control },
  );
  try {
    const result = successfulResult(completed, "video-extract-audio");
    assertExactResult(
      result,
      ["ok", "operation", "outputRelativePath", "sizeBytes"],
      "extracted-audio metadata",
    );
    const output = resolveAttemptStageFile(completed.job, result.outputRelativePath);
    if (
      typeof result.sizeBytes !== "number" ||
      !Number.isSafeInteger(result.sizeBytes) ||
      result.sizeBytes < 1 ||
      fs.statSync(output).size !== result.sizeBytes
    ) throw new Error("Runtime returned inconsistent extracted-audio metadata.");
    return { filePath: output, cleanup: () => cleanupAttemptStage(completed.job) };
  } catch (error) {
    cleanupAttemptStage(completed.job);
    throw error;
  }
}

export async function packVideoTranscriptViaRuntime(
  scope: SpeechMediaRuntimeScope,
  session: VideoEditSession,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<string | null> {
  const completed = await runMediaJob(
    scope,
    {
      protocolVersion: PROTOCOL_VERSION,
      operation: "video-pack-transcript",
      sessionRootRelativePath: relativeDataPath(session.root),
    },
    { timeoutMs: 12 * 60_000, signal: options.signal, control: options.control },
  );
  const result = successfulResult(completed, "video-pack-transcript");
  assertExactResult(
    result,
    ["ok", "operation", "available", "packedRelativePath"],
    "transcript-pack result",
  );
  if (
    typeof result.available !== "boolean" ||
    (result.packedRelativePath !== null && typeof result.packedRelativePath !== "string") ||
    (!result.available && result.packedRelativePath !== null)
  ) {
    throw new Error("Runtime returned an invalid transcript-pack result.");
  }
  if (result.packedRelativePath === null) return null;
  const packedPath = resolveDataFile(result.packedRelativePath, MAX_STAGE_JSON_BYTES);
  if (!samePath(packedPath, session.packedTranscriptPath)) {
    throw new Error("Runtime returned a transcript outside the Video Use session.");
  }
  return fs.readFileSync(packedPath, "utf8");
}

export interface RuntimeVideoRenderResult {
  readonly outputPath: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export async function renderVideoProgramViaRuntime(
  scope: SpeechMediaRuntimeScope,
  session: VideoEditSession,
  program: Omit<VideoEditProgram, "history" | "version">,
  quality: "final" | "preview",
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: { stage: string; detail?: string }) => void;
    control?: SpeechMediaRuntimeControl;
  } = {},
): Promise<RuntimeVideoRenderResult> {
  // A planned program may carry presentation-only fields such as `summary`.
  // Project the exact process-independent contract instead of serializing an
  // object whose structural TypeScript type can hide extra runtime keys.
  const canonicalProgram = {
    ranges: program.ranges.map((range) => ({
      start: range.start,
      end: range.end,
      reason: range.reason,
    })),
    grade: program.grade,
    aspect: program.aspect,
    subtitles: program.subtitles,
    transform: {
      speed: program.transform.speed,
      mute: program.transform.mute,
      volumeDb: program.transform.volumeDb,
      fadeInSeconds: program.transform.fadeInSeconds,
      fadeOutSeconds: program.transform.fadeOutSeconds,
      reverse: program.transform.reverse,
    },
  };
  const completed = await runMediaJob(
    scope,
    {
      protocolVersion: PROTOCOL_VERSION,
      operation: "video-render",
      sessionRootRelativePath: relativeDataPath(session.root),
      program: canonicalProgram,
      quality,
    },
    {
      timeoutMs: 2 * 60 * 60_000 + 2 * 60_000,
      signal: options.signal,
      control: options.control,
      onCheckpoint: (checkpoint) => {
        if (typeof checkpoint.stage !== "string") return;
        options.onProgress?.({
          stage: checkpoint.stage,
          ...(typeof checkpoint.detail === "string" ? { detail: checkpoint.detail } : {}),
        });
      },
    },
  );
  const result = successfulResult(completed, "video-render");
  assertExactResult(
    result,
    [
      "ok", "operation", "outputRelativePath", "durationSeconds", "sizeBytes", "width", "height",
    ],
    "render metadata",
  );
  const outputPath = resolveDataFile(result.outputRelativePath);
  if (
    !samePath(outputPath, session.outputPath) &&
    !samePath(outputPath, path.join(session.editDir, "assembled.mp4"))
  ) throw new Error("Runtime returned a render outside the Video Use session.");
  for (const key of ["durationSeconds", "sizeBytes", "width", "height"] as const) {
    if (!Number.isFinite(result[key])) throw new Error("Runtime returned invalid render metadata.");
  }
  if (
    (result.durationSeconds as number) <= 0 ||
    !Number.isSafeInteger(result.sizeBytes) ||
    (result.sizeBytes as number) < 1 ||
    (result.width as number) < 0 ||
    (result.height as number) < 0 ||
    fs.statSync(outputPath).size !== result.sizeBytes
  ) throw new Error("Runtime returned inconsistent render metadata.");
  return {
    outputPath,
    durationSeconds: result.durationSeconds as number,
    sizeBytes: result.sizeBytes as number,
    width: result.width as number,
    height: result.height as number,
  };
}

export async function probeVideoVisualQcViaRuntime(
  scope: SpeechMediaRuntimeScope,
  options: { signal?: AbortSignal; control?: SpeechMediaRuntimeControl } = {},
): Promise<boolean> {
  const completed = await runMediaJob(
    scope,
    { protocolVersion: PROTOCOL_VERSION, operation: "video-visual-qc" },
    { timeoutMs: 60_000, signal: options.signal, control: options.control },
  );
  const result = successfulResult(completed, "video-visual-qc");
  assertExactResult(result, ["ok", "operation", "available"], "visual-QC probe");
  if (typeof result.available !== "boolean") {
    throw new Error("Runtime returned an invalid visual-QC probe.");
  }
  return result.available;
}
