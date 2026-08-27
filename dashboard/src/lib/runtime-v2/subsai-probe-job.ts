import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  RuntimeJobControlError,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobIdempotencyCancellationDisposition,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const CACHE_MS = 30_000;
const MAX_OPERATION_MS = 45_000;
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

/** Process-free copy of the stable health response returned by the worker. */
export interface SubsAiHealth {
  readonly available: boolean;
  readonly cloned: boolean;
  readonly root: string | null;
  readonly python: string | null;
  readonly uvAvailable: boolean;
  readonly models: string[];
  readonly reason: string | null;
}

export interface SubsAiProbeControl {
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

interface CachedHealth {
  readonly at: number;
  readonly value: SubsAiHealth;
}

interface InFlightHealth {
  readonly promise: Promise<SubsAiHealth>;
  readonly abort: AbortController;
  waiters: number;
}

const DEFAULT_CONTROL: SubsAiProbeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

const healthGlobal = globalThis as typeof globalThis & {
  __breadboardSubsAiProbeHealth?: CachedHealth;
  __breadboardSubsAiProbeInFlight?: InFlightHealth;
};

export class SubsAiProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SubsAiProbeError";
    this.code = code;
    this.status = status;
  }
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("SubsAI health user scope is invalid.");
  }
  return { userId, gardenId: null, conversationId: null };
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

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function assertSnapshot(job: RuntimeJobSnapshot): void {
  if (
    job.jobType !== "subsai-probe" || job.workerKind !== "subsai-probe-node" ||
    job.resourceClass !== "document-processing" ||
    job.gardenId !== null || job.conversationId !== null
  ) throw new Error("Runtime returned a job outside the SubsAI health contract.");
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): SubsAiHealth {
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId || content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result) ||
    !exactKeys(content.result, [
      "available", "cloned", "root", "python", "uvAvailable", "models", "reason",
    ])
  ) throw new Error("Runtime returned an unfenced SubsAI health result.");
  const result = content.result;
  if (
    typeof result.available !== "boolean" || typeof result.cloned !== "boolean" ||
    !(result.root === null || (
      boundedText(result.root, MAX_PATH_BYTES) && path.isAbsolute(result.root)
    )) ||
    !(result.python === null || (
      boundedText(result.python, MAX_PATH_BYTES) && path.isAbsolute(result.python)
    )) ||
    typeof result.uvAvailable !== "boolean" ||
    !Array.isArray(result.models) || result.models.length > 32 ||
    !result.models.every((model) => boundedText(model, 256) && model.length > 0) ||
    new Set(result.models).size !== result.models.length ||
    !(result.reason === null || boundedText(result.reason, MAX_REASON_BYTES)) ||
    result.cloned !== (result.root !== null) ||
    result.available !== (result.root !== null && result.python !== null) ||
    (result.python === null && result.models.length !== 0) ||
    result.available !== (result.reason === null)
  ) throw new Error("Runtime returned invalid SubsAI health metadata.");
  return {
    available: result.available,
    cloned: result.cloned,
    root: result.root,
    python: result.python,
    uvAvailable: result.uvAvailable,
    models: [...result.models],
    reason: result.reason,
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

function terminalError(job: RuntimeJobSnapshot): Error {
  if (job.state === "resource_exhausted" && job.resourceExhaustion) {
    const evidence = job.resourceExhaustion;
    return new RuntimeJobControlError({
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      message: "Windows commit headroom is too low for the SubsAI health probe.",
      status: 503,
      resource: evidence.resource,
      requiredHeadroomMb: evidence.requiredHeadroomMb,
      availableHeadroomMb: evidence.availableHeadroomMb,
    });
  }
  if (job.state === "cancelled") {
    return new SubsAiProbeError("subsai_probe_cancelled", "The SubsAI health probe was cancelled.", 499);
  }
  return new SubsAiProbeError(
    "subsai_probe_interrupted",
    job.failureMessage ?? "The SubsAI health probe was interrupted.",
    502,
  );
}

/** Submit one system-health observation to a fresh user-scoped Runtime worker. */
export async function runSubsAiProbeViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: SubsAiProbeControl;
}): Promise<SubsAiHealth> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const jobAuthority = authority(input.userId);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `subsai-probe-v2:${createHash("sha256")
    .update(`${input.userId}:${randomUUID()}`, "utf8")
    .digest("hex")}`;
  let submissionAttempted = false;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    submissionAttempted = true;
    job = await control.submit(jobAuthority, {
      jobType: "subsai-probe",
      idempotencyKey,
      requestPayload: { protocolVersion: PROTOCOL_VERSION, operation: "status" },
    });
    assertSnapshot(job);
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
        throw new SubsAiProbeError(
          "subsai_probe_timeout",
          "The SubsAI health probe did not finish in time.",
          504,
        );
      }
      await delay(100, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      assertSnapshot(job);
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another SubsAI health probe.");
    }
    return parseResult(job, output.content);
  } catch (error) {
    if (
      job && !cancellationForwarded && input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw input.signal.reason ?? error;
    }
    if (!job && submissionAttempted) {
      await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey).catch(() => undefined);
    }
    if (!job && input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }
    throw error;
  }
}

function waitForShared(running: InFlightHealth, signal?: AbortSignal): Promise<SubsAiHealth> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  running.waiters += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      running.waiters -= 1;
    };
    const abort = () => {
      release();
      if (running.waiters === 0) {
        running.abort.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      }
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    running.promise.then(
      (value) => {
        if (settled) return;
        release();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        release();
        reject(error);
      },
    );
    if (signal?.aborted) abort();
  });
}

/** Preserve the historical 30-second system-health cache outside the disposable worker. */
export function subsAiHealthViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: SubsAiProbeControl;
}): Promise<SubsAiHealth> {
  authority(input.userId);
  if (input.signal?.aborted) {
    return Promise.reject(input.signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  const cached = healthGlobal.__breadboardSubsAiProbeHealth;
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
  const existing = healthGlobal.__breadboardSubsAiProbeInFlight;
  if (existing) return waitForShared(existing, input.signal);
  const abort = new AbortController();
  const running = {} as InFlightHealth;
  const promise = runSubsAiProbeViaRuntime({
    userId: input.userId,
    signal: abort.signal,
    control: input.control,
  }).then((value) => {
    healthGlobal.__breadboardSubsAiProbeHealth = { at: Date.now(), value };
    return value;
  }).finally(() => {
    if (healthGlobal.__breadboardSubsAiProbeInFlight === running) {
      healthGlobal.__breadboardSubsAiProbeInFlight = undefined;
    }
  });
  Object.assign(running, { promise, abort, waiters: 0 });
  healthGlobal.__breadboardSubsAiProbeInFlight = running;
  return waitForShared(running, input.signal);
}

export function invalidateSubsAiHealth(): void {
  healthGlobal.__breadboardSubsAiProbeHealth = undefined;
}
