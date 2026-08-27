import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { MAX_INPUT_IMAGE_BYTES, MAX_OUTPUT_MESH_BYTES } from "../sf3d/config.ts";
import type { Sf3dRunOptions } from "../sf3d/request.ts";
import type { ModelAttachmentSummary } from "../model-attachments.ts";
import { repositoryRoot } from "../runtime-paths.ts";
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

const PROTOCOL_VERSION = 1;
const MAX_OPERATION_MS = 12 * 60_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface Sf3dRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string;
}

export interface Sf3dRuntimeResult {
  readonly meshPath: string;
  readonly meshRoot: string;
  readonly sizeBytes: number;
  readonly device: string;
  readonly durationSeconds: number;
  readonly peakMemoryMb: number | null;
  readonly options: Sf3dRunOptions;
  readonly summary: ModelAttachmentSummary;
  readonly cleanup: () => void;
}

export interface Sf3dRuntimeControl {
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

const DEFAULT_CONTROL: Sf3dRuntimeControl = {
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class Sf3dRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "Sf3dRuntimeError";
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

function authority(scope: Sf3dRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !boundedScope(scope.gardenId, true) ||
    !boundedScope(scope.conversationId, false)
  ) {
    throw new TypeError("Stable Fast 3D Runtime scope is invalid.");
  }
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function isSf3dJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "sf3d-reconstruct" &&
    job.workerKind === "sf3d-node" &&
    job.resourceClass === "local-model" &&
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
  if (!job.workerInstanceId) throw new Error("The completed SF3D job has no worker identity.");
  return path.join(
    runtimeDataRoot(),
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "sf3d-stage",
  );
}

function resolveMesh(job: RuntimeJobSnapshot, relativePath: unknown, expectedSize: number): string {
  if (!validRelativePath(relativePath)) throw new Error("Runtime returned an invalid SF3D mesh path.");
  const root = runtimeDataRoot();
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const stageRoot = attemptStageRoot(job);
  if (!pathWithin(root, resolved) || !pathWithin(stageRoot, resolved) || samePath(stageRoot, resolved)) {
    throw new Error("Runtime returned an SF3D mesh outside its private attempt stage.");
  }
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== expectedSize ||
    metadata.size < 1 ||
    metadata.size > MAX_OUTPUT_MESH_BYTES
  ) {
    throw new Error("Runtime returned an unavailable or oversized SF3D mesh.");
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) throw new Error("Runtime returned an indirect SF3D mesh.");
  const descriptor = fs.openSync(canonical, "r");
  try {
    const magic = Buffer.alloc(4);
    if (fs.readSync(descriptor, magic, 0, magic.length, 0) !== 4 || magic.toString("ascii") !== "glTF") {
      throw new Error("Runtime returned a file that is not a binary glTF mesh.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return canonical;
}

function validOptions(value: unknown): value is Sf3dRunOptions {
  if (!isRecord(value) || !exactKeys(value, [
    "textureResolution",
    "remesh",
    "targetVertexCount",
    "removeBackground",
  ])) return false;
  return [256, 512, 1024, 2048].includes(Number(value.textureResolution)) &&
    ["none", "triangle", "quad"].includes(String(value.remesh)) &&
    Number.isInteger(value.targetVertexCount) &&
    (Number(value.targetVertexCount) === -1 ||
      (Number(value.targetVertexCount) >= 200 && Number(value.targetVertexCount) <= 500_000)) &&
    typeof value.removeBackground === "boolean";
}

function validSummary(value: unknown): value is ModelAttachmentSummary {
  if (!isRecord(value)) return false;
  const allowed = new Set(["triangles", "vertices", "meshes", "materials", "animations", "extent", "generator", "notes"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const key of ["triangles", "vertices", "meshes", "materials", "animations"] as const) {
    if (Object.hasOwn(value, key) &&
      (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) return false;
  }
  if (Object.hasOwn(value, "generator") &&
    (typeof value.generator !== "string" || Buffer.byteLength(value.generator, "utf8") > 2_048)) return false;
  if (Object.hasOwn(value, "notes") &&
    (!Array.isArray(value.notes) || value.notes.length > 32 ||
      value.notes.some((item) => typeof item !== "string" || Buffer.byteLength(item, "utf8") > 2_048))) return false;
  if (Object.hasOwn(value, "extent")) {
    if (!isRecord(value.extent) || !exactKeys(value.extent, ["x", "y", "z"]) ||
      ![value.extent.x, value.extent.y, value.extent.z].every(Number.isFinite)) return false;
  }
  return true;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!isRecord(content) || !exactKeys(content, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) throw new Error("Runtime returned an invalid SF3D result envelope.");
  if (
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned SF3D output outside its worker fence.");
  return content.result;
}

function terminalError(job: RuntimeJobSnapshot): Sf3dRuntimeError {
  if (job.state === "cancelled") {
    return new Sf3dRuntimeError("sf3d_cancelled", "The reconstruction was stopped.", 499);
  }
  if (job.state === "resource_exhausted") {
    return new Sf3dRuntimeError(
      "sf3d_resource_exhausted",
      job.failureMessage ?? "There is not enough memory to start 3D reconstruction.",
      503,
    );
  }
  return new Sf3dRuntimeError(
    "sf3d_reconstruction_failed",
    job.failureMessage ?? "The reconstruction did not complete.",
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

/** Run one image reconstruction in a fresh Rust-owned worker. */
export async function runImageTo3dViaRuntime(input: {
  readonly scope: Sf3dRuntimeScope;
  readonly image: Uint8Array;
  readonly imageName: string;
  readonly mediaType: string;
  readonly options: Sf3dRunOptions;
  readonly signal?: AbortSignal;
  readonly control?: Sf3dRuntimeControl;
}): Promise<Sf3dRuntimeResult> {
  if (input.image.byteLength < 1 || input.image.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new Sf3dRuntimeError("sf3d_invalid_image", "That image is empty or too large to reconstruct.", 400);
  }
  const imageName = path.basename(input.imageName).slice(0, 240) || "input.png";
  if (/[\\/\u0000]/u.test(imageName) || !["image/jpeg", "image/png", "image/webp"].includes(input.mediaType)) {
    throw new Sf3dRuntimeError("sf3d_invalid_image", "That image type cannot be reconstructed.", 400);
  }
  if (!validOptions(input.options)) {
    throw new Sf3dRuntimeError("sf3d_invalid_arguments", "The reconstruction options are invalid.", 400);
  }
  const jobAuthority = authority(input.scope);
  const control = input.control ?? DEFAULT_CONTROL;
  let reservation: RuntimeJobInputReservation | null = null;
  let submitted = false;
  let cancellationForwarded = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    reservation = await control.reserve(jobAuthority, {
      gardenId: jobAuthority.gardenId,
      conversationId: jobAuthority.conversationId,
      displayName: imageName,
      mediaType: input.mediaType,
      declaredSizeBytes: input.image.byteLength,
    });
    const upload = await control.upload(
      jobAuthority,
      reservation,
      Readable.toWeb(Readable.from([input.image])) as ReadableStream<Uint8Array>,
      input.signal,
    );
    const digest = createHash("sha256")
      .update(JSON.stringify({
        scope: jobAuthority,
        image: { sha256: upload.sha256, sizeBytes: upload.sizeBytes },
        options: input.options,
        nonce: randomUUID(),
      }), "utf8")
      .digest("hex");
    job = await control.submit(jobAuthority, {
      jobType: "sf3d-reconstruct",
      idempotencyKey: `sf3d-v2:${digest}`,
      inputUploads: [{ uploadId: upload.uploadId }],
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "reconstruct",
        imageName,
        mediaType: input.mediaType,
        options: input.options,
      },
    });
    submitted = true;
    if (!isSf3dJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the SF3D worker contract.");
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
        throw new Sf3dRuntimeError(
          "sf3d_timeout",
          "The reconstruction did not finish in time and was stopped.",
          504,
        );
      }
      await delay(200, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isSf3dJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the SF3D worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another SF3D job.");
    }
    const result = validateEnvelope(job, output.content);
    if (
      result.ok === false &&
      exactKeys(result, ["ok", "operation", "errorCode", "message"]) &&
      result.operation === "reconstruct" &&
      typeof result.errorCode === "string" &&
      /^[a-z][a-z0-9_]{0,127}$/u.test(result.errorCode) &&
      typeof result.message === "string" &&
      result.message.trim() === result.message &&
      result.message.length > 0 &&
      Buffer.byteLength(result.message, "utf8") <= 32 * 1024 &&
      !/\p{Cc}/u.test(result.message)
    ) {
      const code = result.errorCode;
      const status = code === "sf3d_model_access_denied"
        ? 403
        : code === "sf3d_invalid_arguments" || code === "sf3d_invalid_image"
          ? 400
          : code === "sf3d_timeout"
            ? 504
            : code.includes("unavailable") || code.includes("incomplete")
              ? 503
              : 502;
      throw new Sf3dRuntimeError(code, result.message, status);
    }
    if (!exactKeys(result, [
      "ok",
      "operation",
      "outputRelativePath",
      "sizeBytes",
      "device",
      "durationSeconds",
      "peakMemoryMb",
      "options",
      "summary",
    ]) ||
      result.ok !== true ||
      result.operation !== "reconstruct" ||
      !Number.isSafeInteger(result.sizeBytes) ||
      Number(result.sizeBytes) < 1 ||
      Number(result.sizeBytes) > MAX_OUTPUT_MESH_BYTES ||
      typeof result.device !== "string" ||
      !result.device.trim() ||
      Buffer.byteLength(result.device, "utf8") > 64 ||
      !Number.isFinite(result.durationSeconds) ||
      Number(result.durationSeconds) < 0 ||
      (result.peakMemoryMb !== null &&
        (!Number.isFinite(result.peakMemoryMb) || Number(result.peakMemoryMb) < 0)) ||
      !validOptions(result.options) ||
      JSON.stringify(result.options) !== JSON.stringify(input.options) ||
      !validSummary(result.summary)) {
      throw new Error("Runtime returned invalid SF3D reconstruction metadata.");
    }
    const meshPath = resolveMesh(job, result.outputRelativePath, Number(result.sizeBytes));
    const meshRoot = attemptStageRoot(job);
    let cleaned = false;
    return {
      meshPath,
      meshRoot,
      sizeBytes: Number(result.sizeBytes),
      device: result.device,
      durationSeconds: Number(result.durationSeconds),
      peakMemoryMb: result.peakMemoryMb === null ? null : Number(result.peakMemoryMb),
      options: result.options,
      summary: result.summary,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        fs.rmSync(meshRoot, {
          recursive: true,
          force: true,
          maxRetries: process.platform === "win32" ? 10 : 0,
          retryDelay: 100,
        });
      },
    };
  } catch (error) {
    if (
      submitted &&
      job &&
      !cancellationForwarded &&
      input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!submitted && reservation) {
      await control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
  }
}
