import { createHash } from "node:crypto";

import {
  validateLoopxTickRuntimeRequest,
  type LoopxTickRuntimeRequest,
} from "../loopx/request.ts";
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

const MAX_OPERATION_MS = 300_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface LoopxTickRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string;
}

export interface LoopxTickRuntimeResult {
  readonly conversationPublicId: string;
  readonly turnSequence: number;
  readonly created: boolean;
  readonly goalId: string;
  readonly durationMs: number;
}

export interface LoopxTickRuntimeControl {
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

const DEFAULT_CONTROL: LoopxTickRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class LoopxTickRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "LoopxTickRuntimeError";
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
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function boundedScope(value: string | null, nullable: boolean): boolean {
  return value === null
    ? nullable
    : value.trim() === value && value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= 256 && !/\p{Cc}/u.test(value);
}

function authority(scope: LoopxTickRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) || scope.userId < 1 ||
    !boundedScope(scope.gardenId, true) || !boundedScope(scope.conversationId, false)
  ) throw new TypeError("LoopX Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function isLoopxJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "loopx-tick" && job.workerKind === "loopx-node" &&
    job.resourceClass === "document-processing" && job.gardenId === scope.gardenId &&
    job.conversationId === scope.conversationId;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!isRecord(content) || !exactKeys(content, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) throw new Error("Runtime returned an invalid LoopX result envelope.");
  if (
    content.protocolVersion !== 1 || content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId || content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId || !isRecord(content.result)
  ) throw new Error("Runtime returned LoopX output outside its worker fence.");
  return content.result;
}

function terminalError(job: RuntimeJobSnapshot): LoopxTickRuntimeError {
  if (job.state === "cancelled") {
    return new LoopxTickRuntimeError("loopx_cancelled", "LoopX was cancelled.", 409);
  }
  if (job.state === "resource_exhausted") {
    return new LoopxTickRuntimeError(
      "loopx_resource_exhausted",
      job.failureMessage ?? "There is not enough memory to start LoopX.",
      503,
    );
  }
  return new LoopxTickRuntimeError(
    "loopx_failed",
    job.failureMessage ?? "LoopX did not complete.",
    502,
  );
}

function statusForCode(code: string): number {
  if (code === "loopx_runtime_unavailable" || code === "loopx_disabled") return 503;
  if (code === "loopx_timeout") return 504;
  if (code === "loopx_cancelled") return 409;
  if (code === "loopx_launch_failed" || code === "loopx_invalid_response") return 502;
  if (code === "loopx_command_denied") return 403;
  return 400;
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

function validResult(
  value: Record<string, unknown>,
  request: LoopxTickRuntimeRequest,
): value is Record<string, unknown> & LoopxTickRuntimeResult {
  return exactKeys(value, [
    "ok",
    "operation",
    "conversationPublicId",
    "turnSequence",
    "created",
    "goalId",
    "durationMs",
  ]) && value.ok === true && value.operation === "tick" &&
    value.conversationPublicId === request.conversationPublicId &&
    value.turnSequence === request.turnSequence && typeof value.created === "boolean" &&
    typeof value.goalId === "string" && /^bb-[a-z0-9-]{1,48}$/u.test(value.goalId) &&
    Number.isSafeInteger(value.durationMs) && Number(value.durationMs) >= 0 &&
    Number(value.durationMs) <= MAX_OPERATION_MS;
}

/** Submit one durable post-turn LoopX transaction. */
export async function runLoopxTickViaRuntime(input: {
  readonly scope: LoopxTickRuntimeScope;
  readonly request: LoopxTickRuntimeRequest;
  readonly signal?: AbortSignal;
  readonly control?: LoopxTickRuntimeControl;
}): Promise<LoopxTickRuntimeResult> {
  const request = validateLoopxTickRuntimeRequest(input.request);
  const jobAuthority = authority(input.scope);
  if (request.conversationPublicId !== jobAuthority.conversationId) {
    throw new TypeError("LoopX conversation scope is invalid.");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ scope: jobAuthority, request }), "utf8")
    .digest("hex");
  const control = input.control ?? DEFAULT_CONTROL;
  let cancellationForwarded = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "loopx-tick",
      idempotencyKey: `loopx-v2:${digest}`,
      requestPayload: request,
    });
    if (!isLoopxJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the LoopX worker contract.");
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
        throw new LoopxTickRuntimeError("loopx_timeout", "LoopX did not finish in time.", 504);
      }
      await delay(100, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isLoopxJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the LoopX worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another LoopX job.");
    }
    const result = validateEnvelope(job, output.content);
    if (
      result.ok === false && exactKeys(result, ["ok", "operation", "errorCode", "message"]) &&
      result.operation === "tick" && typeof result.errorCode === "string" &&
      /^[a-z][a-z0-9_]{0,127}$/u.test(result.errorCode) &&
      typeof result.message === "string" && result.message.trim() === result.message &&
      result.message.length > 0 && Buffer.byteLength(result.message, "utf8") <= 32 * 1024 &&
      !/\p{Cc}/u.test(result.message)
    ) throw new LoopxTickRuntimeError(
      result.errorCode,
      result.message,
      statusForCode(result.errorCode),
    );
    if (!validResult(result, request)) {
      throw new Error("Runtime returned invalid LoopX tick metadata.");
    }
    return {
      conversationPublicId: result.conversationPublicId,
      turnSequence: result.turnSequence,
      created: result.created,
      goalId: result.goalId,
      durationMs: result.durationMs,
    };
  } catch (error) {
    if (
      job && !cancellationForwarded && input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
    throw error;
  }
}
