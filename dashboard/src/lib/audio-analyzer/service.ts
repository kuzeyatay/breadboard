// What a caller may ask the analyzer for, and what it gets back.
//
// Every bound lives here rather than in the route, so the one module that knows
// what the analyzer accepts is the one that decides what a request may contain.
// Paths are never part of that: they arrive already resolved from a stored
// attachment, because a tool that reads any path the model writes is a tool
// that reads the user's whole disk.

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import {
  ANALYSIS_KINDS,
  MAX_ANALYZABLE_BYTES,
  RESOLUTIONS,
  readAudioAnalyzerConfig,
  type AnalysisKind,
} from "./config.ts";
import { AudioAnalyzerError } from "./errors.ts";
import {
  RuntimeJobControlError,
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobInputReservation,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";

export { AudioAnalyzerError } from "./errors.ts";

export interface AnalysisOptions {
  analysis: AnalysisKind;
  /** Time-series density: a named step, a number of rows per second, or summary only. */
  resolution: string | null;
  startTime: number | null;
  endTime: number | null;
  /** Tempo search bounds, which matter for music that reports half or double time. */
  minBpm: number | null;
  maxBpm: number | null;
}

/** Twelve hours: past this a "start time" is a typo rather than a request. */
const MAX_TIME_SECONDS = 12 * 60 * 60;

function optionalNumber(
  value: unknown,
  field: string,
  range: { min: number; max: number },
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new AudioAnalyzerError("audio_analyzer_invalid_arguments", `${field} must be a number.`);
  }
  if (parsed < range.min || parsed > range.max) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      `${field} must be between ${range.min} and ${range.max}.`,
    );
  }
  return parsed;
}

export function parseAnalysisOptions(args: Record<string, unknown>): AnalysisOptions {
  const rawAnalysis = typeof args.analysis === "string" ? args.analysis.trim().toLowerCase() : "full";
  if (!(ANALYSIS_KINDS as readonly string[]).includes(rawAnalysis)) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      `analysis must be one of ${ANALYSIS_KINDS.join(", ")}.`,
    );
  }
  const analysis = rawAnalysis as AnalysisKind;

  let resolution: string | null = null;
  if (args.resolution !== undefined && args.resolution !== null && args.resolution !== "") {
    const raw = String(args.resolution).trim().toLowerCase();
    const numeric = Number(raw);
    if ((RESOLUTIONS as readonly string[]).includes(raw)) {
      resolution = raw;
    } else if (Number.isFinite(numeric) && numeric > 0 && numeric <= 50) {
      // The server accepts rows-per-second as a number; it caps the row count
      // itself, so the ceiling here only rejects the obviously mistyped.
      resolution = String(numeric);
    } else {
      throw new AudioAnalyzerError(
        "audio_analyzer_invalid_arguments",
        `resolution must be ${RESOLUTIONS.join(", ")}, or a number of rows per second.`,
      );
    }
  }

  const startTime = optionalNumber(args.startTime ?? args.start_time, "startTime", {
    min: 0,
    max: MAX_TIME_SECONDS,
  });
  const endTime = optionalNumber(args.endTime ?? args.end_time, "endTime", {
    min: 0,
    max: MAX_TIME_SECONDS,
  });
  if (startTime !== null && endTime !== null && endTime <= startTime) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      "endTime must be later than startTime.",
    );
  }
  const minBpm = optionalNumber(args.minBpm ?? args.min_bpm, "minBpm", { min: 20, max: 400 });
  const maxBpm = optionalNumber(args.maxBpm ?? args.max_bpm, "maxBpm", { min: 20, max: 400 });
  if (minBpm !== null && maxBpm !== null && maxBpm <= minBpm) {
    throw new AudioAnalyzerError(
      "audio_analyzer_invalid_arguments",
      "maxBpm must be greater than minBpm.",
    );
  }

  return { analysis, resolution, startTime, endTime, minBpm, maxBpm };
}

function assertReadable(path: string): number {
  const stats = fs.statSync(path, { throwIfNoEntry: false });
  if (!stats?.isFile() || stats.size === 0) {
    throw new AudioAnalyzerError(
      "audio_analyzer_file_missing",
      "That track's stored file could not be opened.",
    );
  }
  if (stats.size > MAX_ANALYZABLE_BYTES) {
    throw new AudioAnalyzerError(
      "audio_analyzer_file_too_large",
      "That file is larger than the analyzer will decode into memory.",
    );
  }
  return stats.size;
}

export interface AnalysisResult {
  report: string;
  analysis: AnalysisKind;
  durationMs: number;
}

export interface AudioAnalysisRuntimeScope {
  userId: number;
  gardenId: string | null;
  conversationId: string;
}

const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

function runtimeAuthority(scope: AudioAnalysisRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !scope.conversationId.trim() ||
    (scope.gardenId !== null && !scope.gardenId.trim())
  ) {
    throw new TypeError("Audio-analysis Runtime scope is invalid.");
  }
  return scope;
}

function directInput(filePath: string): {
  displayName: string;
  sizeBytes: number;
  open: () => ReadableStream<Uint8Array>;
} {
  const resolved = path.resolve(filePath);
  const sizeBytes = assertReadable(resolved);
  const metadata = fs.lstatSync(resolved);
  if (metadata.isSymbolicLink()) {
    throw new AudioAnalyzerError(
      "audio_analyzer_file_missing",
      "That track's stored file could not be opened.",
    );
  }
  const canonical = fs.realpathSync.native(resolved);
  const same = process.platform === "win32"
    ? canonical.toLowerCase() === resolved.toLowerCase()
    : canonical === resolved;
  if (!same) {
    throw new AudioAnalyzerError(
      "audio_analyzer_file_missing",
      "That track's stored file could not be opened.",
    );
  }
  return {
    displayName: path.basename(canonical).slice(0, 512),
    sizeBytes,
    open: () => Readable.toWeb(fs.createReadStream(canonical)) as ReadableStream<Uint8Array>,
  };
}

function isAudioJob(job: RuntimeJobSnapshot, authority: RuntimeJobAuthority): boolean {
  return (
    job.jobType === "audio-analysis" &&
    job.workerKind === "audio-analyzer-node" &&
    job.resourceClass === "media-processing" &&
    job.gardenId === authority.gardenId &&
    job.conversationId === authority.conversationId
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function completedAudioJob(
  authority: RuntimeJobAuthority,
  initial: RuntimeJobSnapshot,
  signal?: AbortSignal,
): Promise<RuntimeJobSnapshot> {
  if (!isAudioJob(initial, authority)) throw new Error("Runtime returned an invalid audio job.");
  const configuredTimeout = readAudioAnalyzerConfig().runTimeoutMs;
  const runTimeoutMs = Number.isSafeInteger(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 1_000), 10 * 60_000)
    : 10 * 60_000;
  const deadline = Date.now() + runTimeoutMs + 120_000;
  let job = initial;
  while (!TERMINAL_STATES.has(job.state)) {
    if (signal?.aborted || Date.now() >= deadline) {
      await cancelRuntimeJob(authority, job.jobId).catch(() => undefined);
      if (signal?.aborted) {
        throw new AudioAnalyzerError("audio_analyzer_aborted", "The audio analysis was cancelled.");
      }
      throw new AudioAnalyzerError(
        "audio_analyzer_timeout",
        "The audio analysis did not finish in time. A shorter section, or a shorter file, will.",
      );
    }
    await delay(150);
    job = await inspectRuntimeJob(authority, job.jobId);
    if (!isAudioJob(job, authority)) throw new Error("Runtime returned an invalid audio job.");
  }
  if (job.state === "resource_exhausted") {
    throw new AudioAnalyzerError(
      "BREADBOARD_RESOURCE_EXHAUSTED",
      "Windows memory pressure is too high to start audio analysis right now.",
    );
  }
  if (job.state === "cancelled") {
    throw new AudioAnalyzerError("audio_analyzer_aborted", "The audio analysis was cancelled.");
  }
  if (job.state !== "succeeded") {
    throw new AudioAnalyzerError(
      "audio_analyzer_exited",
      "The audio analyzer stopped before it answered.",
    );
  }
  return job;
}

function workerResult(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Runtime returned an invalid audio-analysis result.");
  }
  const envelope = content as Record<string, unknown>;
  const identity = envelope.identity;
  if (
    Object.keys(envelope).sort().join(",") !==
      "completionSequence,identity,protocolVersion,result" ||
    envelope.protocolVersion !== 1 ||
    envelope.completionSequence !== job.lastWorkerSequence ||
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    (identity as Record<string, unknown>).jobId !== job.jobId ||
    (identity as Record<string, unknown>).attempt !== job.attempt ||
    (identity as Record<string, unknown>).workerInstanceId !== job.workerInstanceId ||
    !envelope.result ||
    typeof envelope.result !== "object" ||
    Array.isArray(envelope.result)
  ) {
    throw new Error("Runtime returned an unfenced audio-analysis result.");
  }
  return envelope.result as Record<string, unknown>;
}

async function runAudioJob(input: {
  scope: AudioAnalysisRuntimeScope;
  files: string[];
  requestPayload: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const authority = runtimeAuthority(input.scope);
  const files = input.files.map(directInput);
  const reservations: RuntimeJobInputReservation[] = [];
  let submitted = false;
  let submittedJobId: string | null = null;
  let terminal = false;
  try {
    for (const file of files) {
      reservations.push(await reserveRuntimeJobInput(authority, {
        gardenId: authority.gardenId,
        conversationId: authority.conversationId,
        displayName: file.displayName,
        mediaType: "application/octet-stream",
        declaredSizeBytes: file.sizeBytes,
      }));
    }
    const uploaded = [];
    for (let index = 0; index < files.length; index += 1) {
      uploaded.push(await uploadRuntimeJobInput(
        authority,
        reservations[index]!,
        files[index]!.open(),
        input.signal,
      ));
    }
    const initial = await submitRuntimeJob(authority, {
      jobType: "audio-analysis",
      idempotencyKey: `audio-analysis:${randomUUID()}`,
      requestPayload: input.requestPayload,
      inputUploads: uploaded.map(({ uploadId }) => ({ uploadId })),
    });
    submitted = true;
    submittedJobId = initial.jobId;
    const job = await completedAudioJob(authority, initial, input.signal);
    terminal = true;
    const output = await readRuntimeJobOutput(authority, job.jobId, "result");
    const result = workerResult(job, output.content);
    if (result.ok !== true) {
      throw new AudioAnalyzerError(
        typeof result.code === "string" ? result.code : "audio_analyzer_call_failed",
        typeof result.message === "string"
          ? result.message.slice(0, 400)
          : "The analyzer rejected that request.",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof AudioAnalyzerError) throw error;
    if (error instanceof RuntimeJobControlError && error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
      throw new AudioAnalyzerError(
        "BREADBOARD_RESOURCE_EXHAUSTED",
        "Windows memory pressure is too high to start audio analysis right now.",
      );
    }
    if (error instanceof RuntimeJobControlError && error.code === "RUNTIME_UNAVAILABLE") {
      throw new AudioAnalyzerError(
        "audio_analyzer_unavailable",
        "The local Runtime is unavailable for audio analysis.",
      );
    }
    throw new AudioAnalyzerError(
      "audio_analyzer_exited",
      "The audio analyzer stopped before it answered.",
    );
  } finally {
    if (submittedJobId !== null && !terminal) {
      await cancelRuntimeJob(authority, submittedJobId).catch(() => undefined);
    }
    if (!submitted) {
      await Promise.all(reservations.map((reservation) =>
        abandonRuntimeJobInput(authority, reservation.uploadId).catch(() => undefined)));
    }
  }
}

export async function runAudioAnalysis(input: {
  path: string;
  options: AnalysisOptions;
  scope: AudioAnalysisRuntimeScope;
  signal?: AbortSignal;
}): Promise<AnalysisResult> {
  const result = await runAudioJob({
    scope: input.scope,
    files: [input.path],
    requestPayload: { operation: "analyze", ...input.options },
    signal: input.signal,
  });
  return {
    report: typeof result.report === "string" ? result.report : "",
    analysis: input.options.analysis,
    durationMs: typeof result.durationMs === "number" ? result.durationMs : 0,
  };
}

export async function runAudioComparison(input: {
  pathA: string;
  pathB: string;
  scope: AudioAnalysisRuntimeScope;
  signal?: AbortSignal;
}): Promise<{ report: string; durationMs: number }> {
  const result = await runAudioJob({
    scope: input.scope,
    files: [input.pathA, input.pathB],
    requestPayload: { operation: "compare" },
    signal: input.signal,
  });
  return {
    report: typeof result.report === "string" ? result.report : "",
    durationMs: typeof result.durationMs === "number" ? result.durationMs : 0,
  };
}
