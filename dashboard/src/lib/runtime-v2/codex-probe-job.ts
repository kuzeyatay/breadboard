import "server-only";

import { createHash, randomUUID } from "node:crypto";

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
const MAX_OPERATION_MS = 120_000;
const POLL_MS = 100;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_VERSION_BYTES = 120;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface CodexProbeStatus {
  readonly available: boolean;
  readonly installed: boolean;
  readonly version: string | null;
  readonly reason: string | null;
}

export interface CodexProbeControl {
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

const DEFAULT_CONTROL: CodexProbeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class CodexProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CodexProbeError";
    this.code = code;
    this.status = status;
  }
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Codex probe user scope is invalid.");
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
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function assertSnapshot(job: RuntimeJobSnapshot): void {
  if (
    job.jobType !== "codex-probe" ||
    job.workerKind !== "codex-probe-node" ||
    job.resourceClass !== "document-processing" ||
    job.gardenId !== null ||
    job.conversationId !== null
  ) throw new Error("Runtime returned a job outside the Codex probe contract.");
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): CodexProbeStatus {
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result) ||
    !exactKeys(content.result, ["available", "installed", "version", "reason"])
  ) throw new Error("Runtime returned an unfenced Codex probe result.");
  const result = content.result;
  if (
    typeof result.available !== "boolean" ||
    typeof result.installed !== "boolean" ||
    !(result.version === null || boundedText(result.version, MAX_VERSION_BYTES)) ||
    !(result.reason === null || boundedText(result.reason, MAX_REASON_BYTES)) ||
    (result.available && (!result.installed || !result.version || result.reason !== null)) ||
    (!result.available && (result.version !== null || !result.reason))
  ) throw new Error("Runtime returned invalid Codex availability metadata.");
  return {
    available: result.available,
    installed: result.installed,
    version: result.version,
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
      message: "Windows commit headroom is too low for the Codex health probe.",
      status: 503,
      resource: evidence.resource,
      requiredHeadroomMb: evidence.requiredHeadroomMb,
      availableHeadroomMb: evidence.availableHeadroomMb,
    });
  }
  if (job.state === "cancelled") {
    return new CodexProbeError(
      "codex_probe_cancelled",
      "The Codex health probe was cancelled.",
      499,
    );
  }
  return new CodexProbeError(
    "codex_probe_interrupted",
    job.failureMessage ?? "The Codex health probe was interrupted.",
    502,
  );
}

/** Run one fixed, observational Codex executable probe in a disposable Runtime worker. */
export async function runCodexProbeViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: CodexProbeControl;
}): Promise<CodexProbeStatus> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const jobAuthority = authority(input.userId);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `codex-probe-v2:${createHash("sha256")
    .update(`${input.userId}:${randomUUID()}`, "utf8")
    .digest("hex")}`;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "codex-probe",
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
        throw new CodexProbeError(
          "codex_probe_timeout",
          "The Codex health probe did not finish in time.",
          504,
        );
      }
      await delay(POLL_MS, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      assertSnapshot(job);
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Codex probe.");
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
    if (!job && input.signal?.aborted) {
      await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey).catch(() => undefined);
      throw input.signal.reason ?? error;
    }
    throw error;
  }
}
