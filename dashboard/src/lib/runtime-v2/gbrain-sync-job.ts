import "server-only";

import { randomUUID } from "node:crypto";

import type { GBrainSyncResult } from "../gbrain/types.ts";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 500;
const MAX_OPERATION_MS = 30 * 60_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface GBrainSyncRuntimeInput {
  userId: number;
  gardenId: string;
  clusterId: number;
  queueJobId?: number | null;
  signal?: AbortSignal;
  control?: GBrainSyncRuntimeControl;
}

export interface GBrainSyncRuntimeHandle {
  authority: RuntimeJobAuthority;
  snapshot: RuntimeJobSnapshot;
}

export interface GBrainSyncRuntimeControl {
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

const DEFAULT_CONTROL: GBrainSyncRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export class GBrainSyncRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GBrainSyncRuntimeError";
    this.code = code;
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

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function validateInput(input: GBrainSyncRuntimeInput): void {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1) {
    throw new TypeError("GBrain Runtime sync requires an authenticated user.");
  }
  if (!boundedText(input.gardenId, 256)) {
    throw new TypeError("GBrain Runtime sync requires a bounded garden identity.");
  }
  if (!Number.isSafeInteger(input.clusterId) || input.clusterId < 1) {
    throw new TypeError("GBrain Runtime sync requires a valid garden record.");
  }
  if (
    input.queueJobId !== undefined &&
    input.queueJobId !== null &&
    (!Number.isSafeInteger(input.queueJobId) || input.queueJobId < 1)
  ) {
    throw new TypeError("GBrain Runtime sync received an invalid durable queue record.");
  }
}

function assertSnapshot(
  snapshot: RuntimeJobSnapshot,
  authority: RuntimeJobAuthority,
): void {
  if (
    snapshot.jobType !== "gbrain-sync" ||
    snapshot.workerKind !== "gbrain-sync-node" ||
    snapshot.resourceClass !== "document-processing" ||
    snapshot.gardenId !== authority.gardenId ||
    snapshot.conversationId !== null
  ) {
    throw new GBrainSyncRuntimeError(
      "invalid_runtime_job",
      "Runtime returned a job outside the GBrain indexing contract.",
    );
  }
}

function validateResult(value: unknown): GBrainSyncResult {
  if (!isRecord(value)) {
    throw new GBrainSyncRuntimeError("invalid_result", "Runtime returned an invalid GBrain indexing result.");
  }
  const optional = ["revision", "error"].filter((key) => Object.hasOwn(value, key));
  if (!exactKeys(value, [
    "clusterId",
    "sourceId",
    "status",
    "pagesIndexed",
    "chunksIndexed",
    "mode",
    ...optional,
  ])) {
    throw new GBrainSyncRuntimeError("invalid_result", "Runtime returned an invalid GBrain indexing result.");
  }
  if (
    !Number.isSafeInteger(value.clusterId) ||
    Number(value.clusterId) < 1 ||
    !boundedText(value.sourceId, 256) ||
    !["synced", "stale", "skipped"].includes(String(value.status)) ||
    !Number.isSafeInteger(value.pagesIndexed) ||
    Number(value.pagesIndexed) < 0 ||
    !Number.isSafeInteger(value.chunksIndexed) ||
    Number(value.chunksIndexed) < 0 ||
    !boundedText(value.mode, 64) ||
    (Object.hasOwn(value, "revision") && !boundedText(value.revision, 256)) ||
    (Object.hasOwn(value, "error") && !boundedText(value.error, 2 * 1024))
  ) {
    throw new GBrainSyncRuntimeError("invalid_result", "Runtime returned an invalid GBrain indexing result.");
  }
  return {
    clusterId: Number(value.clusterId),
    sourceId: value.sourceId,
    status: value.status as GBrainSyncResult["status"],
    pagesIndexed: Number(value.pagesIndexed),
    chunksIndexed: Number(value.chunksIndexed),
    mode: value.mode,
    ...(typeof value.revision === "string" ? { revision: value.revision } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function validateEnvelope(job: RuntimeJobSnapshot, value: unknown): GBrainSyncResult {
  if (!isRecord(value) || !exactKeys(value, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) {
    throw new GBrainSyncRuntimeError("invalid_result", "Runtime returned an invalid GBrain indexing envelope.");
  }
  const identity = value.identity;
  if (
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.completionSequence !== job.lastWorkerSequence ||
    !isRecord(identity) ||
    !exactKeys(identity, ["jobId", "attempt", "workerInstanceId"]) ||
    identity.jobId !== job.jobId ||
    identity.attempt !== job.attempt ||
    identity.workerInstanceId !== job.workerInstanceId
  ) {
    throw new GBrainSyncRuntimeError("invalid_result", "Runtime returned GBrain output outside its worker fence.");
  }
  return validateResult(value.result);
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
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

function terminalError(snapshot: RuntimeJobSnapshot): GBrainSyncRuntimeError {
  if (snapshot.state === "resource_exhausted") {
    return new GBrainSyncRuntimeError(
      "resource_exhausted",
      "There is not enough free memory to refresh GBrain right now.",
    );
  }
  if (snapshot.state === "cancelled") {
    return new GBrainSyncRuntimeError("cancelled", "GBrain indexing was cancelled.");
  }
  return new GBrainSyncRuntimeError("sync_failed", "GBrain indexing did not complete.");
}

export async function startGBrainSyncRuntimeJob(
  input: GBrainSyncRuntimeInput,
): Promise<GBrainSyncRuntimeHandle> {
  validateInput(input);
  if (!input.control && !isRuntimeV2ServiceControlConfigured()) {
    throw new GBrainSyncRuntimeError(
      "runtime_unavailable",
      "Breadboard's Runtime indexing service is unavailable.",
    );
  }
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const authority: RuntimeJobAuthority = {
    userId: input.userId,
    gardenId: input.gardenId,
    conversationId: null,
  };
  const queueJobId = input.queueJobId ?? null;
  const idempotencyKey = queueJobId === null
    ? `gbrain-sync-v2:direct:${randomUUID()}`
    : `gbrain-sync-v2:queue:${queueJobId}`;
  const control = input.control ?? DEFAULT_CONTROL;
  const snapshot = await control.submit(authority, {
    jobType: "gbrain-sync",
    idempotencyKey,
    requestPayload: {
      protocolVersion: PROTOCOL_VERSION,
      operation: "sync-garden",
      clusterId: input.clusterId,
      queueJobId,
    },
  });
  assertSnapshot(snapshot, authority);
  return { authority, snapshot };
}

export async function runGBrainSyncViaRuntime(
  input: GBrainSyncRuntimeInput,
): Promise<GBrainSyncResult> {
  const control = input.control ?? DEFAULT_CONTROL;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("GBrain indexing timed out", "TimeoutError")),
    MAX_OPERATION_MS,
  );
  timeout.unref?.();
  const forwardAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Request aborted", "AbortError"),
  );
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  let handle: GBrainSyncRuntimeHandle | null = null;
  let snapshot: RuntimeJobSnapshot | null = null;
  try {
    handle = await startGBrainSyncRuntimeJob({ ...input, control });
    snapshot = handle.snapshot;
    while (!TERMINAL_STATES.has(snapshot.state)) {
      await delay(POLL_INTERVAL_MS, controller.signal);
      snapshot = await control.inspect(handle.authority, snapshot.jobId);
      assertSnapshot(snapshot, handle.authority);
    }
    if (snapshot.state !== "succeeded") throw terminalError(snapshot);
    const output = await control.readOutput(handle.authority, snapshot.jobId, "result");
    const result = validateEnvelope(snapshot, output.content);
    if (result.clusterId !== input.clusterId) {
      throw new GBrainSyncRuntimeError(
        "invalid_result",
        "Runtime returned GBrain output for another garden.",
      );
    }
    return result;
  } catch (error) {
    if (handle && (!snapshot || !TERMINAL_STATES.has(snapshot.state))) {
      await control.cancel(handle.authority, handle.snapshot.jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}
