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
const MAX_OPERATION_MS = 330_000;
const POLL_MS = 100;
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_VERSION_BYTES = 256;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export const MATRAIX_DEVELOPMENT_POOL = "persona/datasets/matraix-persona-dev-sample";
export const MATRAIX_PRODUCTION_POOL = "persona/datasets/matraix-persona-1m";
export const MATRAIX_PRODUCTION_POOL_COMMAND = [
  "huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release",
  "--repo-type dataset",
  `--local-dir ${MATRAIX_PRODUCTION_POOL}/release`,
].join(" ");

export interface MatraixProbePoolStatus {
  readonly pool: string;
  readonly label: string;
  readonly personas: number;
  readonly present: boolean;
}

export interface MatraixProbeStatus {
  readonly ready: boolean;
  readonly reason: string;
  readonly clone: { readonly found: boolean; readonly path: string };
  readonly python: {
    readonly found: boolean;
    readonly path: string;
    readonly version: string;
    readonly venv: string;
  };
  readonly pools: readonly MatraixProbePoolStatus[];
  readonly productionPoolCommand: string;
}

export interface MatraixProbeControl {
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

const DEFAULT_CONTROL: MatraixProbeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class MatraixProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "MatraixProbeError";
    this.code = code;
    this.status = status;
  }
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("MatrAIx probe user scope is invalid.");
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

function boundedPath(value: unknown, empty: boolean): value is string {
  return boundedText(value, MAX_PATH_BYTES) &&
    (value === "" ? empty : path.isAbsolute(value));
}

function parsePool(value: unknown, pool: string, label: string): MatraixProbePoolStatus {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["pool", "label", "personas", "present"]) ||
    value.pool !== pool ||
    value.label !== label ||
    !Number.isSafeInteger(value.personas) ||
    Number(value.personas) < 0 ||
    Number(value.personas) > 10_000_000 ||
    typeof value.present !== "boolean"
  ) throw new Error("Runtime returned invalid MatrAIx pool status.");
  return {
    pool,
    label,
    personas: value.personas as number,
    present: value.present,
  };
}

function assertSnapshot(job: RuntimeJobSnapshot): void {
  if (
    job.jobType !== "matraix-probe" ||
    job.workerKind !== "matraix-probe-node" ||
    job.resourceClass !== "document-processing" ||
    job.gardenId !== null ||
    job.conversationId !== null
  ) throw new Error("Runtime returned a job outside the MatrAIx probe contract.");
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): MatraixProbeStatus {
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
    !exactKeys(content.result, [
      "ready",
      "reason",
      "clone",
      "python",
      "pools",
      "productionPoolCommand",
    ])
  ) throw new Error("Runtime returned an unfenced MatrAIx probe result.");
  const result = content.result;
  if (
    typeof result.ready !== "boolean" ||
    !boundedText(result.reason, MAX_REASON_BYTES) ||
    !isRecord(result.clone) ||
    !exactKeys(result.clone, ["found", "path"]) ||
    typeof result.clone.found !== "boolean" ||
    !boundedPath(result.clone.path, true) ||
    result.clone.found !== (result.clone.path !== "") ||
    !isRecord(result.python) ||
    !exactKeys(result.python, ["found", "path", "version", "venv"]) ||
    typeof result.python.found !== "boolean" ||
    !boundedPath(result.python.path, true) ||
    result.python.found !== (result.python.path !== "") ||
    !boundedText(result.python.version, MAX_VERSION_BYTES) ||
    !boundedPath(result.python.venv, false) ||
    !Array.isArray(result.pools) ||
    result.pools.length !== 2 ||
    result.productionPoolCommand !== MATRAIX_PRODUCTION_POOL_COMMAND ||
    (result.ready && (!result.clone.found || !result.python.found))
  ) throw new Error("Runtime returned invalid MatrAIx setup status.");
  const pools = [
    parsePool(result.pools[0], MATRAIX_DEVELOPMENT_POOL, "Development sample"),
    parsePool(result.pools[1], MATRAIX_PRODUCTION_POOL, "Persona 1M release"),
  ];
  return {
    ready: result.ready,
    reason: result.reason,
    clone: { found: result.clone.found, path: result.clone.path },
    python: {
      found: result.python.found,
      path: result.python.path,
      version: result.python.version,
      venv: result.python.venv,
    },
    pools,
    productionPoolCommand: MATRAIX_PRODUCTION_POOL_COMMAND,
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
      message: "Windows commit headroom is too low for the MatrAIx probe.",
      status: 503,
      resource: evidence.resource,
      requiredHeadroomMb: evidence.requiredHeadroomMb,
      availableHeadroomMb: evidence.availableHeadroomMb,
    });
  }
  if (job.state === "cancelled") {
    return new MatraixProbeError(
      "matraix_probe_cancelled",
      "The MatrAIx health probe was cancelled.",
      499,
    );
  }
  return new MatraixProbeError(
    "matraix_probe_interrupted",
    job.failureMessage ?? "The MatrAIx health probe was interrupted.",
    502,
  );
}

/** Run one observational MatrAIx environment/catalog probe in a fresh worker. */
export async function runMatraixProbeViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: MatraixProbeControl;
}): Promise<MatraixProbeStatus> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const jobAuthority = authority(input.userId);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `matraix-probe-v2:${createHash("sha256")
    .update(`${input.userId}:${randomUUID()}`, "utf8")
    .digest("hex")}`;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "matraix-probe",
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
        throw new MatraixProbeError(
          "matraix_probe_timeout",
          "The MatrAIx health probe did not finish in time.",
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
      throw new Error("Runtime returned output for another MatrAIx probe.");
    }
    return parseResult(job, output.content);
  } catch (error) {
    if (
      job &&
      !cancellationForwarded &&
      input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
      cancellationForwarded = true;
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
