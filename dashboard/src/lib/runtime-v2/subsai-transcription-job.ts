import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  RuntimeJobControlError,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobIdempotencyCancellationDisposition,
  type RuntimeJobInputReservation,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import type { SubtitleFormat } from "../subsai/identity.ts";

const PROTOCOL_VERSION = 1;
const MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_OPERATION_MS = 2 * 60 * 60_000 + 5 * 60_000;
const WHISPER_SIZES = new Set(["tiny", "base", "small", "medium", "large-v3"]);
const SUBTITLE_FORMATS = new Set<SubtitleFormat>(["srt", "vtt", "ass", "ssa", "sub", "txt"]);
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface SubsAiRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string | null;
}

export interface SubsAiTranscriptionControl {
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
  cancelByIdempotencyKey(
    authority: RuntimeJobAuthority,
    idempotencyKey: string,
  ): Promise<RuntimeJobIdempotencyCancellationDisposition>;
}

const DEFAULT_CONTROL: SubsAiTranscriptionControl = {
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class SubsAiRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "SubsAiRuntimeError";
    this.code = code;
    this.status = status;
  }
}

export interface SubsAiRuntimeProgress {
  readonly stage: string;
  readonly detail?: string;
}

export interface SubsAiRuntimeOutput {
  readonly filePath: string;
  readonly format: SubtitleFormat;
  readonly sizeBytes: number;
  readonly cleanup: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function boundedScope(value: string | null): boolean {
  return value === null || (
    value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 256 && !/\p{Cc}/u.test(value)
  );
}

function authority(scope: SubsAiRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) || scope.userId < 1 ||
    !boundedScope(scope.gardenId) || !boundedScope(scope.conversationId)
  ) throw new TypeError("SubsAI Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
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

function directMediaInput(filePath: string): {
  displayName: string;
  sizeBytes: number;
  open: () => ReadableStream<Uint8Array>;
} {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() ||
    metadata.size < 1 || metadata.size > MAX_INPUT_BYTES
  ) throw new SubsAiRuntimeError(
    "input_invalid",
    "The media input is empty or exceeds 2 GB.",
    413,
  );
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new SubsAiRuntimeError("input_indirect", "The media input must be a direct file.", 403);
  }
  return {
    displayName: path.basename(canonical).slice(0, 512) || "media.bin",
    sizeBytes: metadata.size,
    open: () => Readable.toWeb(fs.createReadStream(canonical)) as ReadableStream<Uint8Array>,
  };
}

function canonicalRequest(input: {
  mode: "words" | "subtitles";
  size?: string;
  language?: string | null;
  format?: SubtitleFormat;
}): Record<string, unknown> {
  const size = input.size ?? "base";
  const language = input.language ?? null;
  if (!WHISPER_SIZES.has(size)) throw new TypeError("SubsAI Whisper size is invalid.");
  if (
    language !== null && (
      !language.trim() || language.trim() !== language ||
      Buffer.byteLength(language, "utf8") > 64 || /\p{Cc}/u.test(language)
    )
  ) throw new TypeError("SubsAI language is invalid.");
  if (input.mode === "subtitles" && (!input.format || !SUBTITLE_FORMATS.has(input.format))) {
    throw new TypeError("SubsAI subtitle format is invalid.");
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    operation: input.mode,
    size,
    language,
    ...(input.mode === "subtitles" ? { format: input.format } : {}),
  };
}

function isSubsAiJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "subsai-transcription" &&
    job.workerKind === "subsai-transcription-node" &&
    job.resourceClass === "local-model" &&
    job.gardenId === scope.gardenId &&
    job.conversationId === scope.conversationId;
}

function validateIdentity(job: RuntimeJobSnapshot, value: unknown): boolean {
  return isRecord(value) &&
    exactKeys(value, ["jobId", "attempt", "workerInstanceId"]) &&
    value.jobId === job.jobId && value.attempt === job.attempt &&
    value.workerInstanceId === job.workerInstanceId;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !validateIdentity(job, content.identity) ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned subsai output outside its worker fence.");
  return content.result;
}

function checkpointSnapshot(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> | null {
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "snapshot"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    !validateIdentity(job, content.identity) ||
    !isRecord(content.snapshot)
  ) return null;
  return content.snapshot;
}

function progressValue(value: Record<string, unknown>): SubsAiRuntimeProgress | null {
  if (
    !["Downloading the model", "Transcribing"].includes(String(value.stage)) ||
    !(value.detail === undefined || (
      typeof value.detail === "string" && Buffer.byteLength(value.detail, "utf8") <= 512 &&
      !/\p{Cc}/u.test(value.detail)
    ))
  ) return null;
  return {
    stage: String(value.stage),
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
  };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function terminalError(job: RuntimeJobSnapshot): SubsAiRuntimeError {
  if (job.state === "cancelled") {
    return new SubsAiRuntimeError("aborted", "Transcription was stopped.", 499);
  }
  if (job.state === "resource_exhausted") {
    return new SubsAiRuntimeError(
      "environment_missing",
      "There is not enough memory to start local transcription.",
      503,
    );
  }
  return new SubsAiRuntimeError(
    "transcribe_failed",
    job.failureMessage ?? "Subtitles could not be generated.",
    502,
  );
}

function statusForFailure(code: string): number {
  return code === "environment_missing"
    ? 503
    : code === "spawn_failed"
      ? 502
      : code === "aborted"
        ? 499
        : code === "output_too_large"
          ? 413
          : 422;
}

function attemptStage(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) throw new Error("The completed subsai job has no worker identity.");
  return path.join(
    runtimeDataRoot(),
    "runtime", "jobs", job.jobId, "attempts", String(job.attempt),
    job.workerInstanceId, "workspace", "subsai-stage",
  );
}

function resolveOutput(job: RuntimeJobSnapshot, relativePath: unknown, sizeBytes: unknown): string {
  if (
    typeof relativePath !== "string" || relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1 ||
    Number(sizeBytes) > MAX_OUTPUT_BYTES
  ) throw new Error("Runtime returned invalid subsai output metadata.");
  const root = runtimeDataRoot();
  const output = path.resolve(root, ...relativePath.split("/"));
  const stage = attemptStage(job);
  if (!pathWithin(stage, output) || samePath(stage, output)) {
    throw new Error("Runtime returned subsai output outside its private attempt.");
  }
  const metadata = fs.lstatSync(output);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== sizeBytes ||
    !samePath(fs.realpathSync.native(output), output)
  ) throw new Error("Runtime returned unavailable or indirect subsai output.");
  return output;
}

function cleanupStage(job: RuntimeJobSnapshot): void {
  if (!job.workerInstanceId) return;
  fs.rmSync(attemptStage(job), {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
}

function controlError(error: RuntimeJobControlError): SubsAiRuntimeError {
  if (error.code === "JOB_CANCELLED_BEFORE_SUBMISSION") {
    return new SubsAiRuntimeError("aborted", "Transcription was stopped.", 499);
  }
  if (error.code === "RUNTIME_UNAVAILABLE" || error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
    return new SubsAiRuntimeError(
      "environment_missing",
      "The local subtitle Runtime is unavailable.",
      503,
    );
  }
  return new SubsAiRuntimeError("spawn_failed", "The subtitle process could not start.", 502);
}

/** Stream one media input to a fresh sealed subsai worker and retain only its bounded output. */
export async function transcribeWithSubsAiViaRuntime(input: {
  readonly scope: SubsAiRuntimeScope;
  readonly mediaPath: string;
  readonly mode: "words" | "subtitles";
  readonly size?: string;
  readonly language?: string | null;
  readonly format?: SubtitleFormat;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SubsAiRuntimeProgress) => void;
  readonly control?: SubsAiTranscriptionControl;
}): Promise<SubsAiRuntimeOutput> {
  if (input.signal?.aborted) {
    throw new SubsAiRuntimeError("aborted", "Transcription was stopped.", 499);
  }
  const requestPayload = canonicalRequest(input);
  const jobAuthority = authority(input.scope);
  const media = directMediaInput(input.mediaPath);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `subsai-transcription-v2:${createHash("sha256")
    .update(JSON.stringify({ scope: jobAuthority, requestPayload, nonce: randomUUID() }), "utf8")
    .digest("hex")}`;
  let reservation: RuntimeJobInputReservation | null = null;
  let submissionAttempted = false;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    reservation = await control.reserve(jobAuthority, {
      gardenId: jobAuthority.gardenId,
      conversationId: jobAuthority.conversationId,
      displayName: media.displayName,
      mediaType: "application/octet-stream",
      declaredSizeBytes: media.sizeBytes,
    });
    const sealed = await control.upload(
      jobAuthority,
      reservation,
      media.open(),
      input.signal,
    );
    submissionAttempted = true;
    job = await control.submit(jobAuthority, {
      jobType: "subsai-transcription",
      idempotencyKey,
      inputUploads: [{ uploadId: sealed.uploadId }],
      requestPayload,
    });
    if (!isSubsAiJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the subsai worker contract.");
    }
    const deadline = Date.now() + MAX_OPERATION_MS;
    let checkpointFingerprint = "";
    while (!TERMINAL_STATES.has(job.state)) {
      if (input.signal?.aborted) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new SubsAiRuntimeError("aborted", "Transcription was stopped.", 499);
      }
      if (Date.now() >= deadline) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new SubsAiRuntimeError(
          "transcribe_failed",
          "Subtitles could not be generated.",
          504,
        );
      }
      if (input.onProgress) {
        try {
          const checkpoint = await control.readOutput(jobAuthority, job.jobId, "checkpoint");
          const snapshot = checkpointSnapshot(job, checkpoint.content);
          const next = snapshot ? progressValue(snapshot) : null;
          const fingerprint = next ? JSON.stringify(next) : "";
          if (next && fingerprint !== checkpointFingerprint) {
            checkpointFingerprint = fingerprint;
            input.onProgress(next);
          }
        } catch {
          // The first checkpoint may not be registered yet; the next poll observes it.
        }
      }
      await delay(150, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isSubsAiJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the subsai worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    try {
      const output = await control.readOutput(jobAuthority, job.jobId, "result");
      if (output.jobId !== job.jobId || output.kind !== "result") {
        throw new Error("Runtime returned output for another subsai transcription.");
      }
      const result = validateEnvelope(job, output.content);
      if (
        result.ok === false &&
        exactKeys(result, ["ok", "operation", "errorCode", "message"]) &&
        result.operation === "transcribe" &&
        typeof result.errorCode === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(result.errorCode) &&
        typeof result.message === "string" && result.message.trim() === result.message &&
        result.message.length > 0 && Buffer.byteLength(result.message, "utf8") <= 32 * 1024 &&
        !/\p{Cc}/u.test(result.message)
      ) throw new SubsAiRuntimeError(
        result.errorCode,
        result.message,
        statusForFailure(result.errorCode),
      );
      const expectedFormat = input.mode === "words" ? "srt" : input.format;
      if (
        !exactKeys(result, [
          "ok", "operation", "mode", "format", "outputRelativePath", "sizeBytes",
        ]) ||
        result.ok !== true || result.operation !== "transcribe" ||
        result.mode !== input.mode || result.format !== expectedFormat ||
        !SUBTITLE_FORMATS.has(result.format as SubtitleFormat)
      ) throw new Error("Runtime returned invalid subsai transcription metadata.");
      const filePath = resolveOutput(job, result.outputRelativePath, result.sizeBytes);
      return {
        filePath,
        format: result.format as SubtitleFormat,
        sizeBytes: result.sizeBytes as number,
        cleanup: () => cleanupStage(job!),
      };
    } catch (error) {
      cleanupStage(job);
      throw error;
    }
  } catch (error) {
    if (
      job && !cancellationForwarded && input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw new SubsAiRuntimeError("aborted", "Transcription was stopped.", 499);
    }
    if (!job && submissionAttempted) {
      await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey).catch(() => undefined);
    }
    if (!job && input.signal?.aborted) {
      throw new SubsAiRuntimeError("aborted", "Transcription was stopped.", 499);
    }
    if (error instanceof RuntimeJobControlError) throw controlError(error);
    throw error;
  } finally {
    if (!job && reservation) {
      await control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
  }
}
