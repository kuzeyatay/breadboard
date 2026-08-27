import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { MAX_FORMSMITH_IMAGE_BYTES, type FormsmithRequest } from "../shaper/identity.ts";
import { repositoryRoot } from "../runtime-paths.ts";
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
  type RuntimeJobIdempotencyCancellationDisposition,
  type RuntimeJobInputReservation,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import type { ShapeRHealth } from "../shaper/runtime.ts";

const PROTOCOL_VERSION = 1;
const PROBE_CONTRACT = Object.freeze({
  jobType: "formsmith-probe",
  workerKind: "formsmith-probe-node",
  resourceClass: "document-processing",
});
const RECONSTRUCTION_CONTRACT = Object.freeze({
  jobType: "formsmith",
  workerKind: "formsmith-node",
  resourceClass: "local-model",
});
const MAX_MESH_BYTES = 512 * 1024 * 1024;
const MAX_FAILURE_BYTES = 32 * 1024;
const PROBE_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1_000 + 5 * 60_000;
const POLL_MS = 200;
const STAGES = new Set(["prepare", "depth", "reconstruct"]);
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface FormsmithRuntimeStage {
  readonly stage: "prepare" | "depth" | "reconstruct";
  readonly status: "running" | "completed";
}

export interface FormsmithRuntimeResult {
  readonly meshPath: string;
  readonly meshRoot: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly cleanup: () => void;
}

export interface FormsmithRuntimeControl {
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
  lookup(
    authority: RuntimeJobAuthority,
    idempotencyKey: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
  inspect(
    authority: RuntimeJobAuthority,
    jobId: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobOutput>;
  cancel(
    authority: RuntimeJobAuthority,
    jobId: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
  cancelByIdempotencyKey(
    authority: RuntimeJobAuthority,
    idempotencyKey: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobIdempotencyCancellationDisposition>;
}

const DEFAULT_CONTROL: FormsmithRuntimeControl = {
  configured: isRuntimeV2ServiceControlConfigured,
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  lookup: lookupRuntimeJobByIdempotencyKey,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class FormsmithRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "FormsmithRuntimeError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function authority(userId: number, conversationId: string | null): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Formsmith Runtime user scope is invalid.");
  }
  if (conversationId !== null && !boundedText(conversationId, 256)) {
    throw new TypeError("Formsmith Runtime conversation scope is invalid.");
  }
  return { userId, gardenId: null, conversationId };
}

function assertSnapshot(
  snapshot: RuntimeJobSnapshot,
  expected: RuntimeJobAuthority,
  contract: typeof PROBE_CONTRACT | typeof RECONSTRUCTION_CONTRACT,
): void {
  if (
    snapshot.jobType !== contract.jobType ||
    snapshot.workerKind !== contract.workerKind ||
    snapshot.resourceClass !== contract.resourceClass ||
    snapshot.gardenId !== null ||
    snapshot.conversationId !== expected.conversationId
  ) throw new Error("Runtime returned a job outside the sealed Formsmith contract.");
}

function validIdentity(job: RuntimeJobSnapshot, value: unknown): boolean {
  return exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) &&
    value.jobId === job.jobId &&
    value.attempt === job.attempt &&
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
  return typeof value === "string" &&
    !value.includes("\\") &&
    value.split("/").length > 1 &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function resolveDataPath(env: NodeJS.ProcessEnv, relativePath: unknown): string {
  if (!validRelativePath(relativePath)) {
    throw new Error("Runtime returned an invalid Formsmith output path.");
  }
  const root = runtimeDataRoot(env);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!pathWithin(root, resolved) || samePath(root, resolved)) {
    throw new Error("Runtime returned Formsmith output outside its data root.");
  }
  return resolved;
}

function attemptStageRoot(env: NodeJS.ProcessEnv, job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) throw new Error("The completed Formsmith job has no worker identity.");
  return path.join(
    runtimeDataRoot(env),
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "formsmith-stage",
  );
}

function resolveMesh(
  env: NodeJS.ProcessEnv,
  job: RuntimeJobSnapshot,
  relativePath: unknown,
  expectedSize: number,
): string {
  const resolved = resolveDataPath(env, relativePath);
  const stageRoot = attemptStageRoot(env, job);
  if (
    !samePath(resolved, path.join(stageRoot, "formsmith.glb")) ||
    !pathWithin(stageRoot, resolved) ||
    samePath(stageRoot, resolved)
  ) throw new Error("Runtime returned a Formsmith mesh outside its private attempt stage.");
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== expectedSize ||
    metadata.size < 12 ||
    metadata.size > MAX_MESH_BYTES ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) throw new Error("Runtime returned an unavailable or oversized Formsmith mesh.");
  const descriptor = fs.openSync(resolved, "r");
  try {
    const header = Buffer.alloc(12);
    if (
      fs.readSync(descriptor, header, 0, header.length, 0) !== header.length ||
      header.subarray(0, 4).toString("ascii") !== "glTF" ||
      header.readUInt32LE(4) !== 2 ||
      header.readUInt32LE(8) !== metadata.size
    ) throw new Error("Runtime returned a file that is not binary glTF.");
  } finally {
    fs.closeSync(descriptor);
  }
  return resolved;
}

function parseStages(value: unknown): FormsmithRuntimeStage[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error("Runtime returned invalid Formsmith progress.");
  }
  const stages = value.map((entry) => {
    if (
      !exactRecord(entry, ["stage", "status"]) ||
      !STAGES.has(String(entry.stage)) ||
      !["running", "completed"].includes(String(entry.status))
    ) throw new Error("Runtime returned invalid Formsmith stage progress.");
    return {
      stage: entry.stage as FormsmithRuntimeStage["stage"],
      status: entry.status as FormsmithRuntimeStage["status"],
    };
  });
  const expected = [
    "prepare:running",
    "prepare:completed",
    "depth:running",
    "depth:completed",
    "reconstruct:running",
    "reconstruct:completed",
  ];
  for (let index = 0; index < stages.length; index += 1) {
    if (`${stages[index].stage}:${stages[index].status}` !== expected[index]) {
      throw new Error("Runtime returned out-of-order Formsmith progress.");
    }
  }
  return stages;
}

function parseEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (
    !exactRecord(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !validIdentity(job, content.identity) ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned unfenced Formsmith output.");
  return content.result;
}

function parseCheckpoint(job: RuntimeJobSnapshot, content: unknown): FormsmithRuntimeStage[] {
  if (
    !exactRecord(content, ["protocolVersion", "identity", "snapshot"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    !validIdentity(job, content.identity) ||
    !exactRecord(content.snapshot, ["operation", "stages"]) ||
    content.snapshot.operation !== "reconstruct"
  ) throw new Error("Runtime returned an invalid Formsmith checkpoint.");
  return parseStages(content.snapshot.stages);
}

function parseHealth(value: unknown): ShapeRHealth {
  if (
    !exactRecord(value, [
      "available",
      "cloned",
      "root",
      "python",
      "bridgeFound",
      "dependenciesInstalled",
      "cudaAvailable",
      "missing",
      "reason",
    ]) ||
    typeof value.available !== "boolean" ||
    typeof value.cloned !== "boolean" ||
    !(value.root === null || boundedText(value.root, 4_096)) ||
    !(value.python === null || boundedText(value.python, 4_096)) ||
    typeof value.bridgeFound !== "boolean" ||
    typeof value.dependenciesInstalled !== "boolean" ||
    typeof value.cudaAvailable !== "boolean" ||
    !Array.isArray(value.missing) ||
    value.missing.length > 64 ||
    value.missing.some((item) => !boundedText(item, 256)) ||
    !(value.reason === null || boundedText(value.reason, MAX_FAILURE_BYTES))
  ) throw new Error("Runtime returned invalid ShapeR health metadata.");
  if (
    value.available !== (value.cloned && value.bridgeFound &&
      value.dependenciesInstalled && value.cudaAvailable) ||
    (value.available && value.reason !== null)
  ) throw new Error("Runtime returned inconsistent ShapeR health metadata.");
  return value as unknown as ShapeRHealth;
}

function terminalError(job: RuntimeJobSnapshot): FormsmithRuntimeError {
  if (job.state === "cancelled") {
    return new FormsmithRuntimeError("formsmith_cancelled", "The reconstruction was stopped.", 499);
  }
  if (job.state === "resource_exhausted") {
    return new FormsmithRuntimeError(
      "formsmith_runtime_unavailable",
      job.failureMessage ?? "There is not enough free memory to start Formsmith.",
      503,
    );
  }
  return new FormsmithRuntimeError(
    "formsmith_reconstruction_failed",
    job.failureMessage ?? "The reconstruction did not complete.",
    502,
  );
}

function domainError(result: Record<string, unknown>): FormsmithRuntimeError | null {
  if (result.ok !== false) return null;
  if (
    !exactRecord(result, ["ok", "operation", "error", "stages"]) ||
    result.operation !== "reconstruct" ||
    !exactRecord(result.error, ["code", "message"]) ||
    typeof result.error.code !== "string" ||
    !/^[a-z][a-z0-9_]{0,127}$/u.test(result.error.code) ||
    !boundedText(result.error.message, MAX_FAILURE_BYTES)
  ) throw new Error("Runtime returned an invalid Formsmith failure.");
  parseStages(result.stages);
  const code = result.error.code;
  const status = code === "formsmith_invalid_image"
    ? 400
    : code === "formsmith_runtime_unavailable"
      ? 503
      : code === "formsmith_timeout"
        ? 504
        : 502;
  return new FormsmithRuntimeError(code, result.error.message, status);
}

function mediaTypeFor(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    default: throw new FormsmithRuntimeError(
      "formsmith_invalid_image",
      "Formsmith accepts only JPEG, PNG, or WebP pictures.",
      400,
    );
  }
}

function openDirectImage(filePath: string, expectedSize: number): ReadableStream<Uint8Array> {
  const before = fs.lstatSync(filePath);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size !== expectedSize ||
    before.size < 1 ||
    before.size > MAX_FORMSMITH_IMAGE_BYTES
  ) throw new FormsmithRuntimeError(
    "formsmith_invalid_image",
    "The uploaded picture changed before Runtime could seal it.",
    400,
  );
  const noFollow = "O_NOFOLLOW" in fs.constants
    ? (fs.constants as typeof fs.constants & { O_NOFOLLOW: number }).O_NOFOLLOW
    : 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.size !== before.size ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) throw new FormsmithRuntimeError(
      "formsmith_invalid_image",
      "The uploaded picture changed before Runtime could seal it.",
      400,
    );
    return Readable.toWeb(
      fs.createReadStream(filePath, { fd: descriptor, autoClose: true }),
    ) as ReadableStream<Uint8Array>;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(
    signal.reason ?? new DOMException("Aborted", "AbortError"),
  );
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

function isNotFound(error: unknown): boolean {
  return error instanceof RuntimeJobControlError &&
    ["JOB_NOT_FOUND", "RUNTIME_JOB_NOT_FOUND"].includes(error.code);
}

function mapControlError(error: unknown): FormsmithRuntimeError {
  if (error instanceof FormsmithRuntimeError) return error;
  if (error instanceof RuntimeJobControlError) {
    if (["RUNTIME_UNAVAILABLE", "BREADBOARD_RESOURCE_EXHAUSTED"].includes(error.code)) {
      return new FormsmithRuntimeError("formsmith_runtime_unavailable", error.message, 503);
    }
    return new FormsmithRuntimeError("formsmith_reconstruction_failed", error.message, 502);
  }
  return new FormsmithRuntimeError(
    "formsmith_reconstruction_failed",
    error instanceof Error
      ? error.message.slice(0, MAX_FAILURE_BYTES)
      : "Formsmith returned invalid Runtime output.",
    502,
  );
}

function idempotencyKey(userId: number, runId: string): string {
  if (!/^fmsrun_[a-f0-9]{32}$/u.test(runId)) {
    throw new TypeError("Formsmith run identity is invalid.");
  }
  return `formsmith-v2:${userId}:${runId}`;
}

async function readCheckpointStages(
  control: FormsmithRuntimeControl,
  env: NodeJS.ProcessEnv,
  jobAuthority: RuntimeJobAuthority,
  job: RuntimeJobSnapshot,
): Promise<FormsmithRuntimeStage[] | null> {
  try {
    const output = await control.readOutput(jobAuthority, job.jobId, "checkpoint", env);
    if (output.jobId !== job.jobId || output.kind !== "checkpoint") {
      throw new Error("Runtime returned a checkpoint for another Formsmith job.");
    }
    return parseCheckpoint(job, output.content);
  } catch (error) {
    if (
      error instanceof RuntimeJobControlError &&
      ["JOB_OUTPUT_NOT_READY", "JOB_NOT_FOUND"].includes(error.code)
    ) return null;
    throw error;
  }
}

function publishNewStages(
  stages: readonly FormsmithRuntimeStage[],
  delivered: number,
  onStage: (stage: FormsmithRuntimeStage) => void,
): number {
  for (const stage of stages.slice(delivered)) onStage(stage);
  return Math.max(delivered, stages.length);
}

async function waitForTerminal(input: {
  control: FormsmithRuntimeControl;
  env: NodeJS.ProcessEnv;
  authority: RuntimeJobAuthority;
  snapshot: RuntimeJobSnapshot;
  signal: AbortSignal;
  deadline: number;
  timeout: FormsmithRuntimeError;
  contract: typeof PROBE_CONTRACT | typeof RECONSTRUCTION_CONTRACT;
  onStage?: (stage: FormsmithRuntimeStage) => void;
}): Promise<{ snapshot: RuntimeJobSnapshot; deliveredStages: number }> {
  let snapshot = input.snapshot;
  let deliveredStages = 0;
  while (!TERMINAL_STATES.has(snapshot.state)) {
    if (input.onStage) {
      const stages = await readCheckpointStages(
        input.control,
        input.env,
        input.authority,
        snapshot,
      );
      if (stages) deliveredStages = publishNewStages(stages, deliveredStages, input.onStage);
    }
    if (input.signal.aborted) {
      await input.control.cancel(input.authority, snapshot.jobId, input.env).catch(() => undefined);
      throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (Date.now() >= input.deadline) {
      await input.control.cancel(input.authority, snapshot.jobId, input.env).catch(() => undefined);
      throw input.timeout;
    }
    await delay(POLL_MS, input.signal);
    snapshot = await input.control.inspect(input.authority, snapshot.jobId, input.env);
    assertSnapshot(snapshot, input.authority, input.contract);
  }
  return { snapshot, deliveredStages };
}

export async function probeShapeRViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
  readonly control?: FormsmithRuntimeControl;
}): Promise<ShapeRHealth> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) {
    throw new FormsmithRuntimeError(
      "formsmith_runtime_unavailable",
      "Formsmith requires the Breadboard Runtime job owner.",
      503,
    );
  }
  const jobAuthority = authority(input.userId, null);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Request aborted", "AbortError"),
  );
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(
    new FormsmithRuntimeError("formsmith_probe_timeout", "The ShapeR environment probe timed out.", 504),
  ), PROBE_TIMEOUT_MS);
  timer.unref?.();
  let job: RuntimeJobSnapshot | null = null;
  try {
    job = await control.submit(jobAuthority, {
      jobType: PROBE_CONTRACT.jobType,
      idempotencyKey: `formsmith-probe-v2:${input.userId}:${randomUUID()}`,
      requestPayload: { protocolVersion: PROTOCOL_VERSION, operation: "probe" },
      inputUploads: [],
    }, env);
    assertSnapshot(job, jobAuthority, PROBE_CONTRACT);
    const waited = await waitForTerminal({
      control,
      env,
      authority: jobAuthority,
      snapshot: job,
      signal: controller.signal,
      deadline: Date.now() + PROBE_TIMEOUT_MS,
      timeout: new FormsmithRuntimeError(
        "formsmith_probe_timeout",
        "The ShapeR environment probe timed out.",
        504,
      ),
      contract: PROBE_CONTRACT,
    });
    job = waited.snapshot;
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result", env);
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Formsmith probe.");
    }
    const result = parseEnvelope(job, output.content);
    if (
      !exactRecord(result, ["ok", "operation", "health"]) ||
      result.ok !== true ||
      result.operation !== "probe"
    ) throw new Error("Runtime returned invalid Formsmith probe output.");
    return parseHealth(result.health);
  } catch (error) {
    if (controller.signal.aborted && job && !TERMINAL_STATES.has(job.state)) {
      await control.cancel(jobAuthority, job.jobId, env).catch(() => undefined);
    }
    if (controller.signal.reason instanceof FormsmithRuntimeError) throw controller.signal.reason;
    if (controller.signal.aborted) {
      throw new FormsmithRuntimeError("formsmith_cancelled", "The ShapeR environment probe was stopped.", 499);
    }
    throw mapControlError(error);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}

export async function runFormsmithViaRuntime(input: {
  readonly userId: number;
  readonly conversationId: string;
  readonly runId: string;
  readonly request: FormsmithRequest;
  readonly sourcePath: string;
  readonly signal?: AbortSignal;
  readonly onStage: (stage: FormsmithRuntimeStage) => void;
  readonly env?: NodeJS.ProcessEnv;
  readonly control?: FormsmithRuntimeControl;
}): Promise<FormsmithRuntimeResult> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) {
    throw new FormsmithRuntimeError(
      "formsmith_runtime_unavailable",
      "Formsmith requires the Breadboard Runtime job owner.",
      503,
    );
  }
  if (
    path.basename(input.request.filename) !== input.request.filename ||
    /[\\/\u0000]/u.test(input.request.filename) ||
    !Number.isSafeInteger(input.request.sizeBytes) ||
    input.request.sizeBytes < 1 ||
    input.request.sizeBytes > MAX_FORMSMITH_IMAGE_BYTES
  ) throw new FormsmithRuntimeError(
    "formsmith_invalid_image",
    "That picture is not a valid Formsmith input.",
    400,
  );
  const jobAuthority = authority(input.userId, input.conversationId);
  const key = idempotencyKey(input.userId, input.runId);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Request aborted", "AbortError"),
  );
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(
    new FormsmithRuntimeError(
      "formsmith_timeout",
      "The reconstruction passed its two-hour limit and was stopped.",
      504,
    ),
  ), RUN_TIMEOUT_MS);
  timer.unref?.();
  let reservation: RuntimeJobInputReservation | null = null;
  let uploadedForUnclaimedJob = false;
  let submissionAttempted = false;
  let job: RuntimeJobSnapshot | null = null;
  let deliveredStages = 0;
  try {
    if (controller.signal.aborted) {
      await control.cancelByIdempotencyKey(jobAuthority, key, env).catch(() => undefined);
      throw controller.signal.reason;
    }
    try {
      job = await control.lookup(jobAuthority, key, env);
      assertSnapshot(job, jobAuthority, RECONSTRUCTION_CONTRACT);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const metadata = fs.lstatSync(input.sourcePath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size !== input.request.sizeBytes
      ) throw new FormsmithRuntimeError(
        "formsmith_invalid_image",
        "That uploaded picture is no longer available. Choose it again.",
        400,
      );
      reservation = await control.reserve(jobAuthority, {
        gardenId: null,
        conversationId: input.conversationId,
        displayName: input.request.filename,
        mediaType: mediaTypeFor(input.request.filename),
        declaredSizeBytes: metadata.size,
      }, env);
      const body = openDirectImage(input.sourcePath, metadata.size);
      let upload;
      try {
        upload = await control.upload(jobAuthority, reservation, body, controller.signal, env);
      } catch (error) {
        await body.cancel(error).catch(() => undefined);
        throw error;
      }
      uploadedForUnclaimedJob = true;
      submissionAttempted = true;
      try {
        job = await control.submit(jobAuthority, {
          jobType: RECONSTRUCTION_CONTRACT.jobType,
          idempotencyKey: key,
          requestPayload: {
            protocolVersion: PROTOCOL_VERSION,
            operation: "reconstruct",
            filename: input.request.filename,
            sizeBytes: input.request.sizeBytes,
          },
          inputUploads: [{ uploadId: upload.uploadId }],
        }, env);
        uploadedForUnclaimedJob = false;
      } catch (submissionError) {
        try {
          job = await control.lookup(jobAuthority, key, env);
          assertSnapshot(job, jobAuthority, RECONSTRUCTION_CONTRACT);
          uploadedForUnclaimedJob = false;
        } catch {
          throw submissionError;
        }
      }
      assertSnapshot(job, jobAuthority, RECONSTRUCTION_CONTRACT);
    }
    const waited = await waitForTerminal({
      control,
      env,
      authority: jobAuthority,
      snapshot: job,
      signal: controller.signal,
      deadline: Date.now() + RUN_TIMEOUT_MS,
      timeout: new FormsmithRuntimeError(
        "formsmith_timeout",
        "The reconstruction passed its two-hour limit and was stopped.",
        504,
      ),
      contract: RECONSTRUCTION_CONTRACT,
      onStage: input.onStage,
    });
    job = waited.snapshot;
    deliveredStages = waited.deliveredStages;
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result", env);
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Formsmith job.");
    }
    const result = parseEnvelope(job, output.content);
    const stages = parseStages(result.stages);
    publishNewStages(stages, deliveredStages, input.onStage);
    const failure = domainError(result);
    if (failure) throw failure;
    if (
      !exactRecord(result, [
        "ok",
        "operation",
        "meshRelativePath",
        "meshSizeBytes",
        "durationMs",
        "stages",
      ]) ||
      result.ok !== true ||
      result.operation !== "reconstruct" ||
      typeof result.meshSizeBytes !== "number" ||
      !Number.isSafeInteger(result.meshSizeBytes) ||
      result.meshSizeBytes < 12 ||
      result.meshSizeBytes > MAX_MESH_BYTES ||
      typeof result.durationMs !== "number" ||
      !Number.isSafeInteger(result.durationMs) ||
      result.durationMs < 0 ||
      result.durationMs > RUN_TIMEOUT_MS
    ) throw new Error("Runtime returned invalid Formsmith reconstruction metadata.");
    const meshSizeBytes = result.meshSizeBytes as number;
    const durationMs = result.durationMs as number;
    const meshPath = resolveMesh(env, job, result.meshRelativePath, meshSizeBytes);
    const meshRoot = attemptStageRoot(env, job);
    let cleaned = false;
    return {
      meshPath,
      meshRoot,
      sizeBytes: meshSizeBytes,
      durationMs,
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
    if (controller.signal.aborted) {
      if (job) await control.cancel(jobAuthority, job.jobId, env).catch(() => undefined);
      else await control.cancelByIdempotencyKey(jobAuthority, key, env).catch(() => undefined);
      if (controller.signal.reason instanceof FormsmithRuntimeError) throw controller.signal.reason;
      throw new FormsmithRuntimeError("formsmith_cancelled", "The reconstruction was stopped.", 499);
    }
    if (submissionAttempted && !job) {
      await control.cancelByIdempotencyKey(jobAuthority, key, env).catch(() => undefined);
    } else if (job && !TERMINAL_STATES.has(job.state)) {
      await control.cancel(jobAuthority, job.jobId, env).catch(() => undefined);
    }
    throw mapControlError(error);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardAbort);
    if (uploadedForUnclaimedJob && reservation) {
      await control.abandon(jobAuthority, reservation.uploadId, env).catch(() => undefined);
    }
  }
}

export async function cancelFormsmithRuntimeRun(input: {
  readonly userId: number;
  readonly conversationId: string;
  readonly runId: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly control?: FormsmithRuntimeControl;
}): Promise<void> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) return;
  const jobAuthority = authority(input.userId, input.conversationId);
  await control.cancelByIdempotencyKey(
    jobAuthority,
    idempotencyKey(input.userId, input.runId),
    env,
  );
}
