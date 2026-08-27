import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { MAX_MANIM_VIDEO_BYTES } from "../manim/config.ts";
import type { ManimRequest } from "../manim/request.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const MAX_OPERATION_MS = 7 * 60_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface ManimRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string;
}

export interface ManimRuntimeResult extends ManimRequest {
  readonly videoPath: string;
  readonly videoRoot: string;
  readonly sizeBytes: number;
  readonly image: string;
  readonly durationSeconds: number;
  readonly sourceHash: string;
  readonly cleanup: () => void;
}

export interface ManimRuntimeControl {
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

const DEFAULT_CONTROL: ManimRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class ManimRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "ManimRuntimeError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedScope(value: string | null, nullable: boolean): boolean {
  return value === null
    ? nullable
    : value.trim() === value &&
        value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= 256 &&
        !/\p{Cc}/u.test(value);
}

function authority(scope: ManimRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !boundedScope(scope.gardenId, true) ||
    !boundedScope(scope.conversationId, false)
  ) throw new TypeError("Manim Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function isManimJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "manim-render" &&
    job.workerKind === "manim-node" &&
    job.resourceClass === "media-processing" &&
    job.gardenId === scope.gardenId &&
    job.conversationId === scope.conversationId;
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

function validRelativePath(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function attemptStageRoot(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) throw new Error("The completed Manim job has no worker identity.");
  return path.join(
    runtimeDataRoot(),
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "manim-stage",
  );
}

function resolveVideo(job: RuntimeJobSnapshot, relativePath: unknown, expectedSize: number): string {
  if (!validRelativePath(relativePath)) throw new Error("Runtime returned an invalid Manim video path.");
  const root = runtimeDataRoot();
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const stageRoot = attemptStageRoot(job);
  if (!pathWithin(root, resolved) || !pathWithin(stageRoot, resolved) || samePath(stageRoot, resolved)) {
    throw new Error("Runtime returned a Manim video outside its private attempt stage.");
  }
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== expectedSize ||
    metadata.size < 12 ||
    metadata.size > MAX_MANIM_VIDEO_BYTES
  ) throw new Error("Runtime returned an unavailable or oversized Manim video.");
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) throw new Error("Runtime returned an indirect Manim video.");
  const descriptor = fs.openSync(canonical, "r");
  try {
    const signature = Buffer.alloc(4);
    if (fs.readSync(descriptor, signature, 0, signature.length, 4) !== 4 ||
      signature.toString("ascii") !== "ftyp") {
      throw new Error("Runtime returned a file that is not an MP4 video.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return canonical;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!isRecord(content) || !exactKeys(content, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) throw new Error("Runtime returned an invalid Manim result envelope.");
  if (
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned Manim output outside its worker fence.");
  return content.result;
}

function terminalError(job: RuntimeJobSnapshot): ManimRuntimeError {
  if (job.state === "cancelled") {
    return new ManimRuntimeError("manim_cancelled", "The Manim render was stopped.", 499);
  }
  if (job.state === "resource_exhausted") {
    return new ManimRuntimeError(
      "manim_resource_exhausted",
      job.failureMessage ?? "There is not enough memory to start the Manim render.",
      503,
    );
  }
  return new ManimRuntimeError(
    "manim_render_failed",
    job.failureMessage ?? "The Manim render did not complete.",
    502,
  );
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

/** Run one validated scene in a fresh Rust-owned Docker worker. */
export async function runManimViaRuntime(input: {
  readonly scope: ManimRuntimeScope;
  readonly request: ManimRequest;
  readonly signal?: AbortSignal;
  readonly control?: ManimRuntimeControl;
}): Promise<ManimRuntimeResult> {
  const jobAuthority = authority(input.scope);
  const control = input.control ?? DEFAULT_CONTROL;
  const sourceHash = createHash("sha256").update(input.request.code, "utf8").digest("hex");
  const digest = createHash("sha256")
    .update(JSON.stringify({
      scope: jobAuthority,
      request: input.request,
      nonce: randomUUID(),
    }), "utf8")
    .digest("hex");
  let cancellationForwarded = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "manim-render",
      idempotencyKey: `manim-v2:${digest}`,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "render",
        ...input.request,
        sourceHash,
      },
    });
    if (!isManimJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the Manim worker contract.");
    }
    const deadline = Date.now() + MAX_OPERATION_MS;
    while (!TERMINAL_STATES.has(job.state)) {
      if (input.signal?.aborted) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (Date.now() >= deadline) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new ManimRuntimeError(
          "manim_timeout",
          "The Manim render exceeded its time limit and was stopped.",
          504,
        );
      }
      await delay(200, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isManimJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the Manim worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Manim job.");
    }
    const result = validateEnvelope(job, output.content);
    if (
      result.ok === false &&
      exactKeys(result, ["ok", "operation", "errorCode", "message"]) &&
      result.operation === "render" &&
      typeof result.errorCode === "string" &&
      /^[a-z][a-z0-9_]{0,127}$/u.test(result.errorCode) &&
      typeof result.message === "string" &&
      result.message.trim() === result.message &&
      result.message.length > 0 &&
      Buffer.byteLength(result.message, "utf8") <= 32 * 1024 &&
      !/\p{Cc}/u.test(result.message)
    ) {
      const status = result.errorCode === "manim_runtime_unavailable"
        ? 503
        : result.errorCode === "manim_timeout"
          ? 504
          : result.errorCode === "manim_invalid_arguments" || result.errorCode === "manim_invalid_source"
            ? 400
            : 502;
      throw new ManimRuntimeError(result.errorCode, result.message, status);
    }
    if (!exactKeys(result, [
      "ok",
      "operation",
      "outputRelativePath",
      "sizeBytes",
      "image",
      "durationSeconds",
      "sourceHash",
    ]) ||
      result.ok !== true ||
      result.operation !== "render" ||
      !Number.isSafeInteger(result.sizeBytes) ||
      Number(result.sizeBytes) < 12 ||
      Number(result.sizeBytes) > MAX_MANIM_VIDEO_BYTES ||
      typeof result.image !== "string" ||
      !result.image.trim() ||
      Buffer.byteLength(result.image, "utf8") > 512 ||
      !Number.isFinite(result.durationSeconds) ||
      Number(result.durationSeconds) < 0 ||
      result.sourceHash !== sourceHash) {
      throw new Error("Runtime returned invalid Manim render metadata.");
    }
    const videoPath = resolveVideo(job, result.outputRelativePath, Number(result.sizeBytes));
    const videoRoot = attemptStageRoot(job);
    let cleaned = false;
    return {
      ...input.request,
      videoPath,
      videoRoot,
      sizeBytes: Number(result.sizeBytes),
      image: result.image,
      durationSeconds: Number(result.durationSeconds),
      sourceHash,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        fs.rmSync(videoRoot, {
          recursive: true,
          force: true,
          maxRetries: process.platform === "win32" ? 10 : 0,
          retryDelay: 100,
        });
      },
    };
  } catch (error) {
    if (
      job &&
      !cancellationForwarded &&
      input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
    throw error;
  }
}
