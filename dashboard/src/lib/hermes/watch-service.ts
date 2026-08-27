import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  RuntimeJobControlError,
  type RuntimeJobAuthority,
  type RuntimeJobInputReservation,
  type RuntimeJobIdempotencyCancellationDisposition,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  canonicalizePath,
  isWithinRoot,
  realPathAllowingMissing,
} from "./filesystem-paths.ts";

const PROTOCOL_VERSION = 1;
const MAX_SOURCE_LENGTH = 4_096;
const MAX_LOCAL_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_FRAME_PATHS = 10_000;
const MAX_RUNTIME_MS = 7 * 60_000;
const POLL_MS = 150;
const DETAILS = new Set(["transcript", "efficient", "balanced", "token-burner"]);
const WHISPER_BACKENDS = new Set(["groq", "openai"]);
const TIME_VALUE = /^(?:\d+(?:\.\d+)?|\d+:[0-5]?\d(?:\.\d+)?|\d+:[0-5]\d:[0-5]\d(?:\.\d+)?)$/;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled", "succeeded", "failed", "resource_exhausted", "interrupted", "uncertain",
]);

export interface WatchOptions {
  source: string;
  question: string;
  detail: "transcript" | "efficient" | "balanced" | "token-burner";
  start?: string;
  end?: string;
  timestamps: string[];
  maxFrames?: number;
  resolution?: number;
  fps?: number;
  whisper?: "groq" | "openai";
  noWhisper: boolean;
  noDedup: boolean;
}

export interface WatchRunResult {
  report: string;
  framePaths: Array<{ path: string; timestamp: string }>;
  chatmockAnalysis?: string;
  chatmockWarning?: string;
  analyzedFrameCount: number;
  workDirectory: string;
  durationMs: number;
  stderr: string;
}

export interface WatchRuntimeControl {
  configured(env: NodeJS.ProcessEnv): boolean;
  reserve(
    authority: RuntimeJobAuthority,
    request: Parameters<typeof reserveRuntimeJobInput>[1],
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobInputReservation>;
  upload(
    authority: RuntimeJobAuthority,
    reservation: RuntimeJobInputReservation,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
  ): ReturnType<typeof uploadRuntimeJobInput>;
  abandon(authority: RuntimeJobAuthority, uploadId: string, env: NodeJS.ProcessEnv): Promise<void>;
  submit(
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
  inspect(authority: RuntimeJobAuthority, jobId: string, env: NodeJS.ProcessEnv): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobOutput>;
  cancel(authority: RuntimeJobAuthority, jobId: string, env: NodeJS.ProcessEnv): Promise<RuntimeJobSnapshot>;
  cancelByIdempotencyKey(
    authority: RuntimeJobAuthority,
    idempotencyKey: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobIdempotencyCancellationDisposition>;
}

const DEFAULT_CONTROL: WatchRuntimeControl = {
  configured: isRuntimeV2ServiceControlConfigured,
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class WatchServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WatchServiceError";
    this.code = code;
  }
}

function cleanString(value: unknown, field: string, max = 1_000): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" || !value.trim() || value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new WatchServiceError("watch_invalid_arguments", `${field} must be a bounded single-line string.`);
  }
  return value.trim();
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new WatchServiceError("watch_invalid_arguments", `${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new WatchServiceError("watch_invalid_arguments", `${field} must be a number from ${minimum} to ${maximum}.`);
  }
  return number;
}

function timeValue(value: unknown, field: string): string | undefined {
  const cleaned = cleanString(value, field, 32);
  if (cleaned && !TIME_VALUE.test(cleaned)) {
    throw new WatchServiceError("watch_invalid_arguments", `${field} must use SS, MM:SS, or HH:MM:SS.`);
  }
  return cleaned;
}

export function validateWatchOptions(value: unknown): WatchOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WatchServiceError("watch_invalid_arguments", "Watch arguments are required.");
  }
  const input = value as Record<string, unknown>;
  const source = cleanString(input.source, "source", MAX_SOURCE_LENGTH);
  if (!source) throw new WatchServiceError("watch_invalid_arguments", "A video URL or local path is required.");
  const question = cleanString(input.question, "question", 8_000);
  if (!question) {
    throw new WatchServiceError("watch_invalid_arguments", "The user's video question or summary request is required.");
  }
  const detail = cleanString(input.detail, "detail", 32) ?? "balanced";
  if (!DETAILS.has(detail)) {
    throw new WatchServiceError("watch_invalid_arguments", "detail must be transcript, efficient, balanced, or token-burner.");
  }
  const rawTimestamps = input.timestamps ?? [];
  if (!Array.isArray(rawTimestamps) || rawTimestamps.length > 40) {
    throw new WatchServiceError("watch_invalid_arguments", "timestamps must contain at most 40 values.");
  }
  const timestamps = rawTimestamps.map((entry, index) => {
    const timestamp = timeValue(entry, `timestamps[${index}]`);
    if (!timestamp) throw new WatchServiceError("watch_invalid_arguments", "timestamps cannot contain empty values.");
    return timestamp;
  });
  const whisper = cleanString(input.whisper, "whisper", 20);
  if (whisper && !WHISPER_BACKENDS.has(whisper)) {
    throw new WatchServiceError("watch_invalid_arguments", "whisper must be groq or openai.");
  }
  return {
    source,
    question,
    detail: detail as WatchOptions["detail"],
    start: timeValue(input.start, "start"),
    end: timeValue(input.end, "end"),
    timestamps,
    maxFrames: boundedInteger(input.maxFrames, "maxFrames", 1, 250),
    resolution: boundedInteger(input.resolution, "resolution", 256, 2_048),
    fps: boundedNumber(input.fps, "fps", 0.01, 2),
    whisper: whisper as WatchOptions["whisper"],
    noWhisper: input.noWhisper === true,
    noDedup: input.noDedup === true,
  };
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
}

function remoteSource(source: string): string | null {
  if (!/^https?:\/\//i.test(source)) return null;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new WatchServiceError("watch_invalid_source", "The video URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new WatchServiceError("watch_invalid_source", "Only credential-free HTTP(S) video URLs are supported.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv6 = hostname.includes(":");
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    (ipv6 && (hostname === "::1" || hostname.startsWith("fe80:") ||
      hostname.startsWith("fc") || hostname.startsWith("fd"))) ||
    isPrivateIpv4(hostname)
  ) {
    throw new WatchServiceError("watch_private_url_denied", "Local and private-network video URLs are not supported.");
  }
  return url.toString();
}

export function resolveWatchSource(source: string, workspaceRoot: string): string {
  const remote = remoteSource(source);
  if (remote) return remote;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    throw new WatchServiceError("watch_invalid_source", "Only HTTP(S) URLs or local video paths are supported.");
  }
  const root = realPathAllowingMissing(path.resolve(workspaceRoot));
  const candidate = path.isAbsolute(source) ? source : path.resolve(root, source);
  const canonical = canonicalizePath(candidate);
  if (!canonical || !fs.existsSync(canonical)) {
    throw new WatchServiceError("watch_source_not_found", "The local video file was not found in the authorized workspace.");
  }
  const resolved = fs.realpathSync.native(canonical);
  if (!isWithinRoot(root, resolved) || !fs.statSync(resolved).isFile()) {
    throw new WatchServiceError("watch_source_outside_workspace", "Local videos must be regular files inside the authorized workspace.");
  }
  return resolved;
}

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function mediaTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    case ".mkv": return "video/x-matroska";
    case ".avi": return "video/x-msvideo";
    default: return "application/octet-stream";
  }
}

function boundedDisplayName(filePath: string): string {
  let value = path.basename(filePath) || "video.bin";
  while (value && Buffer.byteLength(value, "utf8") > 512) value = value.slice(0, -1);
  return value || "video.bin";
}

function openDirectVideo(filePath: string, expectedSize: number): ReadableStream<Uint8Array> {
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile() || before.size !== expectedSize) {
    throw new WatchServiceError("watch_source_outside_workspace", "The local video changed before Runtime could seal it.");
  }
  const noFollow = "O_NOFOLLOW" in fs.constants
    ? (fs.constants as typeof fs.constants & { O_NOFOLLOW: number }).O_NOFOLLOW
    : 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new WatchServiceError("watch_source_outside_workspace", "The local video changed before Runtime could seal it.");
    }
    return Readable.toWeb(fs.createReadStream(filePath, { fd: descriptor, autoClose: true })) as ReadableStream<Uint8Array>;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function authority(userId: number, conversationId: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new TypeError("Watch Runtime user scope is invalid.");
  if (!conversationId.trim() || conversationId.trim() !== conversationId ||
    Buffer.byteLength(conversationId, "utf8") > 256 || /\p{Cc}/u.test(conversationId)) {
    throw new TypeError("Watch Runtime conversation scope is invalid.");
  }
  return { userId, gardenId: null, conversationId };
}

function assertSnapshot(snapshot: RuntimeJobSnapshot, expected: RuntimeJobAuthority): void {
  if (snapshot.jobType !== "watch-run" || snapshot.workerKind !== "watch-media-node" ||
    snapshot.resourceClass !== "media-processing" || snapshot.gardenId !== null ||
    snapshot.conversationId !== expected.conversationId) {
    throw new Error("Runtime returned a job outside the sealed Watch contract.");
  }
}

function validIdentity(job: RuntimeJobSnapshot, value: unknown): boolean {
  return exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) &&
    value.jobId === job.jobId && value.attempt === job.attempt &&
    value.workerInstanceId === job.workerInstanceId;
}

function runtimeDataRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.BREADBOARD_DATA_DIR?.trim();
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

function validRelativePath(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\\") &&
    value.split("/").length > 1 &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function resolveDataPath(env: NodeJS.ProcessEnv, relativePath: unknown): string {
  if (!validRelativePath(relativePath)) throw new Error("Runtime returned an invalid Watch output path.");
  const root = runtimeDataRoot(env);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!pathWithin(root, resolved) || samePath(root, resolved)) {
    throw new Error("Runtime returned Watch output outside its data root.");
  }
  return resolved;
}

function attemptOutputRoot(env: NodeJS.ProcessEnv, job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) throw new Error("The Watch worker has no completed identity.");
  return path.join(runtimeDataRoot(env), "runtime", "jobs", job.jobId, "attempts",
    String(job.attempt), job.workerInstanceId, "workspace", "watch-output");
}

function directOutputDirectory(env: NodeJS.ProcessEnv, job: RuntimeJobSnapshot, value: unknown): string {
  const directory = resolveDataPath(env, value);
  const metadata = fs.lstatSync(directory);
  if (!samePath(directory, attemptOutputRoot(env, job)) || !metadata.isDirectory() ||
    metadata.isSymbolicLink() || !samePath(fs.realpathSync.native(directory), directory)) {
    throw new Error("Runtime returned an invalid private Watch output directory.");
  }
  return directory;
}

function directOutputFile(root: string, candidate: string, maximumBytes: number): string {
  if (!pathWithin(root, candidate) || samePath(root, candidate)) {
    throw new Error("Runtime returned a Watch file outside its private output directory.");
  }
  const metadata = fs.lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 ||
    metadata.size > maximumBytes || !samePath(fs.realpathSync.native(candidate), candidate)) {
    throw new Error("Runtime returned an invalid private Watch file.");
  }
  return candidate;
}

function parseFramePaths(report: string, outputDirectory: string): WatchRunResult["framePaths"] {
  const matches = [...report.matchAll(/^- `([^`]+)` \(t=([^,)]+)/gm)];
  if (matches.length > MAX_FRAME_PATHS) throw new Error("Runtime returned too many Watch frame paths.");
  return matches.map((match) => {
    const timestamp = match[2].trim();
    if (timestamp.length > 32 || !TIME_VALUE.test(timestamp)) {
      throw new Error("Runtime returned an invalid Watch frame timestamp.");
    }
    return {
      path: directOutputFile(outputDirectory, path.resolve(match[1]), MAX_FRAME_BYTES),
      timestamp,
    };
  });
}

function boundedOptionalResultText(value: unknown, maximumBytes: number): value is string | null {
  return value === null || (typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximumBytes);
}

function parseResult(env: NodeJS.ProcessEnv, job: RuntimeJobSnapshot, content: unknown): WatchRunResult {
  if (!exactRecord(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION || content.completionSequence !== job.lastWorkerSequence ||
    !validIdentity(job, content.identity) || !content.result ||
    typeof content.result !== "object" || Array.isArray(content.result)) {
    throw new Error("Runtime returned unfenced Watch output.");
  }
  const result = content.result as Record<string, unknown>;
  if (result.ok === false) {
    if (!exactRecord(result, ["ok", "operation", "error"]) || result.operation !== "watch-run" ||
      !exactRecord(result.error, ["code", "message"]) || typeof result.error.code !== "string" ||
      !/^[a-z0-9_]{1,128}$/.test(result.error.code) || typeof result.error.message !== "string" ||
      Buffer.byteLength(result.error.message, "utf8") > 8_000) {
      throw new Error("Runtime returned an invalid Watch failure.");
    }
    throw new WatchServiceError(result.error.code, result.error.message);
  }
  if (!exactRecord(result, ["ok", "operation", "reportRelativePath", "reportSizeBytes",
    "workDirectoryRelativePath", "frameCount", "analyzedFrameCount", "chatmockAnalysis",
    "chatmockWarning", "durationMs", "stderr"]) || result.ok !== true ||
    result.operation !== "watch-run" || !Number.isSafeInteger(result.reportSizeBytes) ||
    (result.reportSizeBytes as number) < 1 || (result.reportSizeBytes as number) > MAX_REPORT_BYTES + 1 ||
    !Number.isSafeInteger(result.frameCount) || (result.frameCount as number) < 0 ||
    (result.frameCount as number) > MAX_FRAME_PATHS || !Number.isSafeInteger(result.analyzedFrameCount) ||
    (result.analyzedFrameCount as number) < 0 || (result.analyzedFrameCount as number) > 24 ||
    (result.analyzedFrameCount as number) > (result.frameCount as number) ||
    !boundedOptionalResultText(result.chatmockAnalysis, 256 * 1024) ||
    !boundedOptionalResultText(result.chatmockWarning, 8_000) ||
    !Number.isSafeInteger(result.durationMs) || (result.durationMs as number) < 0 ||
    (result.durationMs as number) > MAX_RUNTIME_MS || typeof result.stderr !== "string" ||
    Buffer.byteLength(result.stderr, "utf8") > 8_000) {
    throw new Error("Runtime returned an invalid Watch result.");
  }
  const outputDirectory = directOutputDirectory(env, job, result.workDirectoryRelativePath);
  const reportPath = directOutputFile(outputDirectory,
    resolveDataPath(env, result.reportRelativePath), MAX_REPORT_BYTES + 1);
  if (fs.statSync(reportPath).size !== result.reportSizeBytes) {
    throw new Error("Runtime returned mismatched Watch report metadata.");
  }
  const report = fs.readFileSync(reportPath, "utf8").trim();
  if (!report || Buffer.byteLength(report, "utf8") > MAX_REPORT_BYTES) {
    throw new Error("Runtime returned an invalid Watch report.");
  }
  const framePaths = parseFramePaths(report, outputDirectory);
  if (framePaths.length !== result.frameCount) throw new Error("Runtime returned mismatched Watch frame metadata.");
  return {
    report,
    framePaths,
    ...(result.chatmockAnalysis ? { chatmockAnalysis: result.chatmockAnalysis } : {}),
    ...(result.chatmockWarning ? { chatmockWarning: result.chatmockWarning } : {}),
    analyzedFrameCount: result.analyzedFrameCount as number,
    workDirectory: outputDirectory,
    durationMs: result.durationMs as number,
    stderr: result.stderr,
  };
}

function normalizedRequest(options: WatchOptions, source: string) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    operation: "watch-run",
    sourceKind: isRemoteSource(source) ? "remote" : "local",
    source,
    options: {
      question: options.question,
      detail: options.detail,
      start: options.start ?? null,
      end: options.end ?? null,
      timestamps: options.timestamps,
      maxFrames: options.maxFrames ?? null,
      resolution: options.resolution ?? null,
      fps: options.fps ?? null,
      whisper: options.whisper ?? null,
      noWhisper: options.noWhisper,
      noDedup: options.noDedup,
    },
  };
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

function terminalError(snapshot: RuntimeJobSnapshot): WatchServiceError {
  if (snapshot.state === "cancelled") return new WatchServiceError("watch_cancelled", "Watch was cancelled.");
  if (snapshot.state === "resource_exhausted") {
    return new WatchServiceError("watch_runtime_unavailable",
      snapshot.failureMessage ?? "There is not enough free memory to start Watch.");
  }
  return new WatchServiceError("watch_processing_failed",
    snapshot.failureMessage ?? "Watch processing was interrupted.");
}

function cancellationError(reason: unknown, timedOut: boolean): WatchServiceError {
  if (timedOut) return new WatchServiceError("watch_timeout", "Watch exceeded its processing time limit.");
  if (reason instanceof WatchServiceError) return reason;
  return new WatchServiceError("watch_cancelled", "Watch was cancelled.");
}

export async function runWatch(input: {
  userId: number;
  conversationId: string;
  args: unknown;
  workspaceRoot: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  control?: WatchRuntimeControl;
}): Promise<WatchRunResult> {
  const options = validateWatchOptions(input.args);
  const workspaceRoot = realPathAllowingMissing(path.resolve(input.workspaceRoot));
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    throw new WatchServiceError("watch_workspace_unavailable", "Watch requires an authorized workspace directory.");
  }
  const source = resolveWatchSource(options.source, workspaceRoot);
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) {
    throw new WatchServiceError("watch_runtime_unavailable", "Watch requires the Breadboard Runtime job owner.");
  }
  const requestPayload = normalizedRequest(options, source);
  const jobAuthority = authority(input.userId, input.conversationId);
  const idempotencyKey = `watch-run-v2:${randomUUID()}`;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Watch timed out", "TimeoutError"));
  }, input.timeoutMs ?? MAX_RUNTIME_MS);
  timeout.unref?.();
  const forwardAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Request aborted", "AbortError"),
  );
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  let reservation: RuntimeJobInputReservation | null = null;
  let submitted = false;
  let submissionAttempted = false;
  let jobId: string | null = null;
  let lastSnapshot: RuntimeJobSnapshot | null = null;
  try {
    if (controller.signal.aborted) throw cancellationError(controller.signal.reason, timedOut);
    let uploaded = null;
    if (requestPayload.sourceKind === "local") {
      const metadata = fs.lstatSync(source);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 ||
        metadata.size > MAX_LOCAL_VIDEO_BYTES) {
        throw new WatchServiceError("watch_invalid_source",
          "The local video must be a direct file no larger than 2 GB.");
      }
      reservation = await control.reserve(jobAuthority, {
        gardenId: null,
        conversationId: input.conversationId,
        displayName: boundedDisplayName(source),
        mediaType: mediaTypeFor(source),
        declaredSizeBytes: metadata.size,
      }, env);
      const body = openDirectVideo(source, metadata.size);
      try {
        uploaded = await control.upload(jobAuthority, reservation, body, controller.signal, env);
      } catch (error) {
        await body.cancel(error).catch(() => undefined);
        throw error;
      }
    }
    submissionAttempted = true;
    let snapshot = await control.submit(jobAuthority, {
      jobType: "watch-run",
      idempotencyKey,
      requestPayload,
      ...(uploaded ? { inputUploads: [{ uploadId: uploaded.uploadId }] } : {}),
    }, env);
    submitted = true;
    jobId = snapshot.jobId;
    lastSnapshot = snapshot;
    assertSnapshot(snapshot, jobAuthority);
    while (!TERMINAL_STATES.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await control.inspect(jobAuthority, snapshot.jobId, env);
      lastSnapshot = snapshot;
      assertSnapshot(snapshot, jobAuthority);
    }
    if (snapshot.state !== "succeeded") throw terminalError(snapshot);
    if (controller.signal.aborted) throw cancellationError(controller.signal.reason, timedOut);
    const result = parseResult(env, snapshot,
      (await control.readOutput(jobAuthority, snapshot.jobId, "result", env)).content);
    if (controller.signal.aborted) throw cancellationError(controller.signal.reason, timedOut);
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      if (jobId) await control.cancel(jobAuthority, jobId, env).catch(() => undefined);
      else if (submissionAttempted) {
        await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey, env).catch(() => undefined);
      }
      throw cancellationError(controller.signal.reason, timedOut);
    }
    if (submissionAttempted && !jobId) {
      await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey, env).catch(() => undefined);
    } else if (jobId && lastSnapshot && !TERMINAL_STATES.has(lastSnapshot.state)) {
      await control.cancel(jobAuthority, jobId, env).catch(() => undefined);
    }
    if (error instanceof WatchServiceError) throw error;
    if (error instanceof RuntimeJobControlError) {
      if (error.code === "RUNTIME_UNAVAILABLE" || error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
        throw new WatchServiceError("watch_runtime_unavailable", error.message);
      }
      throw new WatchServiceError("watch_processing_failed", error.message);
    }
    throw new WatchServiceError(
      "watch_processing_failed",
      error instanceof Error ? error.message.slice(0, 8_000) : "Watch returned invalid Runtime output.",
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
    if (!submitted && reservation) {
      await control.abandon(jobAuthority, reservation.uploadId, env).catch(() => undefined);
    }
  }
}
