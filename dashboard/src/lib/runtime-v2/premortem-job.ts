import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  validatePremortemArguments,
} from "../hermes/premortem-request.ts";
import type {
  PremortemEnvelope,
  PremortemRunResult,
} from "../hermes/premortem-service.ts";
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
const MAX_OPERATION_MS = 90_000;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const WORKSPACE_KEY = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/u;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface PremortemRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string;
}

export interface PremortemRuntimeControl {
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

const DEFAULT_CONTROL: PremortemRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class PremortemRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "PremortemRuntimeError";
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

function authority(scope: PremortemRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !boundedScope(scope.gardenId, true) ||
    !boundedScope(scope.conversationId, false)
  ) throw new TypeError("Premortem Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function isPremortemJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "premortem-command" &&
    job.workerKind === "premortem-node" &&
    job.resourceClass === "document-processing" &&
    job.gardenId === scope.gardenId &&
    job.conversationId === scope.conversationId;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!isRecord(content) || !exactKeys(content, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) throw new Error("Runtime returned an invalid Premortem result envelope.");
  if (
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned Premortem output outside its worker fence.");
  return content.result;
}

function terminalError(job: RuntimeJobSnapshot): PremortemRuntimeError {
  if (job.state === "cancelled") {
    return new PremortemRuntimeError(
      "premortem_cancelled",
      "Premortem was cancelled with the current chat turn.",
      409,
    );
  }
  if (job.state === "resource_exhausted") {
    return new PremortemRuntimeError(
      "premortem_resource_exhausted",
      job.failureMessage ?? "There is not enough memory to start Premortem.",
      503,
    );
  }
  return new PremortemRuntimeError(
    "premortem_failed",
    job.failureMessage ?? "Premortem did not complete.",
    502,
  );
}

function statusForCode(code: string): number {
  return code === "premortem_runtime_unavailable"
    ? 503
    : code === "premortem_timeout"
      ? 504
      : code === "premortem_cancelled"
        ? 409
        : code === "premortem_invalid_response" || code === "premortem_launch_failed"
          ? 502
          : code === "premortem_command_denied" || code === "premortem_flag_denied"
            ? 403
            : 400;
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

function validRunResult(value: Record<string, unknown>, args: readonly string[]): value is Record<string, unknown> & {
  arguments: string[];
  exitCode: number | null;
  durationMs: number;
  envelope: PremortemEnvelope;
} {
  if (!exactKeys(value, ["ok", "operation", "arguments", "exitCode", "durationMs", "envelope"]) ||
    value.ok !== true ||
    value.operation !== "command" ||
    !Array.isArray(value.arguments) ||
    JSON.stringify(value.arguments) !== JSON.stringify(args) ||
    !(value.exitCode === null ||
      (Number.isSafeInteger(value.exitCode) && Number(value.exitCode) >= -1 && Number(value.exitCode) <= 255)) ||
    !Number.isSafeInteger(value.durationMs) ||
    Number(value.durationMs) < 0 ||
    Number(value.durationMs) > MAX_OPERATION_MS ||
    !isRecord(value.envelope)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value.envelope), "utf8") <= MAX_ENVELOPE_BYTES;
  } catch {
    return false;
  }
}

/** Run one allowlisted Premortem command in its conversation workspace. */
export async function runPremortemViaRuntime(input: {
  readonly scope: PremortemRuntimeScope;
  readonly workspaceKey: string;
  readonly arguments: unknown;
  readonly signal?: AbortSignal;
  readonly control?: PremortemRuntimeControl;
}): Promise<PremortemRunResult> {
  const args = validatePremortemArguments(input.arguments);
  if (
    !WORKSPACE_KEY.test(input.workspaceKey) ||
    Buffer.byteLength(input.workspaceKey, "utf8") > 512
  ) throw new TypeError("Premortem workspace identity is invalid.");
  const jobAuthority = authority(input.scope);
  const control = input.control ?? DEFAULT_CONTROL;
  const digest = createHash("sha256")
    .update(JSON.stringify({
      scope: jobAuthority,
      workspaceKey: input.workspaceKey,
      arguments: args,
      nonce: randomUUID(),
    }), "utf8")
    .digest("hex");
  let cancellationForwarded = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "premortem-command",
      idempotencyKey: `premortem-v2:${digest}`,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "command",
        workspaceKey: input.workspaceKey,
        arguments: args,
      },
    });
    if (!isPremortemJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the Premortem worker contract.");
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
        throw new PremortemRuntimeError(
          "premortem_timeout",
          "Premortem did not finish within the time limit.",
          504,
        );
      }
      await delay(100, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isPremortemJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the Premortem worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Premortem job.");
    }
    const result = validateEnvelope(job, output.content);
    if (
      result.ok === false &&
      exactKeys(result, ["ok", "operation", "errorCode", "message"]) &&
      result.operation === "command" &&
      typeof result.errorCode === "string" &&
      /^[a-z][a-z0-9_]{0,127}$/u.test(result.errorCode) &&
      typeof result.message === "string" &&
      result.message.trim() === result.message &&
      result.message.length > 0 &&
      Buffer.byteLength(result.message, "utf8") <= 32 * 1024 &&
      !/\p{Cc}/u.test(result.message)
    ) throw new PremortemRuntimeError(
      result.errorCode,
      result.message,
      statusForCode(result.errorCode),
    );
    if (!validRunResult(result, args)) {
      throw new Error("Runtime returned invalid Premortem command metadata.");
    }
    return {
      arguments: result.arguments,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      envelope: result.envelope,
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
