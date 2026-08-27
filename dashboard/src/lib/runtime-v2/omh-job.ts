import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { validateOmhArguments } from "../hermes/omh-request.ts";
import type { OmhRunResult } from "../hermes/omh-service.ts";
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
const MAX_OPERATION_MS = 60_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const WORKSPACE_KEY = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/u;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface OmhRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string;
}

export interface OmhRuntimeControl {
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

const DEFAULT_CONTROL: OmhRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class OmhRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "OmhRuntimeError";
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

function authority(scope: OmhRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !boundedScope(scope.gardenId, true) ||
    !boundedScope(scope.conversationId, false)
  ) throw new TypeError("OMH Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function isOmhJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "omh-command" &&
    job.workerKind === "omh-node" &&
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
  ])) throw new Error("Runtime returned an invalid OMH result envelope.");
  if (
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned OMH output outside its worker fence.");
  return content.result;
}

function terminalError(job: RuntimeJobSnapshot): OmhRuntimeError {
  if (job.state === "cancelled") {
    return new OmhRuntimeError(
      "omh_cancelled",
      "OMH was cancelled with the current chat turn.",
      409,
    );
  }
  if (job.state === "resource_exhausted") {
    return new OmhRuntimeError(
      "omh_resource_exhausted",
      job.failureMessage ?? "There is not enough memory to start OMH.",
      503,
    );
  }
  return new OmhRuntimeError(
    "omh_failed",
    job.failureMessage ?? "OMH did not complete.",
    502,
  );
}

function statusForCode(code: string): number {
  if (code === "omh_runtime_unavailable") return 503;
  if (code === "omh_timeout") return 504;
  if (code === "omh_cancelled") return 409;
  if (
    code === "omh_launch_failed" ||
    code === "omh_empty_response" ||
    code === "omh_command_failed"
  ) return 502;
  if (code === "omh_command_denied" || code === "omh_flag_denied") return 403;
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

function validPayload(value: unknown): boolean {
  try {
    return value === null ||
      (value !== undefined &&
        Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_OUTPUT_BYTES);
  } catch {
    return false;
  }
}

function validRunResult(
  value: Record<string, unknown>,
  args: readonly string[],
): value is Record<string, unknown> & OmhRunResult {
  return exactKeys(value, [
    "ok",
    "operation",
    "arguments",
    "exitCode",
    "durationMs",
    "output",
    "payload",
  ]) &&
    value.ok === true &&
    value.operation === "command" &&
    Array.isArray(value.arguments) &&
    JSON.stringify(value.arguments) === JSON.stringify(args) &&
    (value.exitCode === null ||
      (Number.isSafeInteger(value.exitCode) && Number(value.exitCode) >= -1 &&
        Number(value.exitCode) <= 255)) &&
    Number.isSafeInteger(value.durationMs) && Number(value.durationMs) >= 0 &&
    Number(value.durationMs) <= MAX_OPERATION_MS &&
    typeof value.output === "string" && value.output.trim() === value.output &&
    value.output.length > 0 && Buffer.byteLength(value.output, "utf8") <= MAX_OUTPUT_BYTES &&
    !value.output.includes("\u0000") && validPayload(value.payload);
}

/** Run one allowlisted, read-only OMH command in a conversation workspace. */
export async function runOmhViaRuntime(input: {
  readonly scope: OmhRuntimeScope;
  readonly workspaceKey: string;
  readonly arguments: unknown;
  readonly signal?: AbortSignal;
  readonly control?: OmhRuntimeControl;
}): Promise<OmhRunResult> {
  const args = validateOmhArguments(input.arguments);
  if (
    !WORKSPACE_KEY.test(input.workspaceKey) ||
    Buffer.byteLength(input.workspaceKey, "utf8") > 512
  ) throw new TypeError("OMH workspace identity is invalid.");
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
      jobType: "omh-command",
      idempotencyKey: `omh-v2:${digest}`,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "command",
        workspaceKey: input.workspaceKey,
        arguments: args,
      },
    });
    if (!isOmhJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the OMH worker contract.");
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
        throw new OmhRuntimeError("omh_timeout", "OMH did not finish within the time limit.", 504);
      }
      await delay(100, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isOmhJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the OMH worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another OMH job.");
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
    ) throw new OmhRuntimeError(
      result.errorCode,
      result.message,
      statusForCode(result.errorCode),
    );
    if (!validRunResult(result, args)) {
      throw new Error("Runtime returned invalid OMH command metadata.");
    }
    return {
      arguments: result.arguments,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: result.output,
      payload: result.payload,
    };
  } catch (error) {
    if (
      job && !cancellationForwarded && input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
    throw error;
  }
}
